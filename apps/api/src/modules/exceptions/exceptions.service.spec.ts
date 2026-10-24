import { ExceptionsService } from './exceptions.service';

/**
 * The "Needs Attention" feed for a project-scoped role with no ?projectId=.
 *
 * It used to be the whole portfolio for everyone — buyers, tenants and lenders on every
 * project. A scoped role now gets its member projects, computed for that set (compute()
 * caps each category, so filtering the shared portfolio afterwards would drop items).
 */
function make() {
  const prisma: any = {
    milestone: { findMany: jest.fn().mockResolvedValue([]) },
    unit: { findMany: jest.fn().mockResolvedValue([]) },
    drawRequest: { findMany: jest.fn().mockResolvedValue([]) },
    lease: { findMany: jest.fn().mockResolvedValue([]) },
    sale: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const cache = { wrap: jest.fn((_k: string, _t: number, fn: () => unknown) => fn()), invalidateTag: jest.fn() };
  const statusEvents = { currentVacancyStartByUnit: jest.fn().mockResolvedValue(new Map()) };
  const service = new ExceptionsService(prisma, cache as any, { decryptLoan: (l: any) => l } as any, statusEvents as any);
  return { prisma, cache, service };
}

describe('ExceptionsService.forProjects', () => {
  it('runs every category query against the member set', async () => {
    const { prisma, service } = make();
    await service.forProjects(['p2', 'p1'], ['project:view']);
    const member = { in: ['p2', 'p1'] };
    expect(prisma.milestone.findMany.mock.calls[0][0].where.projectId).toEqual(member);
    expect(prisma.unit.findMany.mock.calls[0][0].where.building.projectId).toEqual(member);
    expect(prisma.drawRequest.findMany.mock.calls[0][0].where.projectId).toEqual(member);
    expect(prisma.drawRequest.findMany.mock.calls[1][0].where.projectId).toEqual(member);
    expect(prisma.lease.findMany.mock.calls[0][0].where.unit.building.projectId).toEqual(member);
    expect(prisma.sale.findMany.mock.calls[0][0].where.projectId).toEqual(member);
  });

  it('caches per project SET, so two users with the same projects share one entry', async () => {
    const { cache, service } = make();
    await service.forProjects(['p2', 'p1']);
    await service.forProjects(['p1', 'p2']);
    expect(cache.wrap.mock.calls[0][0]).toBe('exceptions:projects:p1,p2');
    expect(cache.wrap.mock.calls[1][0]).toBe('exceptions:projects:p1,p2');
  });

  it('leaves the unscoped portfolio query unfiltered, as before', async () => {
    const { prisma, service } = make();
    await service.forPortfolio();
    expect(prisma.milestone.findMany.mock.calls[0][0].where.projectId).toBeUndefined();
  });
});
