import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditPayload {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Which permission each audited entity answers to, for the shared Activity Log.
 *
 * The admin audit page is gated on `audit:view` (SUPER_ADMIN / FOUNDER / EXECUTIVE) and
 * returns whole rows, `oldValues`/`newValues` included — those blobs carry real asking
 * prices, loan principals and lender names, which is exactly why it is that narrow.
 *
 * The Activity Log is the opposite trade: open to everyone who can see the Updates
 * section, so it must earn that width by (a) never returning the value payloads and
 * (b) dropping any event whose subject the viewer is not entitled to. A Construction
 * lead reading this feed must not learn that a budget was revised.
 *
 * `area` is the user-facing grouping the filter offers; `permission` is the gate.
 */
const ACTIVITY_ENTITY_MAP: Record<string, { area: string; permission: string }> = {
  Units:                 { area: 'Units & Buildings',  permission: 'unit:view' },
  Buildings:             { area: 'Units & Buildings',  permission: 'building:view' },
  Projects:              { area: 'Units & Buildings',  permission: 'project:view' },
  Sales:                 { area: 'Sales & Leads',      permission: 'sales:view' },
  Sale:                  { area: 'Sales & Leads',      permission: 'sales:view' },
  Leads:                 { area: 'Sales & Leads',      permission: 'lead:view' },
  Brokers:               { area: 'Sales & Leads',      permission: 'broker:view' },
  Leases:                { area: 'Leases',             permission: 'lease:view' },
  Lease:                 { area: 'Leases',             permission: 'lease:view' },
  Budgets:               { area: 'Money',              permission: 'budget:view' },
  BudgetRevision:        { area: 'Money',              permission: 'budget:view' },
  Actuals:               { area: 'Money',              permission: 'actual:view' },
  // No commitment:view exists — commitments are a finance concern, so they follow the
  // financial gate rather than being silently visible to everyone.
  Commitments:           { area: 'Money',              permission: 'financial:view' },
  Loans:                 { area: 'Money',              permission: 'loan:view' },
  Draws:                 { area: 'Money',              permission: 'draw:view' },
  Contracts:             { area: 'Money',              permission: 'contract:view' },
  Vendors:               { area: 'Money',              permission: 'vendor:view' },
  Investors:             { area: 'Money',              permission: 'investor:view' },
  Kpi:                   { area: 'Money',              permission: 'financial:view' },
  Interior:              { area: 'Interior / Fit-Out', permission: 'interior:view' },
  Campaigns:             { area: 'Ads & Campaigns',    permission: 'campaign:view' },
  Milestones:            { area: 'Construction',       permission: 'milestone:view' },
  ConstructionChecklist: { area: 'Construction',       permission: 'checklist:view' },
  DailyLogs:             { area: 'Construction',       permission: 'dailylog:view' },
  Documents:             { area: 'Documents',          permission: 'document:view' },
  Tasks:                 { area: 'Tasks & Updates',    permission: 'task:view' },
  UpdateBoard:           { area: 'Tasks & Updates',    permission: 'updateBoard:view' },
  Comments:              { area: 'Tasks & Updates',    permission: 'comment:view' },
  // Account and org administration, plus the per-user notification rows and the removed
  // AI feature's leftovers: admin-only, and none of it is business activity anyone else
  // needs in a feed.
  User:                  { area: 'Administration',     permission: 'user:manage' },
  Organizations:         { area: 'Administration',     permission: 'org:manage' },
  OrgSettings:           { area: 'Administration',     permission: 'org:manage' },
  Notifications:         { area: 'Administration',     permission: 'user:manage' },
  AiSummaries:           { area: 'Administration',     permission: 'user:manage' },
};

/**
 * Sign-in and MFA events. Real audit records, but not "who changed what" — they are 375
 * rows of noise in a business activity feed, and they stay available on the admin audit
 * page where they belong.
 */
const ACTIVITY_EXCLUDED_ACTIONS = new Set(['LOGIN', 'LOGOUT', 'MFA_VERIFY', 'MFA_ENABLE', 'MFA_DISABLE']);

/** Past-tense verb per action, so a row reads as a sentence rather than an enum. */
const ACTIVITY_VERBS: Record<string, string> = {
  CREATE: 'created', UPDATE: 'updated', DELETE: 'deleted',
  ROLE_CHANGE: 'changed a role on', APPROVE: 'approved', REJECT: 'rejected',
  LEASE_HISTORY_BACKFILLED: 'backfilled history on',
  SALE_HISTORY_BACKFILLED: 'backfilled sale history on',
  LEASE_TENANCY_ENDED: 'ended a tenancy on',
  LEASE_TERMS_CHANGED: 'changed terms on',
  LEASE_HISTORICAL_DELETED: 'deleted historical records on',
};

/** Singular, human noun per entity — "Units" is a table name, not something you created. */
const ACTIVITY_NOUNS: Record<string, string> = {
  Units: 'a unit', Buildings: 'a building', Projects: 'a project',
  Sales: 'a sale', Sale: 'a sale', Leads: 'a lead', Brokers: 'a broker',
  Leases: 'a lease', Lease: 'a lease',
  Budgets: 'a budget line', BudgetRevision: 'a budget revision', Actuals: 'an actual',
  Commitments: 'a commitment', Loans: 'a loan', Draws: 'a draw request',
  Contracts: 'a contract', Vendors: 'a vendor', Investors: 'an investor record',
  Kpi: 'a KPI snapshot', Interior: 'a fit-out record', Campaigns: 'a campaign',
  Milestones: 'a milestone', ConstructionChecklist: 'a checklist step',
  DailyLogs: 'a site update', Documents: 'a document', Tasks: 'a task',
  UpdateBoard: 'an update', Comments: 'a comment', User: 'a user',
  Organizations: 'an organization', OrgSettings: 'an org setting',
  Notifications: 'a notification', AiSummaries: 'a summary',
};

/**
 * How each audited entity names itself in the Activity Log.
 *
 * "Demo PM updated a unit" is true but useless — the whole point of the feed is knowing
 * WHICH unit, in which building, on which project. Each entry says which Prisma model to
 * look the id up in, the (deliberately minimal) fields to read, and how to turn a row
 * into a label, a context line and a link.
 *
 * Two rules hold for every `select` here:
 *  - Only fields the entity's own permission already covers. Lender appears on Loans
 *    because Loans is gated on `loan:view`, which is exactly who may see lenders; no
 *    resolver reads an amount, a price or a rent.
 *  - Nothing is selected that the row's own module would not show. The label is an
 *    identifier, not a summary of the change.
 *
 * An entity with no resolver simply keeps the generic summary — that degrades the row,
 * it does not break the feed.
 */
type ActivitySubject = { label: string; context?: string; href?: string };

/** Building · Project, from whichever of the two sides a polymorphic row populated. */
function assetContext(row: any): { context?: string; projectId?: string } {
  const b = row.unit?.building ?? row.building ?? null;
  const project = b?.project ?? row.project ?? null;
  const parts = [b?.name, project?.name].filter(Boolean);
  return { context: parts.length ? parts.join(' · ') : undefined, projectId: project?.id ?? row.projectId };
}

const ASSET_SELECT = {
  unit: { select: { id: true, unitNumber: true, building: { select: { name: true, project: { select: { id: true, name: true } } } } } },
  building: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
};

const ACTIVITY_SUBJECTS: Record<string, { model: string; select: any; build: (r: any) => ActivitySubject }> = {
  Units: {
    model: 'unit',
    select: { id: true, unitNumber: true, building: { select: { name: true, project: { select: { id: true, name: true } } } } },
    build: (r) => {
      const { context, projectId } = assetContext(r);
      return { label: `Unit ${r.unitNumber}`, context, href: projectId ? `/projects/${projectId}/units/${r.id}` : undefined };
    },
  },
  Buildings: {
    model: 'building',
    select: { id: true, name: true, project: { select: { id: true, name: true } } },
    build: (r) => ({ label: r.name, context: r.project?.name, href: r.project?.id ? `/projects/${r.project.id}/buildings/${r.id}` : undefined }),
  },
  Projects: {
    model: 'project',
    select: { id: true, name: true },
    build: (r) => ({ label: r.name, href: `/projects/${r.id}` }),
  },
  Sales: {
    model: 'sale',
    select: { id: true, buyer: true, projectId: true, ...ASSET_SELECT },
    build: (r) => {
      const { context, projectId } = assetContext(r);
      const asset = r.unit ? `Unit ${r.unit.unitNumber}` : r.building?.name;
      return {
        label: r.buyer ? `${r.buyer}${asset ? ` — ${asset}` : ''}` : (asset ?? 'a sale'),
        context, href: projectId ? `/projects/${projectId}/revenue` : undefined,
      };
    },
  },
  Leads: {
    model: 'lead',
    select: { id: true, name: true, projectId: true, ...ASSET_SELECT },
    build: (r) => {
      const { context } = assetContext(r);
      return { label: r.name, context, href: '/leads' };
    },
  },
  Campaigns: {
    model: 'campaign',
    select: { id: true, name: true, channel: true },
    build: (r) => ({ label: r.name, context: r.channel ? String(r.channel).replace(/_/g, ' ').toLowerCase() : undefined, href: '/campaigns' }),
  },
  Leases: {
    model: 'lease',
    select: { id: true, tenantName: true, ...ASSET_SELECT },
    build: (r) => {
      const { context, projectId } = assetContext(r);
      const asset = r.unit ? `Unit ${r.unit.unitNumber}` : r.building?.name;
      return {
        label: r.tenantName ? `${r.tenantName}${asset ? ` — ${asset}` : ''}` : (asset ?? 'a lease'),
        context, href: projectId ? `/projects/${projectId}/revenue` : undefined,
      };
    },
  },
  Documents: {
    model: 'document',
    select: { id: true, fileName: true, projectId: true, ...ASSET_SELECT },
    build: (r) => {
      const { context, projectId } = assetContext(r);
      return { label: r.fileName, context, href: projectId ? `/projects/${projectId}/documents` : undefined };
    },
  },
  Tasks: {
    model: 'task',
    select: { id: true, title: true, projectId: true, ...ASSET_SELECT },
    build: (r) => ({ label: r.title, context: assetContext(r).context, href: '/tasks' }),
  },
  Milestones: {
    model: 'milestone',
    select: { id: true, title: true, project: { select: { id: true, name: true } } },
    build: (r) => ({ label: r.title, context: r.project?.name, href: r.project?.id ? `/projects/${r.project.id}/milestones` : undefined }),
  },
  DailyLogs: {
    model: 'dailyLog',
    select: { id: true, notes: true, project: { select: { id: true, name: true } }, ...ASSET_SELECT },
    build: (r) => {
      const { context, projectId } = assetContext(r);
      // The note itself is the identifier here — a site update has no name — so it is
      // clipped to a first line rather than reproduced in full.
      const note = (r.notes ?? '').split('\n')[0].trim();
      const label = note.length > 70 ? `${note.slice(0, 70)}…` : (note || 'a site update');
      return {
        label,
        context: context ?? r.project?.name,
        href: r.unit?.id && projectId ? `/projects/${projectId}/units/${r.unit.id}` : (projectId ? `/projects/${projectId}/construction` : undefined),
      };
    },
  },
  ConstructionChecklist: {
    model: 'unitConstructionStage',
    // Only the unit side: a stage hangs off a unit and has no building relation of its
    // own, so spreading ASSET_SELECT here makes Prisma reject the whole query.
    select: { id: true, label: true, unit: ASSET_SELECT.unit },
    build: (r) => {
      const { context, projectId } = assetContext(r);
      return {
        label: r.unit ? `${r.label} — Unit ${r.unit.unitNumber}` : r.label,
        context,
        href: r.unit?.id && projectId ? `/projects/${projectId}/units/${r.unit.id}` : undefined,
      };
    },
  },
  UpdateBoard: {
    model: 'updateBoardPost',
    select: { id: true, title: true },
    build: (r) => ({ label: r.title, href: '/updates' }),
  },
  Draws: {
    model: 'drawRequest',
    select: { id: true, drawNumber: true, project: { select: { id: true, name: true } } },
    build: (r) => ({ label: `Draw #${r.drawNumber}`, context: r.project?.name, href: r.project?.id ? `/projects/${r.project.id}/draws` : undefined }),
  },
  Budgets: {
    model: 'budgetLine',
    select: { id: true, category: true, description: true, project: { select: { id: true, name: true } } },
    build: (r) => ({
      label: r.description || String(r.category ?? '').replace(/_/g, ' ').toLowerCase(),
      context: r.project?.name,
      href: r.project?.id ? `/projects/${r.project.id}/construction` : undefined,
    }),
  },
  Loans: {
    model: 'loan',
    select: { id: true, lender: true, project: { select: { id: true, name: true } } },
    build: (r) => ({ label: r.lender || 'a loan', context: r.project?.name, href: r.project?.id ? `/projects/${r.project.id}/draws` : undefined }),
  },
  Contracts: {
    model: 'contract',
    select: { id: true, description: true, vendor: { select: { name: true } }, project: { select: { id: true, name: true } } },
    build: (r) => ({
      label: r.description,
      context: [r.vendor?.name, r.project?.name].filter(Boolean).join(' · ') || undefined,
      href: r.project?.id ? `/projects/${r.project.id}/vendors` : undefined,
    }),
  },
  Vendors: { model: 'vendor', select: { id: true, name: true }, build: (r) => ({ label: r.name }) },
  Investors: { model: 'investor', select: { id: true, name: true }, build: (r) => ({ label: r.name, href: `/investors/${r.id}` }) },
  Brokers: { model: 'broker', select: { id: true, name: true }, build: (r) => ({ label: r.name, href: '/brokers' }) },
  Interior: {
    model: 'interiorProject',
    select: { id: true, name: true, ...ASSET_SELECT },
    build: (r) => ({ label: r.name, context: assetContext(r).context, href: '/interior' }),
  },
};

/**
 * Which ACTIVITY_SUBJECTS keys resolve against a model that actually has `deletedAt`.
 * Deliberately a conservative allowlist rather than every key: filtering on a column a
 * model doesn't have throws, and that would take down subject resolution for every row in
 * the page, not just the one entity — worse than the stale-link bug this exists to fix.
 * Extend as more entities are confirmed to carry the column.
 */
const SOFT_DELETABLE_ACTIVITY_ENTITIES = new Set(['Projects', 'Units', 'Buildings', 'Sales', 'Sale', 'Leases', 'Lease', 'Interior']);

// Sales and leases are audited under BOTH a plural and a singular entity name, written by
// different code paths. The plural rows carry no entityId — they are the list-level
// operations — while the singular ones are the per-record writes and are the rows worth
// resolving. Aliased rather than duplicated so the two can never drift.
ACTIVITY_SUBJECTS.Sale = ACTIVITY_SUBJECTS.Sales;
ACTIVITY_SUBJECTS.Lease = ACTIVITY_SUBJECTS.Leases;

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(payload: AuditPayload): Promise<void> {
    try {
      // Verify userId exists before setting FK
      let userId = payload.userId;
      if (userId) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) userId = undefined;
      }

      await this.prisma.auditEvent.create({
        data: {
          userId,
          action: payload.action,
          entity: payload.entity,
          entityId: payload.entityId,
          oldValues: (payload.oldValues as any) ?? undefined,
          newValues: (payload.newValues as any) ?? undefined,
          ipAddress: payload.ipAddress,
          userAgent: payload.userAgent,
          metadata: (payload.metadata as any) ?? undefined,
        },
      });
    } catch (err) {
      console.error('Audit log failed:', err);
    }
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    userId?: string;
    entity?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Number(params.limit) || 50);
    const { userId, entity, action, startDate, endDate } = params;

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (entity) where.entity = entity;
    if (action) where.action = action;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, Date>).gte = startDate;
      if (endDate) (where.createdAt as Record<string, Date>).lte = endDate;
    }

    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { events, total, page, limit };
  }

  /**
   * The values that actually occur in the log, for populating the filter controls.
   *
   * Derived rather than hard-coded: the admin UI previously listed a fixed set of
   * actions that included two (MFA_VERIFY, QB_SYNC) which no code path ever writes, so
   * selecting them returned an empty table with no explanation. Entities are worse —
   * there are 25 of them and the list grows with every module.
   *
   * Counts ride along so each option can show its size, which turns the filter into a
   * summary of the log as well as a control.
   */
  async filterOptions() {
    const [actions, entities, actorRows] = await Promise.all([
      this.prisma.auditEvent.groupBy({
        by: ['action'],
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
      }),
      this.prisma.auditEvent.groupBy({
        by: ['entity'],
        _count: { entity: true },
        orderBy: { _count: { entity: 'desc' } },
      }),
      // No `take`: the list is bounded by the user table, not the event table, and a cap
      // silently omitted low-activity people from the filter with no way to tell the
      // options were incomplete — the filter just appeared not to contain them.
      this.prisma.auditEvent.groupBy({
        by: ['userId'],
        _count: { userId: true },
        orderBy: { _count: { userId: 'desc' } },
      }),
    ]);

    const actorIds = actorRows.map((r) => r.userId).filter((id): id is string => !!id);
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return {
      actions: actions.map((a) => ({ value: a.action, count: a._count.action })),
      entities: entities
        .filter((e) => !!e.entity)
        .map((e) => ({ value: e.entity, count: e._count.entity })),
      // Actors whose user row was deleted are dropped: filtering by an id with no name
      // is not something anyone can act on, and the events stay visible unfiltered.
      actors: actorRows
        .filter((r) => r.userId && userById.has(r.userId))
        .map((r) => ({
          value: r.userId as string,
          label: userById.get(r.userId as string)!.name || userById.get(r.userId as string)!.email,
          count: r._count.userId,
        })),
    };
  }

  /**
   * The Activity Log behind the Updates section: who changed what, across every module.
   *
   * Differs from findAll() in the two ways that let it be shown to everyone —
   * see ACTIVITY_ENTITY_MAP above:
   *  1. Entities the viewer has no permission for are excluded IN THE QUERY, not filtered
   *     out of the response, so the rows are never loaded and the total is honest.
   *  2. `oldValues`/`newValues` are never selected. The feed says a budget line was
   *     updated; it does not say what the number went from or to.
   *
   * An entity missing from the map is treated as forbidden rather than public. A new
   * module's audit rows then stay invisible here until someone maps them, which is the
   * failure that leaves data hidden rather than the one that leaks it.
   */
  async activityFeed(
    params: { page?: number; limit?: number; userId?: string; area?: string; search?: string },
    viewer: { permissions: string[] },
  ) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 30));

    const visibleEntities = Object.entries(ACTIVITY_ENTITY_MAP)
      .filter(([, cfg]) => viewer.permissions.includes(cfg.permission))
      .filter(([, cfg]) => !params.area || cfg.area === params.area)
      .map(([entity]) => entity);

    // No readable entity at all: return an empty page rather than an unfiltered query.
    if (visibleEntities.length === 0) {
      return { events: [], total: 0, page, limit, areas: [] };
    }

    const where: Prisma.AuditEventWhereInput = {
      entity: { in: visibleEntities },
      action: { notIn: Array.from(ACTIVITY_EXCLUDED_ACTIONS) },
      ...(params.userId ? { userId: params.userId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        // An explicit select, not an omit: a field added to AuditEvent later cannot leak
        // into this feed by default the way it would with `include`.
        select: {
          id: true, action: true, entity: true, entityId: true, createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    const subjects = await this.resolveSubjects(rows);

    return {
      events: rows.map((r) => {
        const subject = r.entityId ? subjects.get(`${r.entity}:${r.entityId}`) : undefined;
        const verb = ACTIVITY_VERBS[r.action] ?? r.action.replace(/_/g, ' ').toLowerCase();
        return {
          id: r.id,
          at: r.createdAt,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          area: ACTIVITY_ENTITY_MAP[r.entity]?.area ?? 'Other',
          actorId: r.user?.id ?? null,
          actorName: r.user?.name || r.user?.email || 'System',
          // Pre-rendered server-side so every client agrees on the wording, and so the
          // client never has to reach for the values to describe what happened.
          summary: `${verb} ${ACTIVITY_NOUNS[r.entity] ?? r.entity}`,
          // Sent apart from `title` so the client can weight the record name over the
          // verb — in a feed this dense, the thing that changed has to out-rank the fact
          // that something changed.
          verb,
          // What was touched, when we could still find it. A DELETE has nothing left to
          // look up, and neither does a record archived since — both fall back to the
          // generic summary rather than showing a blank or a raw id.
          subject: subject?.label ?? null,
          subjectContext: subject?.context ?? null,
          href: subject?.href ?? null,
          // The row's headline: the specific form when the record resolved, the generic
          // one when it did not.
          title: subject ? `${verb} ${subject.label}` : `${verb} ${ACTIVITY_NOUNS[r.entity] ?? r.entity}`,
        };
      }),
      total,
      page,
      limit,
      areas: this.visibleAreas(viewer.permissions),
    };
  }

  /**
   * Batch-resolve the records a page of events points at, one query per entity type.
   *
   * A page is at most 100 rows spanning a handful of entity types, so this is a few
   * queries, not N+1. Each is isolated in its own catch: a resolver that goes stale
   * against a renamed column degrades those rows to the generic summary instead of
   * failing the whole feed, which is the wrong thing to take down for a label.
   *
   * Only ids already present in the permission-filtered result set are looked up, so this
   * cannot widen what the viewer sees.
   */
  private async resolveSubjects(
    rows: Array<{ entity: string; entityId: string | null }>,
  ): Promise<Map<string, ActivitySubject>> {
    const idsByEntity = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.entityId || !ACTIVITY_SUBJECTS[r.entity]) continue;
      const set = idsByEntity.get(r.entity) ?? new Set<string>();
      set.add(r.entityId);
      idsByEntity.set(r.entity, set);
    }

    const out = new Map<string, ActivitySubject>();
    await Promise.all(
      Array.from(idsByEntity.entries()).map(async ([entity, ids]) => {
        const cfg = ACTIVITY_SUBJECTS[entity];
        try {
          const found: any[] = await (this.prisma as any)[cfg.model].findMany({
            // Excludes soft-deleted rows so a since-deleted/archived record falls back to
            // the generic summary below rather than resolving a live-looking name and link
            // to something that no longer shows anywhere else in the app. Scoped to the
            // entities confirmed to carry `deletedAt` — applying it blindly to one that
            // doesn't would 500 the whole feed instead of degrading one row.
            where: {
              id: { in: Array.from(ids) },
              ...(SOFT_DELETABLE_ACTIVITY_ENTITIES.has(entity) ? { deletedAt: null } : {}),
            },
            select: cfg.select,
          });
          for (const row of found) {
            const built = cfg.build(row);
            if (built?.label) out.set(`${entity}:${row.id}`, built);
          }
        } catch {
          // Resolver out of step with the schema — leave these rows generic.
        }
      }),
    );
    return out;
  }

  /** The area filter's options — only areas the viewer can actually read something in. */
  private visibleAreas(permissions: string[]) {
    const areas = new Set<string>();
    for (const cfg of Object.values(ACTIVITY_ENTITY_MAP)) {
      if (permissions.includes(cfg.permission)) areas.add(cfg.area);
    }
    return Array.from(areas).sort();
  }

  /**
   * People who appear in the feed the viewer can see.
   *
   * Scoped to the viewer's visible entities on purpose: deriving it from the whole table
   * would let someone infer that a colleague had been busy in a module they themselves
   * cannot read, which is the same leak the feed itself is careful to avoid.
   */
  async activityActors(viewer: { permissions: string[] }) {
    const visibleEntities = Object.entries(ACTIVITY_ENTITY_MAP)
      .filter(([, cfg]) => viewer.permissions.includes(cfg.permission))
      .map(([entity]) => entity);
    if (visibleEntities.length === 0) return [];

    const rows = await this.prisma.auditEvent.groupBy({
      by: ['userId'],
      where: {
        entity: { in: visibleEntities },
        action: { notIn: Array.from(ACTIVITY_EXCLUDED_ACTIONS) },
        userId: { not: null },
      },
      _count: { userId: true },
      orderBy: { _count: { userId: 'desc' } },
    });

    const ids = rows.map((r) => r.userId).filter((id): id is string => !!id);
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return rows
      .filter((r) => r.userId && byId.has(r.userId))
      .map((r) => ({
        value: r.userId as string,
        label: byId.get(r.userId as string)!.name || byId.get(r.userId as string)!.email,
        count: r._count.userId,
      }));
  }
}
