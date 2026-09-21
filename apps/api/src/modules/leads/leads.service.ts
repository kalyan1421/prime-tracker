import {
  Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
// The SAME parser the Task/Unit/Project comments and the Update Board use. Writing a
// second one is how two surfaces end up disagreeing about what "@Sarah Chen" means.
import { resolveMentions } from '../comments/mentions';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectAccessService } from '../../common/access/project-access.service';
import { LeadSource, LeadActivityType, Prisma } from '@prisma/client';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private prisma: PrismaService,
    private access: ProjectAccessService,
    private notifications: NotificationsService,
  ) {}

  /**
   * followUpDate arrives as a string from the API and must reach Prisma as a Date (or an
   * explicit null to CLEAR it). `undefined` means "not supplied — leave it alone", which is
   * a different thing from null and must not be collapsed into one.
   *
   * Empty string is treated as a clear: the web forms hold state as Record<string,string>,
   * so a cleared date input is '' rather than null, and 400-ing on that would make the
   * field impossible to unset from the UI.
   */
  private normalizeFollowUpDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid follow-up date "${value}"`);
    }
    return d;
  }

  async findAll(params: {
    projectId?: string;
    status?: string;
    assignedTo?: string;
    unassigned?: boolean;
    unitId?: string;
    buildingId?: string;
    campaignId?: string;
    brokerId?: string;
    /** LeadSource. Validated against the enum before use — see the note in the body. */
    source?: string;
    /** CustomOption "lead_via" value. Free text by design, so no enum guard applies. */
    via?: string;
    /** Inclusive upper bound on followUpDate — the "follow-ups due by" queue. */
    followUpBefore?: string;
    search?: string;
    viewer?: { userId: string; role: string; roles?: string[] };
  } = {}) {
    const {
      projectId, status, assignedTo, unassigned, unitId, buildingId, campaignId, brokerId,
      source, via, followUpBefore, search, viewer,
    } = params;

    // Archiving a project soft-deletes the PROJECT ROW ONLY, so a Lead under it stays
    // deletedAt: null forever — without this, an archived project's leads kept showing in
    // the cross-project /api/leads list (same gap already fixed on Site Tracker, the
    // exceptions feed, and the construction rollup).
    const where: Prisma.LeadWhereInput = { project: { deletedAt: null } };
    if (projectId) where.projectId = projectId;
    else {
      // Scoped field roles (Sales/Marketing/PM) only see leads in their member projects.
      const scopeIds = await this.access.listProjectScope(viewer, projectId);
      if (scopeIds) where.projectId = { in: scopeIds };
    }
    if (status) where.status = status;
    if (unassigned) where.assignedTo = null;
    else if (assignedTo) where.assignedTo = assignedTo;
    if (unitId) where.unitId = unitId;
    if (buildingId) where.buildingId = buildingId;
    if (campaignId) where.campaignId = campaignId;
    if (brokerId) where.brokerId = brokerId;
    // `source` was accepted by the web hook's param type and then silently DROPPED here,
    // so filtering by source returned every lead instead of none of the wrong ones. A
    // filter that quietly widens its result set is worse than a missing one, because the
    // UI looks like it worked. Guarded against the enum rather than passed straight to
    // Prisma: an unknown string would throw a 500 on a user-supplied query param.
    if (source) {
      if (!(source in LeadSource)) {
        throw new BadRequestException(`Unknown lead source "${source}"`);
      }
      where.source = source as LeadSource;
    }
    if (via) where.via = via;
    if (followUpBefore) {
      const bound = new Date(followUpBefore);
      if (Number.isNaN(bound.getTime())) {
        throw new BadRequestException(`Invalid followUpBefore date "${followUpBefore}"`);
      }
      // Inclusive: "due by the 30th" must include the 30th. followUpDate is a DATE column
      // so it reads back at local midnight; lte the same midnight is the whole day.
      where.followUpDate = { not: null, lte: bound };
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const leads = await this.prisma.lead.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true, buildingId: true } },
        building: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true, channel: true } },
        assignedUser: { select: { id: true, name: true, avatarUrl: true } },
        createdByUser: { select: { id: true, name: true } },
        _count: { select: { activities: true } },
        // When the caller scopes to a specific unit or building, include the activity
        // feed so the panel can render a merged timeline without N+1 fetches.
        // Skipped for unscoped lists to keep payload lean.
        ...((unitId || buildingId) ? { activities: { orderBy: { createdAt: 'desc' as const }, take: 20, include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } } } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    return this.withCallSummary(leads);
  }

  /**
   * Attach "called N times" and "last call + its note" to a list of leads.
   *
   * TWO queries for the whole page, not one per lead. The count comes from a groupBy and
   * the latest call from a `distinct` read (DISTINCT ON in Postgres) — both served by the
   * (leadId, type, occurredAt) index. Fetching every call row and reducing in JS would
   * have meant pulling thousands of rows to show one line each.
   */
  private async withCallSummary<T extends { id: string }>(leads: T[]) {
    if (leads.length === 0) return leads as Array<T & { callCount: number; lastCall: any }>;
    const ids = leads.map((l) => l.id);

    const [counts, latest] = await Promise.all([
      this.prisma.leadActivity.groupBy({
        by: ['leadId'],
        where: { leadId: { in: ids }, type: LeadActivityType.CALL },
        _count: { _all: true },
      }),
      this.prisma.leadActivity.findMany({
        where: { leadId: { in: ids }, type: LeadActivityType.CALL },
        // leadId first so Postgres can use DISTINCT ON; occurredAt desc makes the row it
        // keeps per lead the most recent call.
        orderBy: [{ leadId: 'asc' }, { occurredAt: 'desc' }],
        distinct: ['leadId'],
        select: { leadId: true, occurredAt: true, note: true },
      }),
    ]);

    const countBy = new Map(counts.map((c) => [c.leadId, c._count._all]));
    const lastBy = new Map(latest.map((a) => [a.leadId, a]));

    return leads.map((l) => ({
      ...l,
      callCount: countBy.get(l.id) ?? 0,
      lastCall: lastBy.get(l.id)
        ? { occurredAt: lastBy.get(l.id)!.occurredAt, note: lastBy.get(l.id)!.note }
        : null,
    }));
  }

  async findById(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true, buildingId: true } },
        building: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true, channel: true } },
        assignedUser: { select: { id: true, name: true, avatarUrl: true } },
        createdByUser: { select: { id: true, name: true } },
        activities: {
          include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { createdAt: 'desc' },
        },
        unitInterests: {
          include: { unit: { select: { id: true, unitNumber: true, buildingId: true, status: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  // ─────── Multi-unit interest / per-unit waitlist ───────

  /** Record that a lead is interested in a unit (idempotent on lead+unit). */
  /**
   * Keep the lead's primary unit visible in "Units of interest".
   *
   * Lead.unitId (the single primary link) and LeadUnitInterest (the many-to-many
   * waitlist) are different things, and nothing joined them — so a lead showing
   * "Unit 102" on its card still read "Not on any unit waitlist yet" in its detail
   * panel. Whatever the modelling intent, a unit the lead is explicitly attached to
   * IS a unit they are interested in, so the primary link is mirrored into the list.
   *
   * Idempotent (unique on leadId+unitId) and never removes rows: de-selecting the
   * primary unit leaves the interest behind, which is right — interest outlives the
   * current link, and removing it is an explicit action in the panel.
   */
  private async mirrorPrimaryUnitAsInterest(leadId: string, unitId?: string | null) {
    if (!unitId) return;
    try {
      await this.prisma.leadUnitInterest.upsert({
        where: { leadId_unitId: { leadId, unitId } },
        create: { leadId, unitId },
        update: {},
      });
    } catch {
      // Never fail the lead write over the mirror — the link itself is what matters.
    }
  }

  async addInterest(leadId: string, unitId: string, note?: string) {
    if (!unitId) throw new BadRequestException('unitId is required');
    const [lead, unit] = await Promise.all([
      this.prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } }),
      this.prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } }),
    ]);
    if (!lead) throw new NotFoundException('Lead not found');
    if (!unit) throw new NotFoundException('Unit not found');
    return this.prisma.leadUnitInterest.upsert({
      where: { leadId_unitId: { leadId, unitId } },
      create: { leadId, unitId, note },
      update: { note },
      include: { unit: { select: { id: true, unitNumber: true, status: true } } },
    });
  }

  /** Remove a lead↔unit interest by the join-row id. */
  async removeInterest(interestId: string) {
    const existing = await this.prisma.leadUnitInterest.findUnique({ where: { id: interestId } });
    if (!existing) throw new NotFoundException('Interest not found');
    return this.prisma.leadUnitInterest.delete({ where: { id: interestId } });
  }

  /** Waitlist / demand for a unit: every lead that has expressed interest, oldest first. */
  async unitWaitlist(unitId: string) {
    if (!unitId) throw new BadRequestException('unitId is required');
    const interests = await this.prisma.leadUnitInterest.findMany({
      // Exclude interests whose unit has been archived/merged away.
      where: { unitId, unit: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      include: {
        lead: {
          select: {
            id: true, name: true, email: true, phone: true, status: true, budget: true,
            assignedUser: { select: { id: true, name: true } },
          },
        },
      },
    });
    return interests.map((i, idx) => ({
      interestId: i.id,
      position: idx + 1,
      note: i.note,
      addedAt: i.createdAt,
      lead: i.lead,
    }));
  }

  async create(data: {
    projectId: string;
    name?: string;
    email?: string;
    phone?: string;
    source: LeadSource;
    status?: string;
    unitId?: string;
    buildingId?: string;
    unitInterest?: string;
    budget?: number;
    notes?: string;
    assignedTo?: string;
    createdBy: string;
    // Sprint 2 — campaign attribution
    campaignId?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    // Declared rather than left to ride the ...rest spread. An undeclared field reaching
    // Prisma is the accident this file's DTO comment documents; it compiles, works, and
    // breaks silently the moment anything tightens. See normalizeFollowUpDate below.
    followUpDate?: string | null;
    via?: string | null;
  }) {
    const { budget, unitId, buildingId, campaignId, followUpDate, ...rest } = data;
    if (unitId && buildingId) {
      throw new BadRequestException('A lead can attach to either a unit or a building, not both');
    }
    // If campaignId not provided but utmCampaign is, try to resolve to an active
    // campaign matching by name (case-insensitive). Falls back to raw passthrough
    // if no match — utm* fields remain populated for later reconstruction.
    let resolvedCampaignId = campaignId;
    if (!resolvedCampaignId && data.utmCampaign) {
      const match = await this.prisma.campaign.findFirst({
        where: { name: { equals: data.utmCampaign, mode: 'insensitive' }, deletedAt: null },
        select: { id: true },
      });
      if (match) resolvedCampaignId = match.id;
    }
    if (resolvedCampaignId) {
      const campaign = await this.prisma.campaign.findFirst({
        where: { id: resolvedCampaignId, deletedAt: null },
        select: { id: true },
      });
      if (!campaign) throw new BadRequestException('Campaign not found or has been deleted');
    }
    if (unitId) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: unitId, building: { projectId: data.projectId } },
        select: { id: true },
      });
      if (!unit) throw new BadRequestException('Unit does not belong to the specified project');
    }
    if (buildingId) {
      const building = await this.prisma.building.findFirst({
        where: { id: buildingId, projectId: data.projectId },
        select: { id: true },
      });
      if (!building) throw new BadRequestException('Building does not belong to the specified project');
    }
    const created = await this.prisma.lead.create({
      data: {
        ...rest,
        unitId: unitId ?? null,
        buildingId: buildingId ?? null,
        campaignId: resolvedCampaignId ?? null,
        budget: budget !== undefined ? budget : undefined,
        followUpDate: this.normalizeFollowUpDate(followUpDate) ?? null,
        status: data.status ?? 'NEW',
      },
      include: {
        project: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true, buildingId: true } },
        building: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true, channel: true } },
        assignedUser: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
      },
    });
    await this.mirrorPrimaryUnitAsInterest(created.id, created.unitId);
    return created;
  }

  async update(id: string, data: {
    name?: string;
    email?: string;
    phone?: string;
    source?: LeadSource;
    status?: string;
    unitId?: string | null;
    buildingId?: string | null;
    unitInterest?: string;
    budget?: number;
    notes?: string;
    assignedTo?: string | null;
    // Was reaching Prisma only because the body was never whitelisted. Declared now,
    // so re-attributing a lead survives the DTO added alongside this.
    campaignId?: string | null;
    followUpDate?: string | null;
    via?: string | null;
  }) {
    const existing = await this.findById(id);
    const { budget, unitId, buildingId, followUpDate, ...rest } = data;

    // A lead attaches to a unit XOR a building, so SETTING one implicitly clears the
    // other — moving a lead from a building to a unit is a switch, not an error.
    //
    // Previously the caller had to send the opposite side as null itself. The project
    // Leads tab has no Building field and so never could, which made "pick a unit" on a
    // building-linked lead fail with "A lead can attach to either a unit or a building,
    // not both" — an error about a combination the user never asked for. Resolving it
    // here fixes every caller rather than one form.
    const clearsBuilding = unitId !== undefined && unitId !== null;
    const clearsUnit = buildingId !== undefined && buildingId !== null;
    const nextUnitId = clearsUnit ? null : unitId;
    const nextBuildingId = clearsBuilding ? null : buildingId;

    const effectiveUnitId = nextUnitId === undefined ? existing.unitId : nextUnitId;
    const effectiveBuildingId = nextBuildingId === undefined ? existing.buildingId : nextBuildingId;
    if (effectiveUnitId && effectiveBuildingId) {
      throw new BadRequestException('A lead can attach to either a unit or a building, not both');
    }
    if (unitId) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: unitId, building: { projectId: existing.projectId } },
        select: { id: true },
      });
      if (!unit) throw new BadRequestException('Unit does not belong to this lead\'s project');
    }
    if (buildingId) {
      const building = await this.prisma.building.findFirst({
        where: { id: buildingId, projectId: existing.projectId },
        select: { id: true },
      });
      if (!building) throw new BadRequestException('Building does not belong to this lead\'s project');
    }
    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        ...rest,
        ...(nextUnitId !== undefined ? { unitId: nextUnitId } : {}),
        ...(nextBuildingId !== undefined ? { buildingId: nextBuildingId } : {}),
        budget: budget !== undefined ? budget : undefined,
        // Spread conditionally: an absent key must leave the stored date untouched, while
        // an explicit null clears it. Assigning `undefined` unconditionally would be fine
        // for Prisma but hides the distinction from anyone reading this.
        ...(followUpDate !== undefined
          ? { followUpDate: this.normalizeFollowUpDate(followUpDate) }
          : {}),
      },
      include: {
        project: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true, buildingId: true } },
        building: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
      },
    });
    await this.mirrorPrimaryUnitAsInterest(id, updated.unitId);
    return updated;
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.lead.delete({ where: { id } });
  }

  // ---- Dashboard (Sprint 3) ----

  /**
   * Aggregated dashboard payload — pipeline funnel, source breakdown, stale leads,
   * recent activity, and overall conversion rate. One query path per concern so we
   * don't repeat scans; everything filterable by projectId when scoped.
   */
  async dashboard(params: { projectId?: string; viewer?: { userId: string; role: string; roles?: string[] } } = {}) {
    const { projectId, viewer } = params;
    const where: Prisma.LeadWhereInput = projectId ? { projectId } : {};
    if (!projectId) {
      const scopeIds = await this.access.listProjectScope(viewer, projectId);
      if (scopeIds) where.projectId = { in: scopeIds };
    }

    // Pipeline funnel — count grouped by status.
    const byStatusRows = await this.prisma.lead.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const row of byStatusRows) byStatus[row.status] = row._count._all;

    // Source breakdown — count grouped by source.
    const bySourceRows = await this.prisma.lead.groupBy({
      by: ['source'],
      where,
      _count: { _all: true },
    });
    const bySource = bySourceRows.map((r) => ({ source: r.source, count: r._count._all }))
      .sort((a, b) => b.count - a.count);

    // Conversion rate — CONVERTED count / total non-LOST/DEAD.
    const totalActive = Object.entries(byStatus)
      .filter(([s]) => !['LOST', 'DEAD'].includes(s))
      .reduce((sum, [, n]) => sum + n, 0);
    const converted = byStatus['CONVERTED'] ?? 0;
    const conversionRate = totalActive > 0 ? converted / totalActive : null;

    // Stale leads — no activity (lead.updatedAt is bumped on activity log) in 14+ days
    // and not in a terminal status. Surfaces what's rotting.
    const staleCutoff = new Date(Date.now() - 14 * 86_400_000);
    const staleWhere: Prisma.LeadWhereInput = {
      ...where,
      updatedAt: { lt: staleCutoff },
      status: { notIn: ['CONVERTED', 'LOST', 'DEAD'] },
    };
    // The list below is capped at 10 for display; the KPI tile needs the true total,
    // not the length of the capped list (which silently ceilinged at 10).
    const [staleLeadsCount, staleLeads] = await Promise.all([
      this.prisma.lead.count({ where: staleWhere }),
      this.prisma.lead.findMany({
        where: staleWhere,
        select: {
          id: true,
          name: true,
          status: true,
          source: true,
          updatedAt: true,
          project: { select: { id: true, name: true } },
          assignedUser: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'asc' },
        take: 10,
      }),
    ]);

    // Recent activity — across all leads in scope, last 15 events. Scoped the same way
    // `where` above is: an unscoped projectId param previously fell through to `{}`,
    // leaking activity from projects outside a restricted viewer's access.
    const recentActivity = await this.prisma.leadActivity.findMany({
      where: { lead: where },
      select: {
        id: true,
        type: true,
        note: true,
        createdAt: true,
        lead: { select: { id: true, name: true, status: true, projectId: true } },
        createdByUser: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    // Attribution health — how many leads have a unit/building/campaign link.
    // Surfaces the gap when leads aren't connected (the original complaint).
    const totalLeads = Object.values(byStatus).reduce((s, n) => s + n, 0);
    const [withUnit, withBuilding, withCampaign] = await Promise.all([
      this.prisma.lead.count({ where: { ...where, unitId: { not: null } } }),
      this.prisma.lead.count({ where: { ...where, buildingId: { not: null } } }),
      this.prisma.lead.count({ where: { ...where, campaignId: { not: null } } }),
    ]);

    return {
      totalLeads,
      byStatus,
      bySource,
      conversionRate,
      attribution: {
        withUnit, withBuilding, withCampaign,
        unattached: totalLeads - withUnit - withBuilding,
      },
      staleLeads,
      staleLeadsCount,
      recentActivity,
    };
  }

  // ---- Activities ----

  async getActivities(leadId: string) {
    await this.findById(leadId);
    return this.prisma.leadActivity.findMany({
      where: { leadId },
      include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } },
      // Ordered by WHEN IT HAPPENED, not when it was typed. A call back-dated to last
      // Tuesday belongs at last Tuesday in the timeline, otherwise catching up on a week's
      // notes rewrites the apparent order of the whole conversation.
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async addActivity(
    leadId: string, userId: string, type: LeadActivityType, note: string, occurredAt?: string,
  ) {
    await this.findById(leadId);

    let when: Date | undefined;
    if (occurredAt) {
      when = new Date(occurredAt);
      if (Number.isNaN(when.getTime())) {
        throw new BadRequestException(`Invalid date "${occurredAt}"`);
      }
      // A call cannot have happened tomorrow. Allowing it would put entries in the future
      // of the timeline and quietly corrupt "last contacted", which drives the stale-lead
      // triage. Tomorrow's PLANNED contact is what followUpDate is for.
      if (when.getTime() > Date.now() + 60_000) {
        throw new BadRequestException('An activity cannot be logged in the future');
      }
    }

    const activity = await this.prisma.leadActivity.create({
      data: { leadId, createdBy: userId, type, note, ...(when ? { occurredAt: when } : {}) },
      include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } },
    });
    await this.prisma.lead.update({ where: { id: leadId }, data: { updatedAt: new Date() } });
    return activity;
  }

  /**
   * Call history for one lead: how many, the last one with its note, and a per-date
   * roll-up for the calendar.
   *
   * No new table — LeadActivity already records type/note/author/when, and a second
   * store for calls would immediately disagree with the timeline.
   */
  async getCalls(leadId: string) {
    await this.findById(leadId);
    const activities = await this.prisma.leadActivity.findMany({
      where: { leadId },
      include: { createdByUser: { select: { id: true, name: true } } },
      orderBy: [{ occurredAt: 'desc' }],
    });

    const calls = activities.filter((a) => a.type === LeadActivityType.CALL);
    const last = calls[0] ?? null;

    // Keyed by the calendar day the activity happened, so the calendar can dot a date
    // without re-deriving it per cell. `items` carries the type and note so hovering a
    // date can say WHAT happened rather than just that something did.
    const byDate: Record<string, {
      calls: number;
      total: number;
      items: Array<{ type: string; note: string; by: string | null }>;
    }> = {};
    for (const a of activities) {
      const key = a.occurredAt.toISOString().slice(0, 10);
      byDate[key] ??= { calls: 0, total: 0, items: [] };
      byDate[key].total += 1;
      if (a.type === LeadActivityType.CALL) byDate[key].calls += 1;
      // Capped per day: this feeds a tooltip, not a history page.
      if (byDate[key].items.length < 6) {
        byDate[key].items.push({
          type: a.type,
          note: a.note,
          by: a.createdByUser?.name ?? null,
        });
      }
    }

    return {
      callCount: calls.length,
      lastCall: last && {
        id: last.id,
        occurredAt: last.occurredAt,
        note: last.note,
        by: last.createdByUser?.name ?? null,
      },
      // The handful behind the summary line, so hovering "Called 3 times" can show WHICH
      // three without opening the timeline. Capped — this is a hover, not a history page.
      recent: calls.slice(0, 5).map((c) => ({
        id: c.id,
        occurredAt: c.occurredAt,
        note: c.note,
        by: c.createdByUser?.name ?? null,
      })),
      byDate,
    };
  }

  // ---- Discussion thread ----
  //
  // Conversation ABOUT a lead, kept apart from the activity log which records what was
  // DONE to it. Merging the two was tried on this project and reversed.

  async getComments(leadId: string) {
    await this.findById(leadId);
    return this.prisma.leadComment.findMany({
      where: { leadId },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComment(leadId: string, authorId: string, content: string) {
    const lead = await this.findById(leadId);
    const body = content?.trim();
    if (!body) throw new BadRequestException('A comment cannot be empty');

    const comment = await this.prisma.leadComment.create({
      data: { leadId, authorId, content: body },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });

    // Mentions must never be able to fail the write — the comment is the user's work,
    // the notification is a side effect. Same rule CommentsService follows.
    try {
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true },
      });
      const mentioned = resolveMentions(body, users);
      if (mentioned.length > 0) {
        await this.notifications.notifyLeadCommentMention({
          mentionedUserIds: mentioned,
          authorId,
          authorName: users.find((u) => u.id === authorId)?.name || 'Someone',
          leadName: lead.name || 'an unnamed lead',
          content: body,
          link: `/leads?lead=${leadId}`,
        });
      }
    } catch (err) {
      this.logger.warn(`Lead comment mention notification failed: ${err}`);
    }

    return comment;
  }

  /**
   * Editing and deleting are author-only. A discussion thread where anyone can rewrite
   * anyone else's words is not a record of who said what.
   */
  async updateComment(commentId: string, userId: string, content: string) {
    const existing = await this.prisma.leadComment.findUnique({ where: { id: commentId } });
    if (!existing) throw new NotFoundException('Comment not found');
    if (existing.authorId !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }
    const body = content?.trim();
    if (!body) throw new BadRequestException('A comment cannot be empty');

    return this.prisma.leadComment.update({
      where: { id: commentId },
      // editedAt is what lets the UI mark a changed message instead of presenting it as
      // the original.
      data: { content: body, editedAt: new Date() },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async deleteComment(commentId: string, userId: string) {
    const existing = await this.prisma.leadComment.findUnique({ where: { id: commentId } });
    if (!existing) throw new NotFoundException('Comment not found');
    if (existing.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await this.prisma.leadComment.delete({ where: { id: commentId } });
    return { id: commentId };
  }

  // ---- Convert to Sale ----

  async convertToSale(leadId: string, userId: string, saleData: {
    unitId: string;
    buyer: string;
    salePrice: number;
    contractDate?: string;
    closingDate?: string;
  }) {
    const lead = await this.findById(leadId);

    if (lead.status === 'CONVERTED') {
      throw new BadRequestException('Lead is already converted');
    }

    // Validate the unit exists and belongs to this lead's project — mirrors the
    // checks in SalesService.create, which this path previously bypassed.
    const unit = await this.prisma.unit.findUnique({
      where: { id: saleData.unitId },
      include: { building: { select: { projectId: true } } },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    if (unit.building.projectId !== lead.projectId) {
      throw new BadRequestException("Unit does not belong to this lead's project");
    }

    // Reserve the unit + create the sale atomically so two leads cannot convert
    // onto the same unit. The guarded updateMany flips only a not-yet-committed
    // unit; a racing second convert finds 0 rows and aborts.
    const sale = await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.unit.updateMany({
        where: { id: saleData.unitId, status: { notIn: ['UNDER_CONTRACT', 'SOLD'] } },
        data: { status: 'UNDER_CONTRACT' },
      });
      if (reserved.count === 0) {
        throw new BadRequestException('Unit is already under contract or sold');
      }

      const created = await tx.sale.create({
        data: {
          projectId: lead.projectId,
          unitId: saleData.unitId,
          buyer: saleData.buyer,
          salePrice: saleData.salePrice,
          contractDate: saleData.contractDate ? new Date(saleData.contractDate) : undefined,
          closingDate: saleData.closingDate ? new Date(saleData.closingDate) : undefined,
          status: 'UNDER_CONTRACT',
          lastActivityAt: new Date(),
        },
      });

      // Mark lead as converted and link to sale
      await tx.lead.update({
        where: { id: leadId },
        data: { status: 'CONVERTED', convertedToSaleId: created.id },
      });

      // Log the activity
      await tx.leadActivity.create({
        data: {
          leadId,
          createdBy: userId,
          type: 'STATUS_CHANGE',
          note: `Converted to sale (Sale ID: ${created.id})`,
        },
      });

      return created;
    });

    return { lead: await this.findById(leadId), sale };
  }
}
