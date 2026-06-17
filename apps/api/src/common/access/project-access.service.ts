import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isProjectScopedRole } from '@prime-tracker/shared';

/**
 * Resolves "which project(s) does this request touch?" and answers membership
 * questions, so ProjectAccessGuard (and cross-project list services) can enforce
 * that field roles (PM/Construction/Sales/Marketing) only reach projects they're
 * assigned to. Non-scoped roles (leadership/finance/legal/viewer/super) are never
 * restricted here.
 */

type Resolver = (prisma: PrismaService, id: string) => Promise<string | null | undefined>;

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
  lease: async (p, id) => {
    const l = await p.lease.findUnique({
      where: { id },
      select: {
        building: { select: { projectId: true } },
        unit: { select: { building: { select: { projectId: true } } } },
      },
    });
    return l?.building?.projectId ?? l?.unit?.building?.projectId;
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
  cashflow: async (p, id) =>
    (await p.cashFlowEntry.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  contract: async (p, id) =>
    (await p.contract.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  campaign: async (p, id) =>
    (await p.campaign.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
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
  taskId: 'task',
  interiorProjectId: 'interior',
  commitmentId: 'commitment',
  actualId: 'actual',
  budgetLineId: 'budgetLine',
  contractId: 'contract',
  drawId: 'draw',
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

  isScoped(role: string | undefined): boolean {
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
    viewer: { userId: string; role: string } | undefined,
    explicitProjectId?: string,
  ): Promise<string[] | undefined> {
    if (explicitProjectId) return undefined;
    if (!viewer || !this.isScoped(viewer.role)) return undefined;
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
   * params/query/body plus the controller's bare ":id" param. Unresolvable ids are
   * dropped (treated as "no project context"), so the guard never masks a real 404.
   */
  async resolveProjectIds(
    controllerName: string,
    req: { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: Record<string, unknown> },
  ): Promise<string[]> {
    const ids = new Set<string>();
    const jobs: Promise<void>[] = [];

    const add = async (entity: string | undefined, rawId: unknown) => {
      if (!entity || typeof rawId !== 'string' || !rawId) return;
      const resolver = ENTITY_RESOLVERS[entity];
      if (!resolver) return;
      const pid = await resolver(this.prisma, rawId);
      if (pid) ids.add(pid);
    };

    for (const src of [req.params, req.query, req.body]) {
      if (!src) continue;
      for (const [key, val] of Object.entries(src)) {
        if (KEY_ENTITY[key]) jobs.push(add(KEY_ENTITY[key], val));
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
