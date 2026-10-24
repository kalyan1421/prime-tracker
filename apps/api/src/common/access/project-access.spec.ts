import { NotFoundException } from '@nestjs/common';
import { ProjectAccessService } from './project-access.service';
import { ProjectAccessGuard } from './project-access.guard';

const prisma: any = {
  projectMember: { findMany: jest.fn(), findUnique: jest.fn() },
  unit: { findUnique: jest.fn() },
  sale: { findUnique: jest.fn() },
  building: { findUnique: jest.fn() },
  lease: { findUnique: jest.fn() },
  leaseObligation: { findUnique: jest.fn() },
  leaseObligationPayment: { findUnique: jest.fn() },
  leaseRentInvoice: { findUnique: jest.fn() },
  unitConstructionStagePhoto: { findUnique: jest.fn() },
  dailyLogPhoto: { findUnique: jest.fn() },
  loan: { findUnique: jest.fn() },
  drawRequest: { findUnique: jest.fn() },
  drawSchedule: { findUnique: jest.fn() },
  salePayment: { findUnique: jest.fn() },
  changeOrder: { findUnique: jest.fn() },
  milestonePhoto: { findUnique: jest.fn() },
  taskUpdate: { findUnique: jest.fn() },
  leadUnitInterest: { findUnique: jest.fn() },
  leaseRentPeriod: { findUnique: jest.fn() },
};

// The two shapes a lease can take: hung off a Unit, or straight off a Building.
const unitLevelLease = { building: null, unit: { building: { projectId: 'pL' } } };
const buildingLevelLease = { building: { projectId: 'pB' }, unit: null };

const ctx = (req: any) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getClass: () => ({ name: req.__controller ?? 'UnitsController' }),
  }) as any;

describe('ProjectAccessService.resolveProjectIds', () => {
  let svc: ProjectAccessService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new ProjectAccessService(prisma);
  });

  it('reads an explicit projectId query param directly', async () => {
    const ids = await svc.resolveProjectIds('UnitsController', { query: { projectId: 'p1' } });
    expect(ids).toEqual(['p1']);
  });

  it('resolves a bare :id on UnitsController via unit → building → project', async () => {
    prisma.unit.findUnique.mockResolvedValue({ building: { projectId: 'p2' } });
    const ids = await svc.resolveProjectIds('UnitsController', { params: { id: 'u1' } });
    expect(prisma.unit.findUnique).toHaveBeenCalled();
    expect(ids).toEqual(['p2']);
  });

  it('resolves a body foreign key (saleId → project)', async () => {
    prisma.sale.findUnique.mockResolvedValue({ projectId: 'p3' });
    const ids = await svc.resolveProjectIds('DocumentsController', { body: { saleId: 's1' } });
    expect(ids).toEqual(['p3']);
  });

  it('returns [] when no project context is present (cross-project list)', async () => {
    const ids = await svc.resolveProjectIds('UnitsController', { query: {} });
    expect(ids).toEqual([]);
  });

  it('drops unresolvable ids instead of inventing a project', async () => {
    prisma.unit.findUnique.mockResolvedValue(null);
    const ids = await svc.resolveProjectIds('UnitsController', { params: { id: 'gone' } });
    expect(ids).toEqual([]);
  });

  // These two used to have no entry in CONTROLLER_KEY_ENTITY at all — a scoped role
  // (Construction/PM) could DELETE any stage or daily-log photo by id regardless of
  // which project it belonged to, since with no resolvable id the guard's isMember loop
  // never ran.
  it('resolves :photoId on ConstructionChecklistController via stage → unit → building → project', async () => {
    prisma.unitConstructionStagePhoto.findUnique.mockResolvedValue({
      stage: { unit: { building: { projectId: 'pStage' } } },
    });
    const ids = await svc.resolveProjectIds('ConstructionChecklistController', { params: { photoId: 'ph1' } });
    expect(prisma.unitConstructionStagePhoto.findUnique).toHaveBeenCalled();
    expect(ids).toEqual(['pStage']);
  });

  it('resolves :photoId on DailyLogsController via dailyLog → project, distinct from the checklist one', async () => {
    prisma.dailyLogPhoto.findUnique.mockResolvedValue({ dailyLog: { projectId: 'pLog' } });
    const ids = await svc.resolveProjectIds('DailyLogsController', { params: { photoId: 'ph2' } });
    expect(prisma.dailyLogPhoto.findUnique).toHaveBeenCalled();
    expect(prisma.unitConstructionStagePhoto.findUnique).not.toHaveBeenCalled();
    expect(ids).toEqual(['pLog']);
  });

  it('resolves :obligationId via obligation → lease → unit → building → project', async () => {
    prisma.leaseObligation.findUnique.mockResolvedValue({ leaseId: 'l1' });
    prisma.lease.findUnique.mockResolvedValue(unitLevelLease);
    const ids = await svc.resolveProjectIds('LeasesController', { params: { obligationId: 'ob1' } });
    expect(ids).toEqual(['pL']);
  });

  it('resolves :obligationId on a building-level lease', async () => {
    prisma.leaseObligation.findUnique.mockResolvedValue({ leaseId: 'l2' });
    prisma.lease.findUnique.mockResolvedValue(buildingLevelLease);
    const ids = await svc.resolveProjectIds('LeasesController', { params: { obligationId: 'ob2' } });
    expect(ids).toEqual(['pB']);
  });

  it('resolves :paymentId via payment → obligation → lease (unit-level)', async () => {
    prisma.leaseObligationPayment.findUnique.mockResolvedValue({ obligation: { leaseId: 'l1' } });
    prisma.lease.findUnique.mockResolvedValue(unitLevelLease);
    const ids = await svc.resolveProjectIds('LeasesController', { params: { paymentId: 'pay1' } });
    expect(ids).toEqual(['pL']);
  });

  it('resolves :paymentId on a building-level lease', async () => {
    prisma.leaseObligationPayment.findUnique.mockResolvedValue({ obligation: { leaseId: 'l2' } });
    prisma.lease.findUnique.mockResolvedValue(buildingLevelLease);
    const ids = await svc.resolveProjectIds('LeasesController', { params: { paymentId: 'pay2' } });
    expect(ids).toEqual(['pB']);
  });

  it('resolves :invoiceId via rent invoice → lease (unit-level)', async () => {
    prisma.leaseRentInvoice.findUnique.mockResolvedValue({ leaseId: 'l1' });
    prisma.lease.findUnique.mockResolvedValue(unitLevelLease);
    const ids = await svc.resolveProjectIds('LeasesController', { params: { invoiceId: 'inv1' } });
    expect(ids).toEqual(['pL']);
  });

  it('resolves :invoiceId on a building-level lease', async () => {
    prisma.leaseRentInvoice.findUnique.mockResolvedValue({ leaseId: 'l2' });
    prisma.lease.findUnique.mockResolvedValue(buildingLevelLease);
    const ids = await svc.resolveProjectIds('LeasesController', { params: { invoiceId: 'inv2' } });
    expect(ids).toEqual(['pB']);
  });

  it('drops a deleted obligation rather than falling back to no project context', async () => {
    prisma.leaseObligation.findUnique.mockResolvedValue(null);
    const ids = await svc.resolveProjectIds('LeasesController', { params: { obligationId: 'gone' } });
    expect(ids).toEqual([]);
    expect(prisma.lease.findUnique).not.toHaveBeenCalled();
  });

  it('keeps paymentId/invoiceId scoped to LeasesController', async () => {
    const ids = await svc.resolveProjectIds('ContractsController', {
      params: { paymentId: 'cp1', invoiceId: 'ii1' },
    });
    expect(ids).toEqual([]);
    expect(prisma.leaseObligationPayment.findUnique).not.toHaveBeenCalled();
    expect(prisma.leaseRentInvoice.findUnique).not.toHaveBeenCalled();
  });
});

describe('ProjectAccessGuard', () => {
  let svc: ProjectAccessService;
  let guard: ProjectAccessGuard;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new ProjectAccessService(prisma);
    guard = new ProjectAccessGuard(svc);
  });

  it('lets non-scoped roles through without any lookup', async () => {
    const spy = jest.spyOn(svc, 'resolveProjectIds');
    const ok = await guard.canActivate(ctx({ user: { sub: 'u', role: 'FINANCE' }, query: { projectId: 'p1' } }));
    expect(ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('allows a scoped member', async () => {
    prisma.projectMember.findUnique.mockResolvedValue({ id: 'm1' });
    const ok = await guard.canActivate(
      ctx({ user: { sub: 'pm', role: 'PROJECT_MANAGER' }, query: { projectId: 'p1' } }),
    );
    expect(ok).toBe(true);
  });

  it('404s a scoped non-member hitting another project via ?projectId=', async () => {
    prisma.projectMember.findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(ctx({ user: { sub: 'pm', role: 'CONSTRUCTION' }, query: { projectId: 'p9' } })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s a scoped non-member mutating another project lease obligation', async () => {
    prisma.leaseObligation.findUnique.mockResolvedValue({ leaseId: 'l1' });
    prisma.lease.findUnique.mockResolvedValue(buildingLevelLease);
    prisma.projectMember.findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(
        ctx({
          __controller: 'LeasesController',
          user: { sub: 'sales', role: 'SALES' },
          params: { obligationId: 'ob1' },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s a scoped non-member recording a rent payment on another project invoice', async () => {
    prisma.leaseRentInvoice.findUnique.mockResolvedValue({ leaseId: 'l1' });
    prisma.lease.findUnique.mockResolvedValue(unitLevelLease);
    prisma.projectMember.findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(
        ctx({
          __controller: 'LeasesController',
          user: { sub: 'pm', role: 'PROJECT_MANAGER' },
          params: { invoiceId: 'inv1' },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows a scoped user when no project context resolves (service filters instead)', async () => {
    const ok = await guard.canActivate(ctx({ user: { sub: 'pm', role: 'SALES' }, query: {} }));
    expect(ok).toBe(true);
  });
});

// ─────── Audit 2026-10-24: ids the guard could not resolve ───────
//
// Each of these routes addressed a child row by its own id with no parent in the path, or
// used ':id' on a controller that maps ':id' to a DIFFERENT entity. Either way the id
// resolved to nothing and the guard's isMember loop ran over zero projects — no check.
describe('ProjectAccessService.resolveProjectIds — child ids the guard used to miss', () => {
  let svc: ProjectAccessService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new ProjectAccessService(prisma);
  });

  it('resolves :drawId on LoansController to the DRAW, not to a loan', async () => {
    prisma.drawRequest.findUnique.mockResolvedValue({ projectId: 'pDraw', loan: null });
    const ids = await svc.resolveProjectIds('LoansController', { params: { drawId: 'd1' } });
    expect(ids).toEqual(['pDraw']);
    expect(prisma.loan.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the loan (then its building) for a draw with no projectId of its own', async () => {
    prisma.drawRequest.findUnique.mockResolvedValue({
      projectId: null, loan: { projectId: null, building: { projectId: 'pBldgLoan' } },
    });
    const ids = await svc.resolveProjectIds('LoansController', { params: { drawId: 'd2' } });
    expect(ids).toEqual(['pBldgLoan']);
  });

  it('resolves :scheduleId on LoansController via the line\'s loan', async () => {
    prisma.drawSchedule.findUnique.mockResolvedValue({ loan: { projectId: null, building: { projectId: 'pSched' } } });
    const ids = await svc.resolveProjectIds('LoansController', { params: { scheduleId: 's1' } });
    expect(ids).toEqual(['pSched']);
  });

  it('still reads a bare :id on LoansController as a loan', async () => {
    prisma.loan.findUnique.mockResolvedValue({ projectId: 'pLoan', building: null });
    const ids = await svc.resolveProjectIds('LoansController', { params: { id: 'l1' } });
    expect(ids).toEqual(['pLoan']);
  });

  it('resolves :paymentId on SalesController to the installment\'s sale', async () => {
    prisma.salePayment.findUnique.mockResolvedValue({ sale: { projectId: 'pSale' } });
    const ids = await svc.resolveProjectIds('SalesController', { params: { paymentId: 'sp1' } });
    expect(ids).toEqual(['pSale']);
    // The lease ledger owns ':paymentId' on LeasesController — must not be consulted here.
    expect(prisma.leaseObligationPayment.findUnique).not.toHaveBeenCalled();
  });

  it('resolves :changeOrderId on ContractsController via its contract', async () => {
    prisma.changeOrder.findUnique.mockResolvedValue({ contract: { projectId: 'pCo' } });
    const ids = await svc.resolveProjectIds('ContractsController', { params: { changeOrderId: 'co1' } });
    expect(ids).toEqual(['pCo']);
  });

  it('resolves :photoId on MilestonesController via the milestone, distinct from the other photo kinds', async () => {
    prisma.milestonePhoto.findUnique.mockResolvedValue({ milestone: { projectId: 'pMs' } });
    const ids = await svc.resolveProjectIds('MilestonesController', { params: { photoId: 'mp1' } });
    expect(ids).toEqual(['pMs']);
    expect(prisma.dailyLogPhoto.findUnique).not.toHaveBeenCalled();
    expect(prisma.unitConstructionStagePhoto.findUnique).not.toHaveBeenCalled();
  });

  it('resolves :updateId on TasksController via the task', async () => {
    prisma.taskUpdate.findUnique.mockResolvedValue({ task: { projectId: 'pTask' } });
    const ids = await svc.resolveProjectIds('TasksController', { params: { updateId: 'tu1' } });
    expect(ids).toEqual(['pTask']);
  });

  it('resolves :interestId on LeadsController via the lead', async () => {
    prisma.leadUnitInterest.findUnique.mockResolvedValue({ lead: { projectId: 'pLead' } });
    const ids = await svc.resolveProjectIds('LeadsController', { params: { interestId: 'li1' } });
    expect(ids).toEqual(['pLead']);
  });

  it('resolves :periodId on LeasesController via the lease', async () => {
    prisma.leaseRentPeriod.findUnique.mockResolvedValue({ leaseId: 'l1' });
    prisma.lease.findUnique.mockResolvedValue(unitLevelLease);
    const ids = await svc.resolveProjectIds('LeasesController', { params: { periodId: 'rp1' } });
    expect(ids).toEqual(['pL']);
  });

  it('reads :id on WebsiteSyncController as a project', async () => {
    const ids = await svc.resolveProjectIds('WebsiteSyncController', { params: { id: 'pWeb' } });
    expect(ids).toEqual(['pWeb']);
  });
});

describe('ProjectAccessGuard — the newly resolved ids are enforced', () => {
  let guard: ProjectAccessGuard;
  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ProjectAccessGuard(new ProjectAccessService(prisma));
    prisma.projectMember.findUnique.mockResolvedValue(null); // not a member of anything
  });

  const asPm = (controller: string, params: Record<string, string>) =>
    ctx({ __controller: controller, user: { sub: 'pm', role: 'PROJECT_MANAGER' }, params });

  it('404s a PM moving another project\'s draw through the legacy loans route', async () => {
    prisma.drawRequest.findUnique.mockResolvedValue({ projectId: 'pOther', loan: null });
    await expect(guard.canActivate(asPm('LoansController', { drawId: 'd1' }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s a Sales user editing another project\'s sale installment', async () => {
    prisma.salePayment.findUnique.mockResolvedValue({ sale: { projectId: 'pOther' } });
    await expect(
      guard.canActivate(ctx({ __controller: 'SalesController', user: { sub: 's', role: 'SALES' }, params: { paymentId: 'sp1' } })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s a PM approving another project\'s change order', async () => {
    prisma.changeOrder.findUnique.mockResolvedValue({ contract: { projectId: 'pOther' } });
    await expect(guard.canActivate(asPm('ContractsController', { changeOrderId: 'co1' }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s a PM pushing another project to the website', async () => {
    await expect(guard.canActivate(asPm('WebsiteSyncController', { id: 'pOther' }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a member through on the same routes', async () => {
    prisma.projectMember.findUnique.mockResolvedValue({ id: 'm1' });
    prisma.taskUpdate.findUnique.mockResolvedValue({ task: { projectId: 'pMine' } });
    await expect(guard.canActivate(asPm('TasksController', { updateId: 'tu1' }))).resolves.toBe(true);
  });
});

describe('ProjectAccessService.projectIdFilter', () => {
  let svc: ProjectAccessService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new ProjectAccessService(prisma);
    prisma.projectMember.findMany.mockResolvedValue([{ projectId: 'p1' }, { projectId: 'p2' }]);
  });

  it('narrows a scoped role with no projectId to its member projects', async () => {
    expect(await svc.projectIdFilter({ sub: 'pm', role: 'PROJECT_MANAGER' })).toEqual({ in: ['p1', 'p2'] });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({ where: { userId: 'pm' }, select: { projectId: true } });
  });

  it('leaves an unscoped role unfiltered (undefined = every project, as before)', async () => {
    expect(await svc.projectIdFilter({ sub: 'f', role: 'FINANCE', roles: ['FINANCE'] })).toBeUndefined();
    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
  });

  it('passes an explicit projectId through untouched — the guard has already checked it', async () => {
    expect(await svc.projectIdFilter({ sub: 'pm', role: 'PROJECT_MANAGER' }, 'p9')).toBe('p9');
    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
  });

  it('scopes a multi-role user whose PRIMARY role is global but who also holds a scoped one', async () => {
    expect(await svc.projectIdFilter({ sub: 'm', role: 'FINANCE', roles: ['FINANCE', 'SALES'] })).toEqual({ in: ['p1', 'p2'] });
  });

  it('gives a scoped role with no memberships an empty set — nothing, not everything', async () => {
    prisma.projectMember.findMany.mockResolvedValue([]);
    expect(await svc.projectIdFilter({ sub: 'pm', role: 'CONSTRUCTION' })).toEqual({ in: [] });
  });

  it('treats an empty ?projectId= as absent rather than as a project', async () => {
    expect(await svc.projectIdFilter({ sub: 'pm', role: 'MARKETING' }, '')).toEqual({ in: ['p1', 'p2'] });
  });
});
