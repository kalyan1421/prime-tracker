import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectAccessService } from '../../common/access/project-access.service';

const DAY_MS = 86_400_000;

/** Whole days between `from` and now; null when there is nothing to measure from. */
function daysSince(from: Date | string | null | undefined): number | null {
  if (!from) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / DAY_MS));
}

/**
 * A unit nobody has posted about in this long is its own kind of risk.
 *
 * Exported because the daily cron raises SITE_UPDATE_STALE off the same threshold. Two
 * copies of "seven" would drift, and the grid and the alert disagreeing about what counts
 * as quiet is worse than either being wrong on its own.
 */
export const STALE_DAYS = 7;

export interface SiteTrackerFilters {
  projectId?: string;
  buildingId?: string;
  blockerStatus?: string;
  sitePriority?: string;
  search?: string;
  /** Opt in to units that are not on the tracker at all — see the note in grid(). */
  includeUntracked?: boolean;
  /**
   * ONLY units that are not on the tracker — the inverse of the default. What "Track a
   * unit" needs, and the reason it exists as a server filter rather than a client one:
   * the modal used to ask for every unit and then keep the ones with no stages, which is
   * a different question. A unit with a blocker and no checklist IS on the tracker, and
   * the modal offered it anyway.
   */
  untrackedOnly?: boolean;
}

export interface SiteTrackerViewer {
  userId: string;
  role: string;
  roles?: string[];
  permissions: string[];
}

@Injectable()
export class SiteTrackerService {
  constructor(
    private prisma: PrismaService,
    private access: ProjectAccessService,
  ) {}

  /**
   * One row per unit on the tracker, plus the summary the rail renders.
   *
   * Deliberately a single query + in-memory shaping rather than a per-unit fan-out: the
   * grid renders every tracked unit at once, and N+1-ing the checklist would be one query
   * per row. Same reason ConstructionChecklistRollup pulls all stages in one findMany.
   */
  async grid(filters: SiteTrackerFilters, viewer: SiteTrackerViewer) {
    // Tenant identity lives on the Lease, which has its own permission. CONSTRUCTION holds
    // siteTracker:view and NOT lease:view — so the tenant column has to be redacted for
    // exactly the role most likely to be looking at this grid. Same rule UnitsService
    // applies to its own lease/sale arrays.
    const canViewTenant = viewer.permissions.includes('lease:view');
    const canViewUpdates = viewer.permissions.includes('dailylog:view');
    const canViewSales = viewer.permissions.includes('sales:view');

    const where: Prisma.UnitWhereInput = { deletedAt: null };

    // A sold unit is a closed deal, not site work. It is only on this grid at all because
    // it still carries the checklist from when it was being built, and for the site team
    // that is finished history cluttering the board they use to decide what to do today.
    // Gated on sales:view rather than a role name: whoever reads the sales side has a
    // reason to see a sold unit's build record, and whoever does not, does not.
    if (!canViewSales) where.status = { not: 'SOLD' };
    // The unit's own `deletedAt` is not enough, and neither is the building's. Archiving a
    // project soft-deletes the PROJECT ROW ONLY (ProjectsService.delete) — its buildings and
    // units keep `deletedAt: null` forever. Without `project.deletedAt` here, every unit of
    // every archived project stayed on this grid, complete with its checklist, blockers and
    // stale counts, while the unit page 404'd those exact rows (UnitsService.findById walks
    // the whole parent chain). UnitsService.findInventory already draws this line; this grid
    // has to agree with it.
    const building: Prisma.BuildingWhereInput = { deletedAt: null, project: { deletedAt: null } };

    if (filters.buildingId) where.buildingId = filters.buildingId;
    if (filters.projectId) building.projectId = filters.projectId;

    // "On the tracker" is not "exists". A portfolio of 636 units has ~14 under active
    // construction; listing all 636 buries them and makes every summary number meaningless
    // (measured live: 622 of 636 rows had no checklist, and the stale count read 636).
    // ConstructionChecklistRollup already draws this line — "never every unit in the
    // project" — and this grid has to agree with it or the two disagree on screen.
    //
    // A unit counts as tracked once ANYTHING about its site work has been recorded: a
    // checklist, a blocker call, a priority, or an owner.
    //
    // ONE definition, used in both directions. The negation is spelled out rather than
    // wrapped in Prisma's NOT so each half stays readable: "no stages AND no blocker call
    // AND no priority AND nobody assigned".
    if (filters.untrackedOnly) {
      where.constructionStages = { none: {} };
      where.blockerStatus = null;
      where.sitePriority = null;
      where.siteAssignees = { none: {} };
    } else if (!filters.includeUntracked) {
      where.OR = [
        { constructionStages: { some: {} } },
        { blockerStatus: { not: null } },
        { sitePriority: { not: null } },
        { siteAssignees: { some: {} } },
      ];
    }

    // A scoped role sees only its own projects, resolved the same way
    // ConstructionChecklistService.getProjectRollup does.
    if (!filters.projectId && this.access.isScoped(viewer.role, viewer.roles)) {
      building.projectId = { in: await this.access.accessibleProjectIds(viewer.userId) };
    }
    where.building = building;

    // Skipped under untrackedOnly, which already pins blockerStatus to null — an
    // untracked unit has no blocker by definition, and a YES filter there means nothing.
    if (filters.blockerStatus && !filters.untrackedOnly) {
      // 'NONE' is how the client asks for "nobody has assessed this yet" — a real third
      // state that a plain equality filter cannot express.
      where.blockerStatus = filters.blockerStatus === 'NONE' ? null : filters.blockerStatus;
    }
    if (filters.sitePriority && !filters.untrackedOnly) where.sitePriority = filters.sitePriority;

    const units = await this.prisma.unit.findMany({
      where,
      select: {
        id: true, unitNumber: true, status: true, createdAt: true,
        // The board can open the unit's edit form directly, so the row carries the fields
        // that form needs rather than making it fetch the unit again.
        unitType: true, sqft: true, askingPrice: true, askingRent: true, notes: true,
        blockerStatus: true, blockerReason: true, blockerSince: true,
        sitePriority: true, templateVersion: true,
        building: {
          select: { id: true, name: true, project: { select: { id: true, name: true } } },
        },
        template: { select: { id: true, name: true, version: true } },
        siteAssignees: {
          select: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { assignedAt: 'asc' },
        },
        constructionStages: {
          select: {
            id: true, label: true, status: true, sortOrder: true,
            inspectionStatus: true, inspectionDate: true, startsOn: true, endsOn: true,
            owner: { select: { id: true, name: true } },
            // When the checklist was seeded — the closest thing to "joined the tracker",
            // and the clock silence is measured from when there is nothing else.
            createdAt: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
        // Tenant of record. Only ACTIVE leases — an expired tenancy is not who is in there.
        ...(canViewTenant
          ? {
              leases: {
                where: { status: 'ACTIVE', deletedAt: null },
                select: { id: true, tenantName: true },
                orderBy: { leaseStart: 'desc' },
                take: 1,
              },
            }
          : {}),
        ...(canViewUpdates
          ? {
              // The newest update, with enough to render its TEXT on the unit row rather
              // than a count. A count tells you something happened; the sentence tells you
              // what, which is the entire reason anyone opens the row.
              dailyLogs: {
                select: {
                  id: true, logDate: true, notes: true,
                  author: { select: { name: true } },
                  stage: { select: { id: true, label: true } },
                },
                orderBy: [{ logDate: 'desc' }, { createdAt: 'desc' }],
                take: 1,
              },
              _count: { select: { dailyLogs: true } },
            }
          : {}),
      },
      orderBy: [
        { building: { project: { name: 'asc' } } },
        { building: { name: 'asc' } },
        { unitNumber: 'asc' },
      ],
    });

    const now = Date.now();
    let rows = units.map((u: any) => {
      const stages = u.constructionStages ?? [];
      const done = stages.filter((s: any) => s.status === 'DONE').length;
      // The stage that actually needs attention: the first BLOCKED one if any, else the
      // first incomplete one. Same rule the construction rollup uses, so the two agree.
      const current = stages.find((s: any) => s.status === 'BLOCKED')
        ?? stages.find((s: any) => s.status !== 'DONE')
        ?? null;
      const newest = u.dailyLogs?.[0] ?? null;
      const lastUpdateAt = newest?.logDate ?? null;

      // How long this unit has been ON THE TRACKER, so silence can be aged from something.
      // Its oldest stage is the closest marker — that is when the checklist was seeded —
      // falling back to the unit's own createdAt for a unit tracked by a blocker or a
      // priority alone. Same fallback shape as StaleUnitsCron, which ages vacancy from
      // `availableSince ?? createdAt` for exactly this reason.
      const trackedSince = stages.reduce(
        (oldest: Date | null, st: any) => (
          st.createdAt && (!oldest || st.createdAt < oldest) ? st.createdAt : oldest
        ),
        null as Date | null,
      ) ?? u.createdAt ?? null;

      return {
        id: u.id,
        unitNumber: u.unitNumber,
        status: u.status,
        unitType: u.unitType,
        sqft: u.sqft,
        askingPrice: u.askingPrice,
        askingRent: u.askingRent,
        notes: u.notes,
        project: u.building.project,
        building: { id: u.building.id, name: u.building.name },
        blockerStatus: u.blockerStatus,
        blockerReason: u.blockerReason,
        blockerSince: u.blockerSince,
        blockerDays: u.blockerSince
          ? Math.floor((now - new Date(u.blockerSince).getTime()) / DAY_MS)
          : null,
        sitePriority: u.sitePriority,
        template: u.template
          ? { ...u.template, stampedVersion: u.templateVersion }
          : null,
        assignees: (u.siteAssignees ?? []).map((a: any) => a.user),
        // `null` and `false` say different things here: null = "you cannot see this",
        // false/'' = "there is no tenant". The UI renders them differently.
        //
        // A SOLD unit reports no tenant even when an ACTIVE lease row survives on it. The
        // unit page states the rule outright — a tenancy kept on a sold unit "stays out of
        // the rent roll, invoicing, cash flow and reminders, whatever its status says" —
        // and this grid has to agree with it rather than quietly resurrect that tenancy in
        // its tenant column and its search.
        tenantName: canViewTenant
          ? (u.status === 'SOLD' ? null : (u.leases?.[0]?.tenantName ?? null))
          : undefined,
        totalStages: stages.length,
        doneStages: done,
        pctComplete: stages.length ? Math.round((done / stages.length) * 100) : null,
        currentStage: current
          ? { id: current.id, label: current.label, status: current.status }
          : null,
        stages,
        updateCount: canViewUpdates ? (u._count?.dailyLogs ?? 0) : undefined,
        latestUpdate: canViewUpdates && newest
          ? {
              notes: newest.notes,
              logDate: newest.logDate,
              authorName: newest.author?.name ?? null,
              // Which checklist step it came from, when it came from one at all.
              stageLabel: newest.stage?.label ?? null,
            }
          : null,
        lastUpdateAt: canViewUpdates ? lastUpdateAt : undefined,
        // DAYS OF SILENCE, not days since the last update — the two differ for a unit
        // nobody has ever posted about, and that difference was the whole bug. This used
        // to be null whenever `lastUpdateAt` was null, and the summary then counted null
        // as stale: a unit put on the tracker five minutes ago landed in a tile that says
        // "no update 7d+". Measured live, that tile read 15 while the number of units
        // genuinely a week silent was 0.
        //
        // Now a never-updated unit is aged from when it joined the tracker, so a new one
        // starts at zero and earns its way into the count like everything else. Null only
        // survives when there is nothing at all to measure from.
        staleDays: canViewUpdates
          ? daysSince(lastUpdateAt ?? trackedSince)
          : null,
      };
    });

    // Search runs last, over the shaped row, so it can match a tenant or a stage and not
    // only the columns that happen to live on the Unit table. Matches ANY of the unit's
    // stages, not just the current one — searching for an already-finished stage's name
    // used to silently return nothing, because only `currentStage.label` was checked.
    if (filters.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      rows = rows.filter((r) => [
        r.unitNumber, r.tenantName, r.building.name, r.project.name,
        r.blockerReason, ...r.stages.map((s: any) => s.label),
      ].some((v) => v && String(v).toLowerCase().includes(q)));
    }

    const withChecklist = rows.filter((r) => r.totalStages > 0);
    const blocked = rows.filter((r) => r.blockerStatus === 'YES');

    return {
      rows,
      summary: {
        total: rows.length,
        blocked: blocked.length,
        // Null, not zero, when no blocked unit has a start date. Zero reads as "blocked
        // today", which is the opposite of what an unknown start date means.
        oldestBlockerDays: blocked.reduce<number | null>(
          (m, r) => (r.blockerDays === null ? m : Math.max(m ?? 0, r.blockerDays)),
          null,
        ),
        avgPctComplete: withChecklist.length
          ? Math.round(withChecklist.reduce((s, r) => s + (r.pctComplete ?? 0), 0) / withChecklist.length)
          : null,
        // Counted only when the viewer can see updates at all; otherwise the number would
        // be a silent zero that reads as "all healthy". `staleDays` now carries the age of
        // the SILENCE, so this is a plain threshold — no null-means-stale special case,
        // which is what made the tile disagree with its own label.
        stale: canViewUpdates
          ? rows.filter((r) => (r.staleDays ?? 0) >= STALE_DAYS).length
          : null,
        awaitingInspection: rows.reduce(
          (n, r) => n + r.stages.filter((s: any) =>
            s.inspectionStatus === 'SCHEDULED' || s.inspectionStatus === 'IN_PROGRESS').length,
          0,
        ),
        noChecklist: rows.filter((r) => r.totalStages === 0).length,
      },
    };
  }
}
