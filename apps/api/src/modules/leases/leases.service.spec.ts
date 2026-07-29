import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeasesService } from './leases.service';

const mockPrisma: any = {
  lease: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  leaseRentPeriod: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  // resolveProjectId walks unit -> building -> project (or building -> project) so
  // lease events can be routed to the right project's members.
  unit: {
    findUnique: jest.fn().mockResolvedValue({ building: { projectId: 'p1' } }),
  },
  building: {
    findUnique: jest.fn().mockResolvedValue({ projectId: 'p1' }),
  },
};

const mockRentPeriods: any = {
  generateForLease: jest.fn().mockResolvedValue([]),
};

const mockBus: any = { emit: jest.fn() };

function makeService() {
  return new LeasesService(mockPrisma as any, mockRentPeriods as any, mockBus as any);
}

describe('LeasesService.delete — soft delete (preserves unit history)', () => {
  let service: LeasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('soft-deletes via update(deletedAt) instead of a hard Prisma delete', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({ id: 'l1', unitId: 'u1', status: 'EXPIRED' });
    mockPrisma.lease.update.mockResolvedValue({ id: 'l1', deletedAt: new Date() });
    expect(mockPrisma.lease.delete).toBeUndefined(); // never wired up — nothing in this service should call it

    await service.delete('l1');

    expect(mockPrisma.lease.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('a soft-deleted lease reads back as not-found', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({ id: 'l1', deletedAt: new Date() });
    await expect(service.findById('l1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LeasesService.create — active-lease uniqueness ignores soft-deleted rows', () => {
  let service: LeasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  const validData = {
    unitId: 'u1',
    tenantName: 'Acme',
    monthlyRent: 1000,
    leaseStart: '2026-01-01',
    leaseEnd: '2027-01-01',
    termMonths: 12,
  } as any;

  it('allows a new lease when the only "active" row for the unit was soft-deleted', async () => {
    // findFirst is called with deletedAt: null — simulate the DB correctly excluding
    // the soft-deleted row by having the mock only match on that filter.
    mockPrisma.lease.findFirst.mockImplementation((args: any) =>
      args.where.deletedAt === null ? Promise.resolve(null) : Promise.resolve({ id: 'stale' }),
    );
    mockPrisma.lease.create.mockResolvedValue({ id: 'l2', ...validData });

    const result = await service.create(validData);

    expect(mockPrisma.lease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ unitId: 'u1', deletedAt: null }) }),
    );
    expect(result.id).toBe('l2');
  });

  it('still blocks creation when a genuinely active (non-deleted) lease exists', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue({ id: 'active-lease' });
    await expect(service.create(validData)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.lease.create).not.toHaveBeenCalled();
  });
});

describe('LeasesService.create — rent schedule generation is non-fatal', () => {
  let service: LeasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([]);
    mockRentPeriods.generateForLease.mockResolvedValue([]);
    service = makeService();
  });

  const validData = {
    unitId: 'u1', tenantName: 'Acme', monthlyRent: 1000,
    leaseStart: '2026-01-01', leaseEnd: '2027-01-01', termMonths: 12,
  } as any;

  it('generates the rent schedule after the lease row is created', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockResolvedValue({ id: 'l1', ...validData });

    await service.create(validData, 'user-1');

    expect(mockRentPeriods.generateForLease).toHaveBeenCalledWith('l1', {
      createdById: 'user-1', force: false,
    });
  });

  it('still returns the lease when schedule generation throws — the user does not lose their entry', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockResolvedValue({ id: 'l1', ...validData });
    mockRentPeriods.generateForLease.mockRejectedValue(new Error('boom'));

    const result = await service.create(validData);

    expect(result.id).toBe('l1');
  });
});

describe('LeasesService.getRentRoll — effective rent, not flat monthlyRent', () => {
  let service: LeasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  const lease = (id: string, monthlyRent: number) => ({
    id, monthlyRent, unitId: 'u' + id, unit: null, building: null,
  });

  it('falls back to monthlyRent when a lease has no generated periods (existing data is unaffected)', async () => {
    mockPrisma.lease.findMany.mockResolvedValue([lease('l1', 1000), lease('l2', 500)]);
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([]);

    const rr = await service.getRentRoll('p1');

    expect(rr.totalMonthlyRent).toBe(1500);
    expect(rr.contractedMonthlyRent).toBe(1500);
    expect(rr.freeRentLeaseCount).toBe(0);
  });

  it('a lease inside a free-rent period contributes 0 to the effective roll but keeps its contracted rent', async () => {
    mockPrisma.lease.findMany.mockResolvedValue([lease('l1', 1000), lease('l2', 500)]);
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([
      {
        leaseId: 'l1', sequence: 1, monthlyRent: 0, isFreeRent: true,
        startDate: new Date('2026-01-01'), endDate: new Date('2030-01-01'),
      },
    ]);

    const rr = await service.getRentRoll('p1', new Date('2026-06-01'));

    expect(rr.totalMonthlyRent).toBe(500);
    expect(rr.contractedMonthlyRent).toBe(1500);
    expect(rr.freeRentLeaseCount).toBe(1);
  });

  it('uses the escalated period rent rather than the stale headline rent', async () => {
    mockPrisma.lease.findMany.mockResolvedValue([lease('l1', 1000)]);
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([
      {
        leaseId: 'l1', sequence: 2, monthlyRent: 1050, isFreeRent: false,
        startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31'),
      },
    ]);

    const rr = await service.getRentRoll('p1', new Date('2027-06-01'));

    expect(rr.totalMonthlyRent).toBe(1050);
    expect(rr.contractedMonthlyRent).toBe(1000);
  });

  it('latest-start-wins: a superseding manual period beats an earlier row still claiming a later endDate', async () => {
    mockPrisma.lease.findMany.mockResolvedValue([lease('l1', 1000)]);
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([
      {
        leaseId: 'l1', sequence: 9, monthlyRent: 1200, isFreeRent: false,
        startDate: new Date('2027-03-01'), endDate: null,
      },
      {
        leaseId: 'l1', sequence: 1, monthlyRent: 1000, isFreeRent: false,
        startDate: new Date('2026-01-01'), endDate: new Date('2029-01-01'),
      },
    ]);

    const rr = await service.getRentRoll('p1', new Date('2027-06-01'));

    expect(rr.totalMonthlyRent).toBe(1200);
  });

  it('skips a period that ended before the as-of date and uses the earlier covering one', async () => {
    mockPrisma.lease.findMany.mockResolvedValue([lease('l1', 1000)]);
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([
      {
        leaseId: 'l1', sequence: 2, monthlyRent: 1050, isFreeRent: false,
        startDate: new Date('2027-01-01'), endDate: new Date('2027-02-01'),
      },
      {
        leaseId: 'l1', sequence: 1, monthlyRent: 900, isFreeRent: false,
        startDate: new Date('2026-01-01'), endDate: new Date('2030-01-01'),
      },
    ]);

    const rr = await service.getRentRoll('p1', new Date('2027-06-01'));

    expect(rr.totalMonthlyRent).toBe(900);
  });
});

describe('LeasesService — domain events for notification routing', () => {
  let service: LeasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([]);
    mockRentPeriods.generateForLease.mockResolvedValue([]);
    mockPrisma.unit.findUnique.mockResolvedValue({ building: { projectId: 'p1' } });
    mockPrisma.building.findUnique.mockResolvedValue({ projectId: 'p1' });
    service = makeService();
  });

  const base = {
    unitId: 'u1', buildingId: null, tenantName: 'Acme', monthlyRent: 1000,
    leaseStart: '2026-01-01', leaseEnd: '2027-01-01', termMonths: 12,
  } as any;

  it('emits lease.created with a resolved projectId', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockResolvedValue({ id: 'l1', ...base, status: 'DRAFT' });

    await service.create(base);

    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lease.created', leaseId: 'l1', projectId: 'p1' }),
    );
  });

  it('a lease created straight as ACTIVE also emits lease.activated (it never passes through update)', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockResolvedValue({ id: 'l1', ...base, status: 'ACTIVE' });

    await service.create({ ...base, status: 'ACTIVE' });

    const types = mockBus.emit.mock.calls.map((c: any[]) => c[0].type);
    expect(types).toContain('lease.created');
    expect(types).toContain('lease.activated');
  });

  it('resolves projectId through the building for a building-level lease', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockResolvedValue({ id: 'l2', ...base, unitId: null, buildingId: 'b1', status: 'DRAFT' });

    await service.create({ ...base, unitId: undefined, buildingId: 'b1' });

    expect(mockPrisma.building.findUnique).toHaveBeenCalled();
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lease.created', projectId: 'p1' }),
    );
  });

  it('emits lease.terminated on a status change to TERMINATED', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({ id: 'l1', ...base, status: 'ACTIVE', deletedAt: null });
    mockPrisma.lease.update.mockResolvedValue({ id: 'l1', ...base, status: 'TERMINATED' });

    await service.update('l1', { status: 'TERMINATED' });

    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lease.terminated', leaseId: 'l1', projectId: 'p1' }),
    );
  });

  it('emits lease.rentChanged with both the old and new rent', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({ id: 'l1', ...base, monthlyRent: 1000, status: 'ACTIVE', deletedAt: null });
    mockPrisma.lease.update.mockResolvedValue({ id: 'l1', ...base, monthlyRent: 1200, status: 'ACTIVE' });

    await service.update('l1', { monthlyRent: 1200 });

    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lease.rentChanged', from: 1000, to: 1200, source: 'MANUAL' }),
    );
  });

  it('does not emit a rent change when the rent did not actually move', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({ id: 'l1', ...base, monthlyRent: 1000, status: 'ACTIVE', deletedAt: null });
    mockPrisma.lease.update.mockResolvedValue({ id: 'l1', ...base, monthlyRent: 1000, status: 'ACTIVE' });

    await service.update('l1', { monthlyRent: 1000 });

    const types = mockBus.emit.mock.calls.map((c: any[]) => c[0].type);
    expect(types).not.toContain('lease.rentChanged');
  });
});
