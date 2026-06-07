import { NotFoundException } from '@nestjs/common';
import { ProjectAccessService } from './project-access.service';
import { ProjectAccessGuard } from './project-access.guard';

const prisma: any = {
  projectMember: { findMany: jest.fn(), findUnique: jest.fn() },
  unit: { findUnique: jest.fn() },
  sale: { findUnique: jest.fn() },
  building: { findUnique: jest.fn() },
};

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

  it('allows a scoped user when no project context resolves (service filters instead)', async () => {
    const ok = await guard.canActivate(ctx({ user: { sub: 'pm', role: 'SALES' }, query: {} }));
    expect(ok).toBe(true);
  });
});
