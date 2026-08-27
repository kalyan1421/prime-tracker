import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectAccessService } from '../../common/access/project-access.service';

const DAY_MS = 86_400_000;

/** A unit nobody has posted about in this long is its own kind of risk. */
const STALE_DAYS = 7;

export interface SiteTrackerFilters {
  projectId?: string;
  buildingId?: string;
  blockerStatus?: string;
  workType?: string;
  sitePriority?: string;
  search?: string;
  /** Opt in to units that are not on the tracker at all — see the note in grid(). */
  includeUntracked?: boolean;
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
    const building: Prisma.BuildingWhereInput = { deletedAt: null };

    if (filters.buildingId) where.buildingId = filters.buildingId;
    if (filters.projectId) building.projectId = filters.projectId;

    // "On the tracker" is not "exists". A portfolio of 636 units has ~14 under active
    // construction; listing all 636 buries them and makes every summary number meaningless
    // (measured live: 622 of 636 rows had no checklist, and the stale count read 636).
    // ConstructionChecklistRollup already draws this line — "never every unit in the
    // project" — and this grid has to agree with it or the two disagree on screen.
    //
    // A unit counts as tracked once ANYTHING about its site work has been recorded: a
    // checklist, a blocker call, a priority, a work type, or an owner.
    if (!filters.includeUntracked) {
      where.OR = [
        { constructionStages: { some: {} } },
        { blockerStatus: { not: null } },
        { sitePriority: { not: null } },
        { workType: { not: null } },
        { siteAssignees: { some: {} } },
      ];
    }

    // A scoped role sees only its own projects, resolved the same way
    // ConstructionChecklistService.getProjectRollup does.
    if (!filters.projectId && this.access.isScoped(viewer.role, viewer.roles)) {
      building.projectId = { in: await this.access.accessibleProjectIds(viewer.userId) };
    }
    where.building = building;

    if (filters.blockerStatus) {
      // 'NONE' is how the client asks for "nobody has assessed this yet" — a real third
      // state that a plain equality filter cannot express.
      where.blockerStatus = filters.blockerStatus === 'NONE' ? null : filters.blockerStatus;
    }
    if (filters.workType) where.workType = filters.workType;
    if (filters.sitePriority) where.sitePriority = filters.sitePriority;

    const units = await this.prisma.unit.findMany({
      where,
      select: {
        id: true, unitNumber: true, status: true,
        // The board can open the unit's edit form directly, so the row carries the fields
        // that form needs rather than making it fetch the unit again.
        unitType: true, sqft: true, askingPrice: true, askingRent: true, notes: true,
        blockerStatus: true, blockerReason: true, blockerSince: true,
        sitePriority: true, workType: true, templateVersion: true,
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
        workType: u.workType,
        template: u.template
          ? { ...u.template, stampedVersion: u.templateVersion }
          : null,
        assignees: (u.siteAssignees ?? []).map((a: any) => a.user),
        // `null` and `false` say different things here: null = "you cannot see this",
        // false/'' = "there is no tenant". The UI renders them differently.
        tenantName: canViewTenant ? (u.leases?.[0]?.tenantName ?? null) : undefined,
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
        staleDays: canViewUpdates && lastUpdateAt
          ? Math.floor((now - new Date(lastUpdateAt).getTime()) / DAY_MS)
          : null,
      };
    });

    // Search runs last, over the shaped row, so it can match a tenant or the current stage
    // and not only the columns that happen to live on the Unit table.
    if (filters.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      rows = rows.filter((r) => [
        r.unitNumber, r.tenantName, r.building.name, r.project.name,
        r.currentStage?.label, r.blockerReason,
      ].some((v) => v && String(v).toLowerCase().includes(q)));
    }

    const withChecklist = rows.filter((r) => r.totalStages > 0);
    const blocked = rows.filter((r) => r.blockerStatus === 'YES');

    return {
      rows,
      summary: {
        total: rows.length,
        blocked: blocked.length,
        oldestBlockerDays: blocked.reduce((m, r) => Math.max(m, r.blockerDays ?? 0), 0),
        avgPctComplete: withChecklist.length
          ? Math.round(withChecklist.reduce((s, r) => s + (r.pctComplete ?? 0), 0) / withChecklist.length)
          : null,
        // Counted only when the viewer can see updates at all; otherwise the number would
        // be a silent zero that reads as "all healthy".
        stale: canViewUpdates
          ? rows.filter((r) => r.staleDays === null || (r.staleDays ?? 0) >= STALE_DAYS).length
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
