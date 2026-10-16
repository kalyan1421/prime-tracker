import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  parseMondayRows, rowsFromWorksheet, parseUnitLabel, parseTimeline, parseDate,
  type MondayItem,
} from './monday-export.parser';
import { compareUnitNumbers } from './site-unit-context';

/**
 * One-time move of the client's monday "Site Tracker" board onto this one (2026-10-16).
 *
 * Two passes over the same upload, like the lease and sale imports: a PREVIEW that writes
 * nothing and says exactly what each board row will become, then APPLY. Stateless — the
 * file is re-sent with the property choices made in the preview.
 *
 * Safe to run twice. A row whose unit is already on the tracker is skipped, never merged:
 * merging a monday checklist into one people have been ticking here would duplicate stages
 * and overwrite real progress with a stale export.
 */

export type ImportRowStatus = 'ready' | 'imported' | 'skipped' | 'unmatched' | 'error';

export interface ImportRowResult {
  group: string;
  row: number;
  label: string;
  status: ImportRowStatus;
  projectId: string | null;
  building: string | null;
  /** Lead first, then the other units the row covers. */
  units: { id: string; unitNumber: string }[];
  stages: number;
  blocker: 'YES' | 'NO' | null;
  priority: string | null;
  owners: string[];
  messages: string[];
}

export interface ImportGroupResult {
  name: string;
  projectId: string | null;
  candidates: { id: string; name: string }[];
}

const STAGE_STATUS: Record<string, string> = {
  'not started': 'NOT_STARTED', 'working on it': 'IN_PROGRESS', 'in progress': 'IN_PROGRESS',
  done: 'DONE', stuck: 'BLOCKED', blocked: 'BLOCKED',
};
const INSPECTION: Record<string, string> = {
  'not inspected': 'NOT_INSPECTED', waiting: 'WAITING', scheduled: 'SCHEDULED',
  'in progress': 'IN_PROGRESS', passed: 'PASSED', failed: 'FAILED',
  'requires follow-up': 'REQUIRES_FOLLOW_UP', 'requires follow up': 'REQUIRES_FOLLOW_UP',
};

const lc = (s?: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** "Unit 0805" and "805" are the same unit; "101A" stays itself. */
const unitKey = (s: string) =>
  alnum(s.replace(/^\s*(?:unit|suite)s?\s*#?\s*/i, '')).replace(/^0+(?=\d)/, '');
/** "01 - Contracts" -> "Contracts": the checklist numbers its own steps. */
const stripStep = (s: string) => s.replace(/^\s*\d+\s*[-.]\s*/, '').trim();

@Injectable()
export class SiteTrackerImportService {
  private readonly logger = new Logger(SiteTrackerImportService.name);

  constructor(private prisma: PrismaService) {}

  async run(file: Buffer, opts: { apply: boolean; projectMap?: Record<string, string>; userId: string }) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file as any);
    } catch {
      throw new BadRequestException(
        'Could not read that file. In monday, open the Site Tracker board and use "Export board to Excel", then upload the .xlsx it gives you.',
      );
    }
    const ws = wb.worksheets.reduce<ExcelJS.Worksheet | undefined>(
      (best, w) => (!best || w.rowCount > best.rowCount ? w : best), undefined,
    );
    if (!ws) throw new BadRequestException('That workbook has no sheets.');
    const { groups, warnings } = parseMondayRows(rowsFromWorksheet(ws));

    const projects = await this.prisma.project.findMany({
      where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' },
    });
    const groupResults: ImportGroupResult[] = groups.map((g) => {
      const chosen = opts.projectMap?.[g.name];
      const candidates = this.projectCandidates(g.name, projects);
      const projectId = chosen && projects.some((p) => p.id === chosen)
        ? chosen
        : candidates.length === 1 ? candidates[0].id : null;
      return { name: g.name, projectId, candidates };
    });

    const usedProjectIds = [...new Set(groupResults.map((g) => g.projectId).filter(Boolean))] as string[];
    const [units, users, catalogue] = await Promise.all([
      this.prisma.unit.findMany({
        where: { deletedAt: null, building: { deletedAt: null, projectId: { in: usedProjectIds } } },
        select: {
          id: true, unitNumber: true, buildingId: true, trackedWithId: true,
          blockerStatus: true, sitePriority: true,
          building: { select: { name: true, projectId: true } },
          _count: { select: { constructionStages: true, siteAssignees: true, trackedUnits: true } },
        },
      }),
      this.prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true } }),
      this.prisma.customOption.findMany({
        where: { category: 'construction_stage', isActive: true }, select: { value: true, label: true },
      }),
    ]);
    const stageValueByLabel = new Map(catalogue.map((o) => [lc(o.label), o.value]));

    const claimed = new Map<string, string>(); // unitId -> "group row N" that took it
    const rows: (ImportRowResult & { plan?: RowPlan })[] = [];

    groups.forEach((g, gi) => {
      const projectId = groupResults[gi].projectId;
      for (const item of g.items) {
        rows.push(this.planRow(g.name, item, projectId, units, users, stageValueByLabel, claimed));
      }
    });

    if (opts.apply) {
      for (const r of rows) {
        if (r.status !== 'ready' || !r.plan) continue;
        try {
          await this.applyRow(r.plan, opts.userId);
          r.status = 'imported';
        } catch (e: any) {
          r.status = r.status === 'ready' && e?.skipped ? 'skipped' : 'error';
          r.messages.push(e?.message ?? 'Could not be written.');
          this.logger.warn(`monday import row ${r.row} failed: ${e?.message ?? e}`);
        }
      }
    }

    const totals = { ready: 0, imported: 0, skipped: 0, unmatched: 0, error: 0 } as Record<ImportRowStatus, number>;
    for (const r of rows) totals[r.status] += 1;
    return {
      applied: opts.apply,
      groups: groupResults,
      rows: rows.map(({ plan: _plan, ...rest }) => rest),
      warnings,
      totals,
    };
  }

  private projectCandidates(groupName: string, projects: { id: string; name: string }[]) {
    const g = alnum(groupName);
    if (!g) return [];
    const exact = projects.filter((p) => alnum(p.name) === g);
    if (exact.length) return exact;
    return projects.filter((p) => {
      const n = alnum(p.name);
      return n.startsWith(g) || g.startsWith(n) || n.includes(g);
    });
  }

  /**
   * monday shows people as a name ("Victor") or an email ("andrew@…"). Strongest evidence
   * first — an exact email, then an exact full name, then the email's local part, then a
   * first name — and each tier must be unambiguous on its own, so "pm@prime.dev" is never
   * lost just because "pm@primedevelopers.com" also exists.
   */
  private matchUser(token: string, users: { id: string; name: string | null; email: string }[]) {
    const t = lc(token);
    if (!t) return null;
    const local = t.split('@')[0];
    const tiers: ((u: { name: string | null; email: string }) => boolean)[] = [
      (u) => u.email.toLowerCase() === t,
      (u) => lc(u.name ?? '') === t,
      (u) => u.email.toLowerCase().split('@')[0] === local,
      (u) => lc(u.name ?? '').split(' ')[0] === t,
    ];
    for (const test of tiers) {
      const hits = users.filter(test);
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) return null;
    }
    return null;
  }

  private planRow(
    groupName: string,
    item: MondayItem,
    projectId: string | null,
    units: any[],
    users: { id: string; name: string | null; email: string }[],
    stageValueByLabel: Map<string, string>,
    claimed: Map<string, string>,
  ): ImportRowResult & { plan?: RowPlan } {
    const base: ImportRowResult = {
      group: groupName, row: item.row, label: item.name, status: 'unmatched', projectId,
      building: null, units: [], stages: item.subitems.length, blocker: null, priority: null,
      owners: [], messages: [],
    };
    if (!projectId) {
      base.messages.push(`Choose which property "${groupName || '(no heading)'}" is.`);
      return base;
    }

    const parsed = parseUnitLabel(item.name);
    if (parsed.kind === 'building') {
      base.messages.push('A whole-building row — the tracker works by unit. Track its units instead.');
      return base;
    }
    if (parsed.kind === 'other') {
      base.messages.push(`No unit number in "${item.name}".`);
      return base;
    }

    const inProject = units.filter((u) => u.building.projectId === projectId);
    const found: any[] = [];
    const missing: string[] = [];
    for (const num of parsed.units) {
      let hits = inProject.filter((u) => unitKey(u.unitNumber) === unitKey(num));
      if (hits.length > 1 && parsed.buildingNo) {
        const re = new RegExp(`\\b${parsed.buildingNo}\\b`);
        const narrowed = hits.filter((u) => re.test(u.building.name));
        if (narrowed.length) hits = narrowed;
      }
      if (hits.length === 1) found.push(hits[0]);
      else if (hits.length > 1) missing.push(`${num} (in ${hits.length} buildings)`);
      else missing.push(num);
    }
    if (found.length === 0) {
      base.messages.push(`No unit ${parsed.units.join(', ')} in this property.`);
      return base;
    }
    if (missing.length) base.messages.push(`Not found, left out: ${missing.join(', ')}.`);

    const buildingIds = new Set(found.map((u) => u.buildingId));
    if (buildingIds.size > 1) {
      base.status = 'error';
      base.units = found.map((u) => ({ id: u.id, unitNumber: u.unitNumber }));
      base.messages.push('These units are in different buildings — one row is one job in one building.');
      return base;
    }

    const lead = found[0];
    base.units = found.map((u) => ({ id: u.id, unitNumber: u.unitNumber }));
    base.building = lead.building.name;
    base.stages = item.subitems.length;

    const isTracked = (u: any) => u.trackedWithId || u._count.constructionStages > 0 || u._count.siteAssignees > 0
      || u._count.trackedUnits > 0 || u.blockerStatus !== null || u.sitePriority !== null;
    if (isTracked(lead)) {
      base.status = 'skipped';
      base.messages.push(lead.trackedWithId
        ? `Unit ${lead.unitNumber} is already on the tracker as part of another row — left as it is.`
        : `Unit ${lead.unitNumber} is already on the tracker — left as it is.`);
      return base;
    }
    for (const u of found) {
      const by = claimed.get(u.id);
      if (by) {
        base.status = 'error';
        base.messages.push(`Unit ${u.unitNumber} is also in ${by}.`);
        return base;
      }
    }
    const members = found.slice(1).filter((u) => {
      if (isTracked(u)) {
        base.messages.push(`Unit ${u.unitNumber} is already on the tracker on its own, so it stays a separate row.`);
        return false;
      }
      return true;
    });
    for (const u of [lead, ...members]) claimed.set(u.id, `${groupName} row ${item.row}`);
    base.units = [lead, ...members]
      .sort((a, b) => (a === lead ? -1 : b === lead ? 1 : compareUnitNumbers(a.unitNumber, b.unitNumber)))
      .map((u) => ({ id: u.id, unitNumber: u.unitNumber }));

    // Board fields.
    const blocker = lc(item.blocker);
    if (blocker === 'yes') base.blocker = 'YES';
    else if (blocker === 'no') base.blocker = 'NO';
    const priority = lc(item.priority);
    if (['low', 'medium', 'high'].includes(priority)) base.priority = priority.toUpperCase();
    else if (priority === 'done') base.messages.push('monday\'s "DONE" priority is a status, not a priority — left unset.');

    const ownerIds: string[] = [];
    const unknown: string[] = [];
    for (const p of item.persons) {
      const u = this.matchUser(p, users);
      if (u) { if (!ownerIds.includes(u.id)) { ownerIds.push(u.id); base.owners.push(u.name ?? u.email); } }
      else unknown.push(p);
    }
    if (unknown.length) base.messages.push(`No user matches ${unknown.join(', ')} — add them as owners by hand.`);

    const stages = item.subitems.map((s) => {
      const label = stripStep(s.name) || s.name;
      const tl = parseTimeline(s.timeline);
      const owner = s.owner ? this.matchUser(s.owner.split(/\s*,\s*/)[0], users) : null;
      return {
        label,
        stageValue: stageValueByLabel.get(lc(label)) ?? null,
        status: STAGE_STATUS[lc(s.status)] ?? 'NOT_STARTED',
        inspectionStatus: INSPECTION[lc(s.inspectionStatus)] ?? null,
        inspectionDate: parseDate(s.inspectionDate) ?? null,
        startsOn: tl.start ?? null,
        endsOn: tl.end ?? null,
        ownerId: owner?.id ?? null,
      };
    });

    const reason = (item.latestUpdates ?? '').slice(0, 480) || 'Flagged blocked on the monday board.';
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const noteLines = [
      item.latestUpdates && `Latest: ${item.latestUpdates}`,
      item.nextActions && `Next: ${item.nextActions}`,
      item.tenant && `Tenant / business: ${item.tenant}`,
    ].filter(Boolean);
    const note = noteLines.length ? `From the monday Site Tracker (imported ${today})\n${noteLines.join('\n')}` : null;

    base.status = 'ready';
    return {
      ...base,
      plan: {
        leadId: lead.id, buildingId: lead.buildingId, projectId: projectId,
        memberIds: members.map((m) => m.id),
        stages, ownerIds, blocker: base.blocker, blockerReason: reason, priority: base.priority, note,
      },
    };
  }

  private async applyRow(plan: RowPlan, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      // Re-checked inside the write: somebody may have started tracking it since the preview.
      const lead = await tx.unit.findUnique({
        where: { id: plan.leadId },
        select: {
          trackedWithId: true, blockerStatus: true, sitePriority: true,
          _count: { select: { constructionStages: true, siteAssignees: true, trackedUnits: true } },
        },
      });
      if (!lead) throw new Error('The unit no longer exists.');
      if (lead.trackedWithId || lead._count.constructionStages || lead._count.siteAssignees
        || lead._count.trackedUnits || lead.blockerStatus !== null || lead.sitePriority !== null) {
        throw Object.assign(new Error('Went onto the tracker since the preview — left as it is.'), { skipped: true });
      }

      if (plan.stages.length) {
        await tx.unitConstructionStage.createMany({
          data: plan.stages.map((s, i) => ({
            unitId: plan.leadId, sortOrder: i + 1, label: s.label, stageValue: s.stageValue,
            status: s.status, inspectionStatus: s.inspectionStatus,
            inspectionDate: s.inspectionDate ? new Date(s.inspectionDate) : null,
            startsOn: s.startsOn ? new Date(s.startsOn) : null,
            endsOn: s.endsOn ? new Date(s.endsOn) : null,
            ownerId: s.ownerId, createdById: userId,
          })),
        });
      }
      const data: Record<string, unknown> = {};
      if (plan.blocker === 'YES') {
        data.blockerStatus = 'YES'; data.blockerReason = plan.blockerReason; data.blockerSince = new Date();
      } else if (plan.blocker === 'NO') {
        data.blockerStatus = 'NO';
      }
      if (plan.priority) data.sitePriority = plan.priority;
      if (Object.keys(data).length) await tx.unit.update({ where: { id: plan.leadId }, data });
      if (plan.ownerIds.length) {
        await tx.unitAssignee.createMany({
          data: plan.ownerIds.map((uid) => ({ unitId: plan.leadId, userId: uid, assignedById: userId })),
          skipDuplicates: true,
        });
      }
      if (plan.memberIds.length) {
        await tx.unit.updateMany({ where: { id: { in: plan.memberIds } }, data: { trackedWithId: plan.leadId } });
      }
      // Written directly, not through DailyLogsService: a 30-row import must not fire 30
      // "posted" notifications at every Founder for text that is weeks old.
      if (plan.note) {
        await tx.dailyLog.create({
          data: {
            projectId: plan.projectId, buildingId: plan.buildingId, unitId: plan.leadId,
            logDate: new Date(), notes: plan.note, authorId: userId, source: 'WEB',
          },
        });
      }
    });
  }
}

interface RowPlan {
  leadId: string;
  buildingId: string;
  projectId: string;
  memberIds: string[];
  stages: {
    label: string; stageValue: string | null; status: string; inspectionStatus: string | null;
    inspectionDate: string | null; startsOn: string | null; endsOn: string | null; ownerId: string | null;
  }[];
  ownerIds: string[];
  blocker: 'YES' | 'NO' | null;
  blockerReason: string;
  priority: string | null;
  note: string | null;
}
