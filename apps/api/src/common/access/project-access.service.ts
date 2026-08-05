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
  sale: async (p, id) =>
    (await p.sale.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  lead: async (p, id) =>
    (await p.lead.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  lease: async (p, id) => leaseProjectId(p, id),
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
  campaign: async (p, id) => {
    const c = await p.campaign.findUnique({ where: { id }, select: { projects: { select: { projectId: true } } } });
    return c?.projects.map((cp) => cp.projectId);
  },
  task: async (p, id) =>
    (await p.task.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
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
};

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
