import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isProjectScopedRole, isMultiRoleProjectScoped } from '@prime-tracker/shared';

/**
 * Resolves "which project(s) does this request touch?" and answers membership
 * questions, so ProjectAccessGuard (and cross-project list services) can enforce
 * that field roles (PM/Construction/Sales/Marketing) only reach projects they're
 * assigned to. Non-scoped roles (leadership/finance/legal/viewer/super) are never
 * restricted here.
 */

// Most entities own exactly one project; a multi-project Campaign can resolve to
// several (or none, when portfolio-wide), so a resolver may return an array too.
type Resolver = (prisma: PrismaService, id: string) => Promise<string | string[] | null | undefined>;

/**
 * The `projectId` condition a LIST/aggregate endpoint applies (see projectIdFilter):
 * one explicit project, the caller's member projects, or `undefined` for no filter.
 * Shaped so it drops straight into a Prisma where clause at any depth —
 * `{ projectId: f }`, `{ building: { projectId: f } }` — because Prisma reads
 * `projectId: undefined` as "no condition" and `{ in: [] }` as "nothing".
 */
export type ProjectIdFilter = string | { in: string[] } | undefined;

/** The fields of req.user (JwtStrategy.validate) that list scoping reads. */
export interface ScopedUser {
  sub: string;
  role: string;
  roles?: string[];
}

// A Lease hangs off a Unit *or* a Building, so every lease-child resolver funnels
// through here instead of repeating the two-way traversal.
const leaseProjectId = async (p: PrismaService, leaseId: string) => {
  const l = await p.lease.findUnique({
    where: { id: leaseId },
    select: {
      building: { select: { projectId: true } },
      unit: { select: { building: { select: { projectId: true } } } },
    },
  });
  return l?.building?.projectId ?? l?.unit?.building?.projectId;
};

// entity type → resolve one of its row ids to the owning projectId.
// Most models carry projectId directly; the rest join one or two hops.
const ENTITY_RESOLVERS: Record<string, Resolver> = {
  project: async (_p, id) => id,
  building: async (p, id) =>
    (await p.building.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  unit: async (p, id) =>
    (await p.unit.findUnique({ where: { id }, select: { building: { select: { projectId: true } } } }))
      ?.building?.projectId,
  milestone: async (p, id) =>
    (await p.milestone.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  // POST .../photos/:photoId/sign-off and DELETE .../photos/:photoId on MilestonesController
  // take the photo id alone — the same gap ConstructionChecklist and DailyLogs photos had.
  milestonePhoto: async (p, id) =>
    (await p.milestonePhoto.findUnique({ where: { id }, select: { milestone: { select: { projectId: true } } } }))
      ?.milestone?.projectId,
  milestoneSlipProposal: async (p, id) =>
    (await p.milestoneSlipProposal.findUnique({ where: { id }, select: { projectId: true } }))
      ?.projectId,
  sale: async (p, id) =>
    (await p.sale.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  // PATCH/DELETE/POST .../sales/payments/:paymentId address an installment with no sale in
  // the path. Before this (and the rename from ':id', which SalesController maps to a
  // SALE) a scoped role could edit, log against or delete any project's installments.
  salePayment: async (p, id) =>
    (await p.salePayment.findUnique({ where: { id }, select: { sale: { select: { projectId: true } } } }))
      ?.sale?.projectId,
  lead: async (p, id) =>
    (await p.lead.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  // DELETE /leads/interests/:interestId — the join row's own id, no lead in the path.
  leadUnitInterest: async (p, id) =>
    (await p.leadUnitInterest.findUnique({ where: { id }, select: { lead: { select: { projectId: true } } } }))
      ?.lead?.projectId,
  lease: async (p, id) => leaseProjectId(p, id),
  // PATCH /leases/rent-periods/:periodId/correct — rewrites billed rent, by period id alone.
  leaseRentPeriod: async (p, id) => {
    const rp = await p.leaseRentPeriod.findUnique({ where: { id }, select: { leaseId: true } });
    return rp ? leaseProjectId(p, rp.leaseId) : undefined;
  },
  leaseObligation: async (p, id) => {
    const o = await p.leaseObligation.findUnique({ where: { id }, select: { leaseId: true } });
    return o ? leaseProjectId(p, o.leaseId) : undefined;
  },
  leaseObligationPayment: async (p, id) => {
    const pay = await p.leaseObligationPayment.findUnique({
      where: { id },
      select: { obligation: { select: { leaseId: true } } },
    });
    return pay ? leaseProjectId(p, pay.obligation.leaseId) : undefined;
  },
  leaseRentInvoice: async (p, id) => {
    const inv = await p.leaseRentInvoice.findUnique({ where: { id }, select: { leaseId: true } });
    return inv ? leaseProjectId(p, inv.leaseId) : undefined;
  },
  loan: async (p, id) => {
    const l = await p.loan.findUnique({
      where: { id },
      select: { projectId: true, building: { select: { projectId: true } } },
    });
    return l?.projectId ?? l?.building?.projectId;
  },
  // DELETE /loans/schedule/:scheduleId addresses a schedule line by its own id. It used to
  // be ':id', which LoansController maps to a LOAN, so the line's id resolved to nothing
  // and the guard checked no project at all.
  drawSchedule: async (p, id) => {
    const s = await p.drawSchedule.findUnique({
      where: { id },
      select: { loan: { select: { projectId: true, building: { select: { projectId: true } } } } },
    });
    return s?.loan?.projectId ?? s?.loan?.building?.projectId;
  },
  draw: async (p, id) => {
    const d = await p.drawRequest.findUnique({
      where: { id },
      select: {
        projectId: true,
        loan: { select: { projectId: true, building: { select: { projectId: true } } } },
      },
    });
    return d?.projectId ?? d?.loan?.projectId ?? d?.loan?.building?.projectId;
  },
  commitment: async (p, id) =>
    (await p.commitment.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  actual: async (p, id) =>
    (await p.actual.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  budgetLine: async (p, id) =>
    (await p.budgetLine.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  budgetRevision: async (p, id) =>
    (await p.budgetRevision.findUnique({ where: { id }, select: { budgetLine: { select: { projectId: true } } } }))
      ?.budgetLine?.projectId,
  drawDocument: async (p, id) =>
    (await p.drawDocument.findUnique({ where: { id }, select: { drawRequest: { select: { projectId: true } } } }))
      ?.drawRequest?.projectId,
  cashflow: async (p, id) =>
    (await p.cashFlowEntry.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  contract: async (p, id) =>
    (await p.contract.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  // PATCH /contracts/change-orders/:changeOrderId/status — approving one rewrites the
  // contract's currentAmount, and it was ':id' (= a CONTRACT here), so it went unchecked.
  changeOrder: async (p, id) =>
    (await p.changeOrder.findUnique({ where: { id }, select: { contract: { select: { projectId: true } } } }))
      ?.contract?.projectId,
  campaign: async (p, id) => {
    const c = await p.campaign.findUnique({ where: { id }, select: { projects: { select: { projectId: true } } } });
    return c?.projects.map((cp) => cp.projectId);
  },
  task: async (p, id) =>
    (await p.task.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  // GET .../attachments/:attachmentId/download addresses a file by attachment id alone,
  // with no taskId in the path, so without this the guard's isMember loop would run over
  // zero ids — i.e. no membership check — and a scoped role could download any project's
  // attachment. Same class of gap as unitConstructionStagePhoto / dailyLogPhoto below.
  taskAttachment: async (p, id) =>
    (await p.taskAttachment.findUnique({ where: { id }, select: { task: { select: { projectId: true } } } }))
      ?.task?.projectId,
  // POST .../updates/:updateId/photos and DELETE .../updates/:updateId — same shape, and a
  // Project Manager may delete ANY update (TASK_MANAGER_ROLES), so this one mattered.
  taskUpdate: async (p, id) =>
    (await p.taskUpdate.findUnique({ where: { id }, select: { task: { select: { projectId: true } } } }))
      ?.task?.projectId,
  dailyLog: async (p, id) =>
    (await p.dailyLog.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  interior: async (p, id) => {
    const i = await p.interiorProject.findUnique({
      where: { id },
      select: {
        building: { select: { projectId: true } },
        unit: { select: { building: { select: { projectId: true } } } },
        sale: { select: { projectId: true } },
      },
    });
    return i?.building?.projectId ?? i?.unit?.building?.projectId ?? i?.sale?.projectId;
  },
  interiorInvoice: async (p, id) => {
    const inv = await p.interiorInvoice.findUnique({
      where: { id },
      select: {
        interiorProject: {
          select: {
            building: { select: { projectId: true } },
            unit: { select: { building: { select: { projectId: true } } } },
          },
        },
      },
    });
    const ip = inv?.interiorProject;
    return ip?.building?.projectId ?? ip?.unit?.building?.projectId;
  },
  snag: async (p, id) => {
    const sn = await p.snagItem.findUnique({
      where: { id },
      select: {
        interiorProject: {
          select: {
            building: { select: { projectId: true } },
            unit: { select: { building: { select: { projectId: true } } } },
          },
        },
      },
    });
    const ip = sn?.interiorProject;
    return ip?.building?.projectId ?? ip?.unit?.building?.projectId;
  },
  constructionStageTemplateItem: async (p, id) =>
    (await p.constructionStageTemplateItem.findUnique({
      where: { id },
      select: { building: { select: { projectId: true } } },
    }))?.building?.projectId,
  unitConstructionStage: async (p, id) =>
    (await p.unitConstructionStage.findUnique({
      where: { id },
      select: { unit: { select: { building: { select: { projectId: true } } } } },
    }))?.unit?.building?.projectId,
  // DELETE .../photos/:photoId on ConstructionChecklistController had no entry here at
  // all — a scoped role (Construction/PM) could delete any stage photo by id, on any
  // project, since the guard's isMember loop only runs over ids it actually resolves.
  unitConstructionStagePhoto: async (p, id) =>
    (await p.unitConstructionStagePhoto.findUnique({
      where: { id },
      select: { stage: { select: { unit: { select: { building: { select: { projectId: true } } } } } } },
    }))?.stage?.unit?.building?.projectId,
  // Same gap on DailyLogsController's DELETE .../photos/:photoId.
  dailyLogPhoto: async (p, id) =>
    (await p.dailyLogPhoto.findUnique({
      where: { id },
      select: { dailyLog: { select: { projectId: true } } },
    }))?.dailyLog?.projectId,
  // BrokersController addresses installments by their OWN id
  // (PATCH/DELETE /brokers/commission-installments/:id), with no sale or lease in the path,
  // so without this the guard resolves nothing and a scoped role could mark any project's
  // commission paid. Polymorphic the same way the row is: exactly one of sale/lease is set.
  commissionInstallment: async (p, id) => {
    const inst = await p.commissionInstallment.findUnique({
      where: { id },
      select: { saleId: true, leaseId: true },
    });
    if (!inst) return undefined;
    if (inst.saleId) {
      return (await p.sale.findUnique({ where: { id: inst.saleId }, select: { projectId: true } }))
        ?.projectId;
    }
    return inst.leaseId ? leaseProjectId(p, inst.leaseId) : undefined;
  },
  document: async (p, id) => {
    const d = await p.document.findUnique({
      where: { id },
      select: {
        projectId: true,
        building: { select: { projectId: true } },
        unit: { select: { building: { select: { projectId: true } } } },
        sale: { select: { projectId: true } },
      },
    });
    return d?.projectId ?? d?.building?.projectId ?? d?.unit?.building?.projectId ?? d?.sale?.projectId;
  },
};

// Explicit foreign-key keys found in params/query/body → entity type.
const KEY_ENTITY: Record<string, string> = {
  projectId: 'project',
  unitId: 'unit',
  buildingId: 'building',
  saleId: 'sale',
  leaseId: 'lease',
  loanId: 'loan',
  leadId: 'lead',
  milestoneId: 'milestone',
  campaignId: 'campaign',
  projectIds: 'project',
  // Plural forms MUST be listed explicitly. A body key that is absent from this map
  // resolves to nothing, and the guard's loop then runs over zero ids — i.e. no membership
  // check at all for a scoped role. `projectIds` was the only plural here, so the first
  // endpoint to take `leaseIds`/`unitIds` in its body would have shipped unguarded. Same
  // class of hole this file already records finding twice (unitConstructionStagePhoto,
  // dailyLogPhoto). add() resolves array values elementwise, so nothing else is needed.
  leaseIds: 'lease',
  unitIds: 'unit',
  saleIds: 'sale',
  taskId: 'task',
  interiorProjectId: 'interior',
  commitmentId: 'commitment',
  actualId: 'actual',
  budgetLineId: 'budgetLine',
  contractId: 'contract',
  drawId: 'draw',
  revisionId: 'budgetRevision',
  documentId: 'drawDocument',
  obligationId: 'leaseObligation',
};

// Controller class name → { param key → entity type }, for keys too generic to resolve
// globally. ":paymentId" and ":invoiceId" are lease ledger rows only on LeasesController;
// ContractPayment / SalePayment / InteriorInvoice would reuse those names on their own
// controllers, and a global entry would silently resolve them to nothing (= no membership
// check at all). Checked before KEY_ENTITY.
const CONTROLLER_KEY_ENTITY: Record<string, Record<string, string>> = {
  LeasesController: {
    paymentId: 'leaseObligationPayment',
    invoiceId: 'leaseRentInvoice',
    periodId: 'leaseRentPeriod',
  },
  // ":paymentId" is a SalePayment here — the reuse of the name the LeasesController note
  // above predicted. These routes were ':id', which this controller maps to a Sale.
  SalesController: {
    paymentId: 'salePayment',
  },
  // ":proposalId" is a slip cascade only here. Scoped rather than global because any
  // future approval queue would reuse the name, and a global entry would then resolve
  // those ids to nothing — i.e. to no membership check at all.
  // ":photoId" is a MilestonePhoto here — the third controller to use that name.
  MilestonesController: {
    proposalId: 'milestoneSlipProposal',
    photoId: 'milestonePhoto',
  },
  // ":scheduleId" is a DrawSchedule line. Draw routes here use ":drawId", which KEY_ENTITY
  // already resolves globally — both were ':id' before, i.e. resolved as a LOAN id.
  LoansController: {
    scheduleId: 'drawSchedule',
  },
  // Change orders are reached by their own id; the contract's is ':id'.
  ContractsController: {
    changeOrderId: 'changeOrder',
  },
  // The interest join row is deleted by its own id, with no lead in the path.
  LeadsController: {
    interestId: 'leadUnitInterest',
  },
  // One controller, two id families — bare ":id" can't disambiguate them, so both are
  // named explicitly rather than relying on CONTROLLER_ID_ENTITY (which assumes a
  // controller's ":id" always means one entity type).
  ConstructionChecklistController: {
    templateItemId: 'constructionStageTemplateItem',
    stageId: 'unitConstructionStage',
    photoId: 'unitConstructionStagePhoto',
  },
  // ":photoId" is a DailyLogPhoto here and a UnitConstructionStagePhoto on
  // ConstructionChecklistController — scoped for the same collision reason as the
  // other entries in this map.
  DailyLogsController: {
    photoId: 'dailyLogPhoto',
  },
  // ":attachmentId" is a TaskAttachment here and an UpdateBoardAttachment on
  // UpdateBoardController (whose posts are org-wide, not project-scoped), so this is
  // scoped rather than global.
  TasksController: {
    attachmentId: 'taskAttachment',
    updateId: 'taskUpdate',
  },
  // ":installmentId" only exists on the broker commission routes. Note that BrokersController
  // is deliberately ABSENT from CONTROLLER_ID_ENTITY below: its bare ":id" is a Broker, which
  // is a portfolio-wide record with no project of its own, so resolving it would be wrong.
  // The installment routes previously used ":id" for that reason and have been renamed to
  // ":installmentId" so they can be resolved here without that ambiguity.
  BrokersController: {
    installmentId: 'commissionInstallment',
  },
  // ":invoiceId" is a LeaseRentInvoice on LeasesController and an InteriorInvoice here —
  // the collision this map exists for. ":snagId" is scoped for the same reason: it is
  // specific enough today, but a global entry would quietly become wrong the moment
  // anything else grew snags.
  InteriorController: {
    invoiceId: 'interiorInvoice',
    snagId: 'snag',
  },
};

// Controller class name → entity type that its bare ":id" route param refers to.
const CONTROLLER_ID_ENTITY: Record<string, string> = {
  ProjectsController: 'project',
  ProjectHealthController: 'project',
  UnitsController: 'unit',
  BuildingsController: 'building',
  MilestonesController: 'milestone',
  SalesController: 'sale',
  LeadsController: 'lead',
  LeasesController: 'lease',
  LoansController: 'loan',
  DrawsController: 'draw',
  CommitmentsController: 'commitment',
  ActualsController: 'actual',
  BudgetsController: 'budgetLine',
  CashFlowController: 'cashflow',
  ContractsController: 'contract',
  CampaignsController: 'campaign',
  TasksController: 'task',
  DailyLogsController: 'dailyLog',
  InteriorController: 'interior',
  DocumentsController: 'document',
  // website-sync/projects/:id/{snapshot,push}. The controller was already behind the
  // guard but absent from this map, so ':id' resolved to nothing and any role holding
  // project:edit could push any project's inventory to the public website.
  WebsiteSyncController: 'project',
};

/**
 * Whether ProjectAccessGuard can resolve route param `key` on `controllerName` to a project.
 * Exported for route-params.spec.ts, which sweeps every guarded route and fails when one
 * names an id the guard cannot resolve — the gap this file has recorded finding over and
 * over (photo ids, attachment ids, installment ids, draw ids read as loan ids…).
 */
export function guardResolvesParam(controllerName: string, key: string): boolean {
  if (key === 'id') return !!CONTROLLER_ID_ENTITY[controllerName];
  return !!(CONTROLLER_KEY_ENTITY[controllerName]?.[key] ?? KEY_ENTITY[key]);
}

@Injectable()
export class ProjectAccessService {
  constructor(private prisma: PrismaService) {}

  /**
   * `roles` is authoritative when supplied — a user is scoped if ANY role they hold is
   * project-scoped. `role` alone is the primary only, which let a multi-role user with
   * a global primary bypass membership entirely.
   */
  isScoped(role: string | undefined, roles?: string[]): boolean {
    if (roles?.length) return isMultiRoleProjectScoped(roles);
    return !!role && isProjectScopedRole(role);
  }

  /** Project ids the user is an explicit member of (for cross-project list filtering). */
  async accessibleProjectIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    return rows.map((r) => r.projectId);
  }

  /**
   * Project-id filter for cross-project LIST endpoints. Returns the viewer's member
   * projectIds when they are a scoped field role, or `undefined` (no extra filter) when
   * unrestricted (leadership/finance/legal/viewer/super) or when an explicit projectId is
   * already supplied — that path is enforced by ProjectAccessGuard. A scoped user with no
   * memberships yields `[]`, which correctly returns nothing.
   */
  async listProjectScope(
    viewer: { userId: string; role: string; roles?: string[] } | undefined,
    explicitProjectId?: string,
  ): Promise<string[] | undefined> {
    if (explicitProjectId) return undefined;
    if (!viewer || !this.isScoped(viewer.role, viewer.roles)) return undefined;
    return this.accessibleProjectIds(viewer.userId);
  }

  /**
   * listProjectScope as a ready-made Prisma condition, for list/aggregate endpoints that
   * take `?projectId=` but treat it as optional.
   *
   * Those endpoints passed the raw query param straight into `where: { projectId }`. With
   * the param left off that is `projectId: undefined` — no filter to Prisma — and the
   * guard has nothing to check either, so a PM, Sales or Marketing user got every
   * project's sales, leases, draws and documents (audit, 24 Oct 2026). An explicit id is
   * returned as-is: ProjectAccessGuard has already 404'd it for a non-member.
   */
  async projectIdFilter(user: ScopedUser | undefined, explicitProjectId?: string): Promise<ProjectIdFilter> {
    if (explicitProjectId) return explicitProjectId;
    const ids = await this.listProjectScope(
      user ? { userId: user.sub, role: user.role, roles: user.roles } : undefined,
    );
    return ids ? { in: ids } : undefined;
  }

  async isMember(userId: string, projectId: string): Promise<boolean> {
    const m = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true },
    });
    return !!m;
  }

  /**
   * Every projectId the request references, derived from explicit foreign keys in
   * params/query/body (global or controller-scoped) plus the controller's bare ":id"
   * param. Unresolvable ids are
   * dropped (treated as "no project context"), so the guard never masks a real 404.
   */
  async resolveProjectIds(
    controllerName: string,
    req: { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: Record<string, unknown> },
  ): Promise<string[]> {
    const ids = new Set<string>();
    const jobs: Promise<void>[] = [];

    // rawId is normally a single string FK, but array-valued fields (e.g. the
    // multi-project Campaign's projectIds) resolve every element the same way.
    // A resolver itself may also return several projectIds (e.g. a campaign
    // spanning multiple projects) — every one of them must pass membership.
    const add = async (entity: string | undefined, rawId: unknown) => {
      if (!entity) return;
      const resolver = ENTITY_RESOLVERS[entity];
      if (!resolver) return;
      const rawIds = Array.isArray(rawId) ? rawId : [rawId];
      for (const raw of rawIds) {
        if (typeof raw !== 'string' || !raw) continue;
        const pid = await resolver(this.prisma, raw);
        for (const p of Array.isArray(pid) ? pid : [pid]) {
          if (p) ids.add(p);
        }
      }
    };

    const controllerKeys = CONTROLLER_KEY_ENTITY[controllerName];
    for (const src of [req.params, req.query, req.body]) {
      if (!src) continue;
      for (const [key, val] of Object.entries(src)) {
        const entity = controllerKeys?.[key] ?? KEY_ENTITY[key];
        if (entity) jobs.push(add(entity, val));
      }
    }

    const bareId = req.params?.id;
    if (bareId && CONTROLLER_ID_ENTITY[controllerName]) {
      jobs.push(add(CONTROLLER_ID_ENTITY[controllerName], bareId));
    }

    await Promise.all(jobs);
    return [...ids];
  }
}
