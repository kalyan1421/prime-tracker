import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeasesService } from './leases.service';
import { HistoricalDeletionService } from '../../common/utils/historical-deletion.service';

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
  // R27 — the Founder approval gate on deleting a backfilled tenancy. Defaults are the
  // "no request exists" answers, which is what every non-historical lease sees.
  historicalRecordDeletion: {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
  },
  // resolveProjectId walks unit -> building -> project (or building -> project) so
  // lease events can be routed to the right project's members.
  //
  // `status: 'LEASED'` is the DEFAULT on purpose: create/update now sync the unit from
  // the lease inside their transaction, and a unit that already reads LEASED makes that
  // a no-op. Tests about overlap, schedules or events therefore stay about those things.
  // The sync's own describe overrides this per case.
  unit: {
    findUnique: jest.fn().mockResolvedValue({ building: { projectId: 'p1' }, status: 'LEASED' }),
    update: jest.fn(),
  },
  building: {
    findUnique: jest.fn().mockResolvedValue({ projectId: 'p1' }),
  },
  // The lease write and the unit sync share one transaction. Passing mockPrisma straight
  // through keeps every existing assertion on `mockPrisma.lease.create` valid.
  $transaction: jest.fn((fn: any) =>
    typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn)),
};

const mockRentPeriods: any = {
  generateForLease: jest.fn().mockResolvedValue([]),
};

const mockBus: any = { emit: jest.fn() };

// Obligation ledger double. LeasesService seeds a deposit/NNN obligation from the
// lease's headline terms — a spy is enough here, and the seeding itself is asserted
// in its own describe below.
const mockObligations: any = { create: jest.fn(), update: jest.fn() };

// Audit double — LeasesService records a real diff of the lease terms for the unit's
// history. Asserted in its own describe below.
const mockAudit: any = { log: jest.fn() };

// Invoice ledger double. endTenancy asks it two questions — "is there money after the
// move-out date?" and "void what is left" — so the defaults are the benign answers.
const mockInvoices: any = {
  paidAfter: jest.fn().mockResolvedValue([]),
  voidAfter: jest.fn().mockResolvedValue(0),
};

// The unit occupancy log. Not a spy-and-forget: a tenancy that ends without writing
// here is exactly the R8 hole, so several tests assert against it.
const mockStatusEvents: any = {
  record: jest.fn().mockResolvedValue({ id: 'evt1' }),
};

// R7 — commission installment sync. A spy is enough here; its own behavior (create vs
// adjust vs leave-alone) is asserted in commission-installment.service.spec.ts.
const mockCommissionInstallments: any = {
  syncStampedAmount: jest.fn().mockResolvedValue(undefined),
};

// R6 — a real HistoricalDeletionService over the same mockPrisma, not a hand double: the
// "delete gate" / "requesting" tests below assert against mockPrisma.historicalRecordDeletion
// calls, and this is what makes those calls actually happen the same way they used to when
// the logic lived inline in LeasesService.
const mockHistoricalDeletions = new HistoricalDeletionService(mockPrisma as any);

function makeService() {
  return new LeasesService(
    mockPrisma as any, mockRentPeriods as any, mockBus as any,
    mockObligations as any, mockAudit as any,
    mockInvoices as any, mockStatusEvents as any, mockCommissionInstallments as any,
    mockHistoricalDeletions as any,
  );
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

// The old rule here was "at most one lease per unit outside (EXPIRED, TERMINATED)",
// backed by the partial unique index lease_unit_active_unique. That was a proxy for
// "no double-booking" which made unit history impossible to enter: a unit with a past
// tenancy already had a lease, so the second one was refused whatever its dates.
//
// Migration 20260812000000 replaced it with a daterange exclusion constraint, and the
// service check below mirrors it. These tests pin the semantics that actually matter:
// overlapping is refused, non-overlapping is allowed, and touching endpoints are fine.
describe('LeasesService.create — lease overlap on a unit', () => {
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

  /** The overlap probe is the only findFirst on the create path. */
  const overlapProbe = () => mockPrisma.lease.findFirst.mock.calls[0][0];
  /**
   * The occupied-range branch of the probe. It sits inside `where.AND` alongside the
   * SPACE filter (this unit, plus the building containing it — a lease may be attached
   * to either). Both are OR-shaped, so they cannot both be top-level `OR` keys: the
   * second would overwrite the first and the probe would match leases anywhere.
   */
  const occupiedRangeOr = () =>
    (overlapProbe().where.AND as any[]).find((c) => Array.isArray(c.OR) && 'terminationDate' in c.OR[0]).OR;

  it('allows a new lease when the only overlapping row for the unit was soft-deleted', async () => {
    // findFirst is called with deletedAt: null — simulate the DB correctly excluding
    // the soft-deleted row by having the mock only match on that filter.
    mockPrisma.lease.findFirst.mockImplementation((args: any) =>
      args.where.deletedAt === null ? Promise.resolve(null) : Promise.resolve({ id: 'stale' }),
    );
    mockPrisma.lease.create.mockResolvedValue({ id: 'l2', ...validData });

    const result = await service.create(validData);

    // deletedAt stays top-level; the unit itself is now one arm of `where.AND` — the
    // space filter, which also covers a lease attached to the whole building.
    expect(overlapProbe().where.deletedAt).toBeNull();
    expect(overlapProbe().where.AND).toContainEqual(
      expect.objectContaining({ unitId: 'u1' }),
    );
    expect(result.id).toBe('l2');
  });

  it('blocks creation when the dates overlap an existing tenancy, naming it', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue({
      id: 'sitting',
      tenantName: 'Acme Holdings LLC',
      tenantBrand: 'Cream Stone',
      leaseStart: new Date('2026-06-01'),
      leaseEnd: new Date('2028-06-01'),
      status: 'ACTIVE',
    });

    await expect(service.create(validData)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.lease.create).not.toHaveBeenCalled();

    // The message has to identify the conflict, or the user cannot act on it.
    await expect(service.create(validData)).rejects.toThrow(/Cream Stone/);
    await expect(service.create(validData)).rejects.toThrow(/2026-06-01 to 2028-06-01/);
  });

  it('probes with a half-open range so a lease may start the day another ends', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockResolvedValue({ id: 'l3', ...validData });

    await service.create(validData);

    // lt/gt (not lte/gte) is what makes touching endpoints legal — same as the DB's
    // '[)' daterange bounds. Same-day turnover is real and must not be refused.
    expect(overlapProbe().where.leaseStart).toEqual({ lt: new Date('2027-01-01') });
    // The end of the occupied range is COALESCE(terminationDate, leaseEnd), which Prisma
    // cannot express as a filter — so it is spelled out as two disjoint cases.
    expect(occupiedRangeOr()).toEqual([
      { terminationDate: null, leaseEnd: { gt: new Date('2026-01-01') } },
      { terminationDate: { gt: new Date('2026-01-01') } },
    ]);
  });

  /**
   * A lease is polymorphic, and the two levels occupy the same physical space. Until
   * 2026-08-25 the probe only ever looked at the unit, so a building-level lease was
   * checked against nothing — two tenants could hold one building over identical dates,
   * and a building could be let whole while its units were let separately.
   */
  it('checks a unit lease against leases on the building containing it', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue({ buildingId: 'b1' });
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockResolvedValue({ id: 'l9', ...validData });

    await service.create(validData);

    const space = (overlapProbe().where.AND as any[])[0];
    expect(space.OR).toEqual([{ unitId: 'u1' }, { buildingId: 'b1' }]);
  });

  it('checks a building lease against leases on the units inside it', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockResolvedValue({ id: 'l10' });

    const { unitId, ...withoutUnit } = validData as any;
    await service.create({ ...withoutUnit, buildingId: 'b1' });

    const space = (overlapProbe().where.AND as any[])[0];
    expect(space.OR).toEqual([{ buildingId: 'b1' }, { unit: { buildingId: 'b1' } }]);
  });

  it('judges a terminated neighbour on its move-out date, not its contracted end', async () => {
    // The blocking defect this whole change exists to fix. A predecessor that ended
    // early still carries a leaseEnd years out; probing against that would refuse the
    // successor the database is now perfectly willing to accept.
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockResolvedValue({ id: 'l5', ...validData });

    await service.create(validData);

    const or = occupiedRangeOr();
    // A live lease is judged on leaseEnd; a terminated one on terminationDate. `{ gt }`
    // never matches NULL, so the two branches cannot both claim the same row.
    expect(or[0]).toHaveProperty('terminationDate', null);
    expect(or[1].terminationDate).toEqual({ gt: new Date('2026-01-01') });
  });

  it('names the conflicting range using the move-out date when the neighbour ended early', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue({
      id: 'sitting',
      tenantName: 'Acme Holdings LLC',
      tenantBrand: 'Cream Stone',
      leaseStart: new Date('2026-06-01'),
      leaseEnd: new Date('2032-06-01'),
      terminationDate: new Date('2028-06-01'),
      status: 'TERMINATED',
    });

    // Reporting the contracted 2032 end would tell the user to avoid dates the unit is
    // not actually occupied on.
    await expect(service.create(validData)).rejects.toThrow(/2026-06-01 to 2028-06-01/);
  });

  it('rejects a move-out date before the lease start with a 400, not the DB CHECK', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue(null);

    await expect(
      service.create({ ...validData, terminationDate: new Date('2025-01-01') }),
    ).rejects.toThrow(/Move-out date cannot be before the lease start/);
    expect(mockPrisma.lease.create).not.toHaveBeenCalled();
  });

  it('translates the termination CHECK violation into a 400', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockRejectedValue(
      new Error('violates check constraint "lease_termination_after_start"'),
    );

    await expect(service.create(validData)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a historical tenancy that ended before the new one starts', async () => {
    // The case the old active-lease rule made impossible. The probe finds nothing
    // because the past lease's range does not intersect the new one.
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockResolvedValue({ id: 'l4', ...validData });

    await expect(service.create(validData)).resolves.toMatchObject({ id: 'l4' });
  });

  it('rejects an end date that is not after the start date', async () => {
    await expect(
      service.create({ ...validData, leaseStart: '2026-06-01', leaseEnd: '2026-06-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.lease.create).not.toHaveBeenCalled();
  });

  it('translates the DB exclusion-constraint violation into a 400, not a 500', async () => {
    // The service probe can lose a race; the constraint is the real enforcement, and
    // Prisma surfaces it as an opaque driver error with no dedicated code.
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockRejectedValue(
      new Error('conflicting key value violates exclusion constraint "lease_unit_no_overlap"'),
    );

    await expect(service.create(validData)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('re-throws unrelated database errors untouched', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    const boom = new Error('connection terminated');
    mockPrisma.lease.create.mockRejectedValue(boom);

    await expect(service.create(validData)).rejects.toBe(boom);
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

describe('LeasesService.getRentRoll — sold units drop out of the roll', () => {
  it('filters out leases whose unit is SOLD', async () => {
    const service = makeService();
    mockPrisma.lease.findMany.mockResolvedValue([]);
    mockPrisma.leaseRentPeriod.findMany?.mockResolvedValue?.([]);

    await service.getRentRoll('p1');

    // A lease survives its unit being sold (history), but Prime does not collect that
    // rent, so it must not inflate the reported roll. Six live leases on sold units
    // were adding $27,626/mo — 39% of the total.
    const where = mockPrisma.lease.findMany.mock.calls[0][0].where;
    expect(where.NOT).toEqual({ unit: { status: 'SOLD' } });
    // The project-scoping OR must survive alongside it.
    expect(where.OR).toBeDefined();
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

// ---------------------------------------------------------------------------
// H1b — rent commencement, derived term, NNN per sqft
//
// `leaseStart` is legal commencement; rent may start later, after fit-out. Before
// this, the schedule and the invoice ledger both used leaseStart as their origin, so
// a lease signed in January with rent starting in April generated three months of
// periods and three months of DUE invoices the tenant never owed.
// ---------------------------------------------------------------------------
describe('LeasesService — rent commencement, derived term and NNN per sqft', () => {
  let service: LeasesService;

  const base = {
    unitId: 'u1',
    tenantName: 'Acme',
    monthlyRent: 10000,
    leaseStart: '2026-01-01',
    leaseEnd: '2029-01-01',
    termMonths: 999, // deliberately wrong — must be overwritten
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockImplementation((args: any) => Promise.resolve({ id: 'l1', ...args.data }));
    mockPrisma.unit = { findUnique: jest.fn().mockResolvedValue({ sqft: 2000 }) };
  });

  /** The data Prisma was actually asked to write. */
  const written = () => mockPrisma.lease.create.mock.calls[0][0].data;

  it('derives termMonths from the dates and ignores what the caller sent', () => {
    // termMonths silently drove the effective-rent KPI (summariseEffectiveRent prefers
    // it over what the periods cover), so a typo skewed reporting with nothing to
    // notice it by. It is now a function of the dates, not an input.
    return service.create({ ...base }).then(() => {
      expect(written().termMonths).toBe(36);
    });
  });

  it('measures the term from RENT commencement, not legal commencement', async () => {
    // 3-month fit-out then 33 months of rent — the term is what is billed.
    await service.create({ ...base, rentStartDate: '2026-04-01' });
    expect(written().termMonths).toBe(33);
  });

  it('coerces rentStartDate to a Date, like the other date fields', async () => {
    await service.create({ ...base, rentStartDate: '2026-04-01' });
    expect(written().rentStartDate).toBeInstanceOf(Date);
  });

  it('refuses a rent start before the lease start', async () => {
    await expect(
      service.create({ ...base, rentStartDate: '2025-12-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.lease.create).not.toHaveBeenCalled();
  });

  it('accepts rent starting on the same day the lease does', async () => {
    await service.create({ ...base, rentStartDate: '2026-01-01' });
    expect(written().termMonths).toBe(36);
  });

  // nnnPerSqft is the quoted ANNUAL rate; nnnTotalAmount is that rate against the
  // unit's area, still stored as a headline TERM on the lease. As of 2026-08-21 the
  // money itself is billed monthly (nnnTotalAmount / 12) via LeaseRentPeriod.nnnAmount,
  // not as a one-time obligation — see lease-rent-period.service.ts.
  it('derives the NNN total from the per-sqft rate and the unit area', async () => {
    await service.create({ ...base, nnnPerSqft: 0.5 });
    expect(mockPrisma.unit.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' } }),
    );
    expect(written().nnnTotalAmount).toBe(1000); // 0.50 x 2000 sqft
  });

  it('lets an explicit total override the derived figure', async () => {
    // Some leases are quoted as a flat sum rather than a rate.
    await service.create({ ...base, nnnPerSqft: 0.5, nnnTotalAmount: 1234 });
    expect(written().nnnTotalAmount).toBe(1234);
  });

  it('clears the NNN total when the rate is cleared', async () => {
    await service.create({ ...base, nnnPerSqft: null });
    expect(written().nnnTotalAmount).toBeNull();
  });

  it('leaves NNN alone when no rate is given, so existing leases are untouched', async () => {
    await service.create({ ...base });
    expect(written().nnnTotalAmount).toBeUndefined();
  });

  it('cannot derive an NNN total for a building-level lease', async () => {
    // No unit means no sqft to multiply by. Better to leave it unset than to invent one.
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    await service.create({ ...base, unitId: undefined, buildingId: 'b1', nnnPerSqft: 0.5 });
    expect(written().nnnTotalAmount).toBeUndefined();
  });

  it('never folds NNN into Lease.monthlyRent — it is a separate headline term', async () => {
    // monthlyRent is base rent only. NNN bills monthly too, but through the rent
    // PERIOD's separate nnnAmount column, never by inflating this field.
    await service.create({ ...base, nnnPerSqft: 0.5 });
    expect(Number(written().monthlyRent)).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// R23 — leasing commission
//
// Broker + commission existed on Sale and Lead but not on Lease, so there was nowhere
// to record who brought a tenant. Mirrors the sale shape, with one addition: a sale
// has one obvious base (the price), a lease does not — hence an explicit basis.
// ---------------------------------------------------------------------------
describe('LeasesService — leasing commission', () => {
  let service: LeasesService;

  const BROKER = { commissionRate: 5, commissionFlat: 2500 };

  const draft = {
    unitId: 'u1', tenantName: 'Acme', monthlyRent: 10000,
    leaseStart: '2026-01-01', leaseEnd: '2029-01-01',
    brokerId: 'b1',
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockImplementation((args: any) => Promise.resolve({ id: 'l1', ...args.data }));
    // sqft drives the NNN-per-sqft derivation these tests are about. `status: 'LEASED'`
    // and `update` are here so the unit sync that now shares create's transaction is a
    // no-op — these cases are about the commission, not about the unit.
    mockPrisma.unit = {
      findUnique: jest.fn().mockResolvedValue({ sqft: 2000, building: { projectId: 'p1' }, status: 'LEASED' }),
      update: jest.fn(),
    };
    mockPrisma.broker = { findUnique: jest.fn().mockResolvedValue(BROKER) };
  });

  const written = () => mockPrisma.lease.create.mock.calls[0][0].data;

  it('does not stamp a commission on a DRAFT lease', async () => {
    // Naming a broker is not the same as owing them — the fee is earned on activation,
    // mirroring the sale side's stamp-on-close.
    await service.create({ ...draft, status: 'DRAFT', brokerCommissionBasis: 'FIRST_MONTH_RENT' });
    expect(written().brokerCommissionAmt).toBeUndefined();
  });

  it('stamps the fee when the lease is created ACTIVE', async () => {
    await service.create({ ...draft, status: 'ACTIVE', brokerCommissionBasis: 'FIRST_MONTH_RENT' });
    expect(written().brokerCommissionAmt).toBe(500); // 5% of one month's $10,000
  });

  it('commissions the whole term on a TOTAL_TERM_RENT basis', async () => {
    await service.create({ ...draft, status: 'ACTIVE', brokerCommissionBasis: 'TOTAL_TERM_RENT' });
    // 36 months (derived) x $10,000 x 5%
    expect(written().brokerCommissionAmt).toBe(18000);
  });

  it('uses the DERIVED term, so a fit-out gap is not commissioned', async () => {
    // 3 months of fit-out means 33 billable months, and the broker is paid on what the
    // tenant actually pays — not on the paper length of the lease.
    await service.create({
      ...draft, status: 'ACTIVE', rentStartDate: '2026-04-01', brokerCommissionBasis: 'TOTAL_TERM_RENT',
    });
    expect(written().brokerCommissionAmt).toBe(16500); // 33 x 10000 x 5%
  });

  it('takes the flat fee on a FLAT basis, ignoring any percentage', async () => {
    await service.create({
      ...draft, status: 'ACTIVE', brokerCommissionBasis: 'FLAT', brokerCommissionPct: 99,
    });
    expect(written().brokerCommissionAmt).toBe(2500);
  });

  it('prefers a per-lease percentage over the broker default', async () => {
    await service.create({
      ...draft, status: 'ACTIVE', brokerCommissionBasis: 'FIRST_MONTH_RENT', brokerCommissionPct: 10,
    });
    expect(written().brokerCommissionAmt).toBe(1000);
  });

  it('computes nothing when the basis is unknown', async () => {
    // Q12 is unanswered, so a lease can legitimately name a broker without anyone yet
    // knowing how the fee is calculated. Leaving it unstamped is honest; guessing a
    // base would put a wrong number in a report someone might pay against.
    await service.create({ ...draft, status: 'ACTIVE' });
    expect(written().brokerCommissionAmt).toBeUndefined();
  });

  it('computes nothing when no broker is attached', async () => {
    await service.create({ ...draft, brokerId: undefined, status: 'ACTIVE', brokerCommissionBasis: 'FLAT' });
    expect(written().brokerCommissionAmt).toBeUndefined();
  });

  it('respects an explicitly supplied amount over the computed one', async () => {
    await service.create({
      ...draft, status: 'ACTIVE', brokerCommissionBasis: 'FIRST_MONTH_RENT', brokerCommissionAmt: 777,
    });
    expect(written().brokerCommissionAmt).toBe(777);
  });

  describe('on update', () => {
    const activeLease = {
      id: 'l1', unitId: 'u1', status: 'ACTIVE', brokerId: 'b1',
      monthlyRent: 10000, termMonths: 36,
      brokerCommissionPct: null, brokerCommissionBasis: 'FIRST_MONTH_RENT',
      leaseStart: new Date('2026-01-01'), rentStartDate: null, leaseEnd: new Date('2029-01-01'),
      deletedAt: null,
    };

    beforeEach(() => {
      mockPrisma.lease.findUnique.mockResolvedValue(activeLease);
      mockPrisma.lease.update.mockImplementation((args: any) =>
        Promise.resolve({ ...activeLease, ...args.data }));
    });

    const updated = () => mockPrisma.lease.update.mock.calls[0][0].data;

    it('stamps on activation', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue({ ...activeLease, status: 'DRAFT' });
      await service.update('l1', { status: 'ACTIVE' } as any);
      expect(updated().brokerCommissionAmt).toBe(500);
    });

    it('re-stamps when a commission input changes on an already-active lease', async () => {
      // Otherwise correcting the rate after activation leaves the old figure behind —
      // the staleness the sale side guards against.
      await service.update('l1', { brokerCommissionPct: 10 } as any);
      expect(updated().brokerCommissionAmt).toBe(1000);
    });

    it('re-stamps when the rent changes', async () => {
      await service.update('l1', { monthlyRent: 20000 } as any);
      expect(updated().brokerCommissionAmt).toBe(1000);
    });

    it('clears the stamped fee when the broker is removed', async () => {
      await service.update('l1', { brokerId: null } as any);
      expect(updated().brokerCommissionAmt).toBeNull();
    });

    it('leaves the fee alone on an edit that touches nothing to do with it', async () => {
      await service.update('l1', { notes: 'renewal discussed' } as any);
      expect(updated().brokerCommissionAmt).toBeUndefined();
    });
  });
});

// Regression: `normaliseTermAndNnn` derives and writes termMonths on EVERY update, so
// a presence-based "did a commission input change?" check treated every edit as a
// commission change. That silently recomputed a manually negotiated commission back to
// the formula value — the override was only safe until someone edited the notes.
describe('LeasesService — a manual commission override survives unrelated edits', () => {
  let service: LeasesService;

  const activeLease = {
    id: 'l1', unitId: 'u1', status: 'ACTIVE', brokerId: 'b1',
    monthlyRent: 10000, termMonths: 36,
    brokerCommissionPct: null, brokerCommissionBasis: 'FIRST_MONTH_RENT',
    brokerCommissionAmt: 4242, // negotiated by hand, not the formula's 500
    leaseStart: new Date('2026-01-01'), rentStartDate: null, leaseEnd: new Date('2029-01-01'),
    deletedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lease.findUnique.mockResolvedValue(activeLease);
    mockPrisma.lease.update.mockImplementation((args: any) =>
      Promise.resolve({ ...activeLease, ...args.data }));
    // sqft drives the NNN-per-sqft derivation these tests are about. `status: 'LEASED'`
    // and `update` are here so the unit sync that now shares create's transaction is a
    // no-op — these cases are about the commission, not about the unit.
    mockPrisma.unit = {
      findUnique: jest.fn().mockResolvedValue({ sqft: 2000, building: { projectId: 'p1' }, status: 'LEASED' }),
      update: jest.fn(),
    };
    mockPrisma.broker = { findUnique: jest.fn().mockResolvedValue({ commissionRate: 5, commissionFlat: 2500 }) };
  });

  const updated = () => mockPrisma.lease.update.mock.calls[0][0].data;

  it('does not recompute the fee when only the notes change', async () => {
    await service.update('l1', { notes: 'renewal discussed' } as any);
    expect(updated().brokerCommissionAmt).toBeUndefined();
  });

  it('does not recompute when the dates are re-submitted unchanged', async () => {
    // The form posts every field on every save, so "unchanged" is the common case.
    await service.update('l1', {
      leaseStart: new Date('2026-01-01'), leaseEnd: new Date('2029-01-01'),
    } as any);
    expect(updated().brokerCommissionAmt).toBeUndefined();
  });

  it('DOES recompute when the term genuinely moves', async () => {
    await service.update('l1', { leaseEnd: new Date('2028-01-01') } as any);
    expect(updated().brokerCommissionAmt).toBe(500);
  });
});


// ---------------------------------------------------------------------------
// Headline terms -> obligation ledger
//
// Reported from the UI: a deposit typed into the lease form never appeared in the
// Deposits & Allowances panel, which read "$0 agreed across 0 items". The two were
// different records — `Lease.securityDeposit` was a number on the lease row, while the
// panel reads LeaseObligation — and nothing said so. The deposit was recorded and
// simultaneously untracked.
// ---------------------------------------------------------------------------
describe('LeasesService — seeding obligations from the lease terms', () => {
  let service: LeasesService;

  const withDeposit = {
    unitId: 'u1', tenantName: 'Acme', monthlyRent: 3400,
    leaseStart: '2026-08-12', leaseEnd: '2027-07-13', status: 'ACTIVE',
    securityDeposit: 5000,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lease.findFirst.mockResolvedValue(null);
    mockPrisma.lease.create.mockImplementation((a: any) => Promise.resolve({ id: 'l1', ...a.data }));
    mockPrisma.leaseObligation = { findFirst: jest.fn().mockResolvedValue(null) };
    mockPrisma.unit.findUnique.mockResolvedValue({ sqft: 1000, building: { projectId: 'p1' } });
  });

  it('creates a deposit obligation from the amount on the lease form', async () => {
    await service.create({ ...withDeposit });
    expect(mockObligations.create).toHaveBeenCalledWith(
      expect.objectContaining({ leaseId: 'l1', kind: 'SECURITY_DEPOSIT', totalAmount: 5000 }),
    );
  });

  it('creates a TI allowance obligation pointing OUT to the tenant', async () => {
    // TI is the only one of the three headline sums that Prime OWES. A shared
    // FROM_TENANT direction would file a disbursement under "money in".
    await service.create({ ...withDeposit, securityDeposit: undefined, tiAllowance: 45000 });
    expect(mockObligations.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'TI_ALLOWANCE', direction: 'TO_TENANT', totalAmount: 45000 }),
    );
  });

  it('seeds both agreed sums from one lease', async () => {
    await service.create({ ...withDeposit, nnnTotalAmount: 2000, tiAllowance: 45000 });
    const kinds = mockObligations.create.mock.calls.map((c: any[]) => c[0].kind).sort();
    expect(kinds).toEqual(['SECURITY_DEPOSIT', 'TI_ALLOWANCE']);
  });

  it('never creates an NNN obligation — NNN bills monthly via the rent schedule, not the ledger', async () => {
    // Reversed 2026-08-21: NNN obligations were only ever created between 2026-08-12
    // and this reversal. See prisma/fix-nnn-monthly-migration.ts for the leases that
    // signed in that window.
    await service.create({ ...withDeposit, securityDeposit: undefined, nnnTotalAmount: 2000 });
    expect(mockObligations.create).not.toHaveBeenCalled();
  });

  it('seeds nothing when no money terms were entered', async () => {
    await service.create({ ...withDeposit, securityDeposit: undefined });
    expect(mockObligations.create).not.toHaveBeenCalled();
  });

  it('ignores a zero deposit rather than creating an empty obligation', async () => {
    await service.create({ ...withDeposit, securityDeposit: 0 });
    expect(mockObligations.create).not.toHaveBeenCalled();
  });

  it('never fails the lease save when the ledger cannot be seeded', async () => {
    // A lease is the record of a signed agreement. It must not be lost because a
    // downstream bookkeeping row could not be written.
    mockObligations.create.mockRejectedValue(new Error('db down'));
    await expect(service.create({ ...withDeposit })).resolves.toMatchObject({ id: 'l1' });
  });

  describe('on edit', () => {
    const stored = {
      id: 'l1', unitId: 'u1', status: 'ACTIVE', monthlyRent: 3400, termMonths: 11,
      leaseStart: new Date('2026-08-12'), rentStartDate: null, leaseEnd: new Date('2027-07-13'),
      deletedAt: null,
    };

    beforeEach(() => {
      mockPrisma.lease.findUnique.mockResolvedValue(stored);
      mockPrisma.lease.update.mockImplementation((a: any) => Promise.resolve({ ...stored, ...a.data }));
    });

    it('raises the agreed total when nothing has been collected yet', async () => {
      mockPrisma.leaseObligation.findFirst.mockResolvedValue({
        id: 'ob1', totalAmount: 5000, paidAmount: 0,
      });
      await service.update('l1', { securityDeposit: 6000 } as any);
      expect(mockObligations.update).toHaveBeenCalledWith('ob1', { totalAmount: 6000 });
    });

    it('leaves an obligation alone once money has been received against it', async () => {
      // It is a financial record with its own history by then. Silently re-pointing its
      // total because someone edited a form field would rewrite what the tenant was
      // recorded as having agreed to.
      mockPrisma.leaseObligation.findFirst.mockResolvedValue({
        id: 'ob1', totalAmount: 5000, paidAmount: 2500,
      });
      await service.update('l1', { securityDeposit: 6000 } as any);
      expect(mockObligations.update).not.toHaveBeenCalled();
    });

    it('does not touch the ledger on an edit that changes no money term', async () => {
      await service.update('l1', { notes: 'renewal discussed' } as any);
      expect(mockObligations.create).not.toHaveBeenCalled();
      expect(mockObligations.update).not.toHaveBeenCalled();
    });
  });
});


// ---------------------------------------------------------------------------
// Lease term changes -> the unit's history
//
// The audit interceptor already logs an UPDATE per request, but its newValues is the
// whole submitted body — the lease form posts ~20 fields on every save, so that row
// cannot tell "the rent moved" from "someone re-saved the same lease unchanged". This
// diff against the stored row is what makes a readable timeline entry possible.
// ---------------------------------------------------------------------------
describe('LeasesService — recording lease term changes', () => {
  let service: LeasesService;

  const stored = {
    id: 'l1', unitId: 'u1', status: 'ACTIVE',
    monthlyRent: 3400, termMonths: 11, securityDeposit: 5000, tiAllowance: null,
    tenantName: 'Acme', leaseStart: new Date('2026-08-12'), rentStartDate: null,
    leaseEnd: new Date('2027-07-13'), deletedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lease.findUnique.mockResolvedValue(stored);
    mockPrisma.lease.update.mockImplementation((a: any) => Promise.resolve({ ...stored, ...a.data }));
    mockPrisma.leaseObligation = { findFirst: jest.fn().mockResolvedValue(null) };
  });

  const logged = () => mockAudit.log.mock.calls[0]?.[0];

  it('records only the fields that actually moved', async () => {
    await service.update('l1', { monthlyRent: 3600, tenantName: 'Acme' } as any);
    expect(logged()).toMatchObject({ action: 'LEASE_TERMS_CHANGED', entity: 'Lease', entityId: 'l1' });
    expect(Object.keys(logged().newValues)).toEqual(['monthlyRent']);
  });

  it('captures both sides of each change', async () => {
    await service.update('l1', { securityDeposit: 7000 } as any);
    expect(logged().oldValues.securityDeposit).toBe('5000');
    expect(logged().newValues.securityDeposit).toBe('7000');
  });

  it('carries a label and type per field so the timeline can format it', async () => {
    await service.update('l1', { monthlyRent: 3600 } as any);
    expect(logged().metadata.fields).toEqual([
      { field: 'monthlyRent', label: 'Monthly rent', type: 'money' },
    ]);
  });

  it('records nothing when the form re-submits the same values', async () => {
    // The common case: the user opens the lease, changes nothing, saves. A timeline
    // entry for that is noise, and enough of them would bury the real changes.
    await service.update('l1', { monthlyRent: 3400, tenantName: 'Acme' } as any);
    expect(mockAudit.log).not.toHaveBeenCalled();
  });

  it('records a value being set for the first time', async () => {
    await service.update('l1', { tiAllowance: 45000 } as any);
    expect(logged().oldValues.tiAllowance).toBeNull();
    expect(logged().newValues.tiAllowance).toBe('45000');
  });

  it('never fails the lease save when the history entry cannot be written', async () => {
    mockAudit.log.mockRejectedValue(new Error('audit table down'));
    await expect(service.update('l1', { monthlyRent: 3600 } as any)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// endTenancy — the one action behind turnover, renewal and relocation.
//
// The behaviour worth protecting is not "the lease got a date on it". It is that the
// UNIT moved with it: before this existed, ending a lease left the unit LEASED with
// availableSince unset, which is exactly the shape that made 206 units invisible to
// the vacancy report and the stale-unit feed (R8).
// ---------------------------------------------------------------------------
describe('LeasesService.endTenancy', () => {
  let service: LeasesService;

  /** The transaction client. Separate from mockPrisma so unit reads inside the
   *  transaction can be controlled without disturbing resolveProjectId's. */
  // endTenancyWithin reads the lease on the CALLER's transaction, so the double needs
  // findUnique too. Delegating to mockPrisma keeps every per-test override working.
  const tx: any = {
    lease: { update: jest.fn(), findUnique: (...a: any[]) => mockPrisma.lease.findUnique(...a) },
    unit: { findUnique: jest.fn(), update: jest.fn() },
    leaseObligation: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  };

  const LEASE = {
    id: 'l1',
    unitId: 'u1',
    tenantName: 'Acme',
    leaseStart: new Date('2025-01-01'),
    leaseEnd: new Date('2030-01-01'),
    terminationDate: null,
    deletedAt: null,
    status: 'ACTIVE',
  };

  const endInput = {
    terminationDate: '2026-06-30',
    terminationReason: 'EARLY_TERMINATION' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();

    // clearAllMocks resets calls but NOT implementations, and the describe above leaves
    // audit.log rejecting. The real AuditService swallows its own errors by design, so a
    // rejecting double here would be testing a state that cannot happen.
    mockAudit.log.mockResolvedValue(undefined);
    mockPrisma.lease.findUnique.mockResolvedValue(LEASE);
    mockPrisma.unit.findUnique.mockResolvedValue({ building: { projectId: 'p1' } });
    mockPrisma.$transaction = jest.fn((fn: any) => fn(tx));

    tx.lease.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...LEASE, ...data }),
    );
    tx.unit.findUnique.mockResolvedValue({ status: 'LEASED' });
    tx.unit.update.mockResolvedValue({});
    tx.leaseObligation.findFirst.mockResolvedValue(null);

    mockRentPeriods.capAtTermination = jest
      .fn()
      .mockResolvedValue({ deleted: 3, truncated: 1 });
    mockInvoices.paidAfter.mockResolvedValue([]);
    mockInvoices.voidAfter.mockResolvedValue(4);
    mockStatusEvents.record.mockResolvedValue({ id: 'evt1' });
  });

  it('releases the unit and starts its vacancy clock at the move-out date', async () => {
    const result = await service.endTenancy('l1', endInput, 'user-1');

    // availableSince is what the vacancy report and stale-unit feed age from. Setting
    // it to the move-out date — not now() — is what makes the age honest when the
    // move-out is entered a week late.
    expect(tx.unit.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'AVAILABLE', availableSince: new Date('2026-06-30') },
    });
    expect(result.unitReleased).toBe(true);
  });

  it('writes the occupancy event carrying the lease and the reason', async () => {
    await service.endTenancy('l1', endInput, 'user-1');

    expect(mockStatusEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        unitId: 'u1',
        fromStatus: 'LEASED',
        toStatus: 'AVAILABLE',
        effectiveAt: new Date('2026-06-30'),
        source: 'LEASE_ENDED',
        leaseId: 'l1',
        recordedById: 'user-1',
      }),
      tx, // inside the transaction — a lease that ends without its event is the R8 hole
    );
  });

  it('does NOT release the unit when a successor continues on the same unit', async () => {
    // A renewal: the tenant never left, so a vacancy entry would be a lie and the
    // time-on-market clock must not start.
    mockPrisma.lease.findUnique.mockImplementation(({ where }: any) =>
      where.id === 'l2'
        ? Promise.resolve({ id: 'l2', unitId: 'u1', predecessorLease: null })
        : Promise.resolve(LEASE),
    );

    const result = await service.endTenancy(
      'l1',
      { ...endInput, terminationReason: 'RENEWED', successorLeaseId: 'l2' },
      'user-1',
    );

    expect(tx.unit.update).not.toHaveBeenCalled();
    expect(mockStatusEvents.record).not.toHaveBeenCalled();
    expect(result.unitReleased).toBe(false);
  });

  it('DOES release the unit when the successor is on a different unit', async () => {
    // A relocation: the tenancy continues, but this unit is genuinely empty.
    mockPrisma.lease.findUnique.mockImplementation(({ where }: any) =>
      where.id === 'l2'
        ? Promise.resolve({ id: 'l2', unitId: 'u9', predecessorLease: null })
        : Promise.resolve(LEASE),
    );

    const result = await service.endTenancy(
      'l1',
      { ...endInput, terminationReason: 'RELOCATED', successorLeaseId: 'l2' },
      'user-1',
    );

    expect(tx.unit.update).toHaveBeenCalled();
    expect(result.unitReleased).toBe(true);
  });

  it('refuses when rent has already been collected after the move-out date, naming the months', async () => {
    mockInvoices.paidAfter.mockResolvedValue([
      { id: 'i1', periodMonth: new Date('2026-08-01'), status: 'PAID' },
      { id: 'i2', periodMonth: new Date('2026-09-01'), status: 'PARTIAL' },
    ]);

    // Either the date is wrong or a refund is owed. Voiding an invoice with money
    // against it is not a decision this method gets to make silently.
    await expect(service.endTenancy('l1', endInput)).rejects.toThrow(/2026-08, 2026-09/);
    // The guard now runs INSIDE the transaction — so a transaction is opened and rolls
    // back. What matters is that nothing was written, not that none was opened.
    expect(tx.lease.update).not.toHaveBeenCalled();
    expect(tx.unit.update).not.toHaveBeenCalled();
  });

  it('caps the schedule and voids the unpaid months after the move-out', async () => {
    const result = await service.endTenancy('l1', endInput, 'user-1');

    expect(mockRentPeriods.capAtTermination).toHaveBeenCalledWith(
      'l1', new Date('2026-06-30'), tx,
    );
    expect(mockInvoices.voidAfter).toHaveBeenCalledWith(
      'l1', new Date('2026-06-30'), expect.stringContaining('2026-06-30'), tx,
    );
    expect(result.invoicesVoided).toBe(4);
    expect(result.periodsDeleted).toBe(3);
  });

  it('derives EXPIRED when the tenant ran to the end of the term, TERMINATED when they did not', async () => {
    await service.endTenancy('l1', endInput);
    expect(tx.lease.update.mock.calls[0][0].data.status).toBe('TERMINATED');

    jest.clearAllMocks();
    tx.lease.update.mockImplementation(({ data }: any) => Promise.resolve({ ...LEASE, ...data }));
    tx.unit.findUnique.mockResolvedValue({ status: 'LEASED' });
    tx.leaseObligation.findFirst.mockResolvedValue(null);
    mockPrisma.lease.findUnique.mockResolvedValue(LEASE);
    mockPrisma.$transaction = jest.fn((fn: any) => fn(tx));

    // Running to term is not "terminating" anything. Deriving it stops the status and
    // the dates from ever disagreeing.
    await service.endTenancy('l1', { ...endInput, terminationDate: '2030-01-01' });
    expect(tx.lease.update.mock.calls[0][0].data.status).toBe('EXPIRED');
  });

  it('refuses to end a tenancy that has already ended', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({
      ...LEASE,
      terminationDate: new Date('2026-01-31'),
    });

    await expect(service.endTenancy('l1', endInput)).rejects.toThrow(/already ended on 2026-01-31/);
  });

  it('refuses a move-out date before the lease started', async () => {
    await expect(
      service.endTenancy('l1', { ...endInput, terminationDate: '2024-01-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not flip a SOLD unit back to AVAILABLE', async () => {
    // The tenant buying the unit is the TENANT_BOUGHT case. Releasing it would undo
    // the sale — the lease ending is a consequence of the sale, not a vacancy.
    tx.unit.findUnique.mockResolvedValue({ status: 'SOLD' });

    await service.endTenancy('l1', { ...endInput, terminationReason: 'TENANT_BOUGHT' });

    expect(tx.unit.update).not.toHaveBeenCalled();
    // Still logged: the tenancy did end, and the log is the unit's history.
    expect(mockStatusEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'SOLD', leaseId: 'l1' }),
      tx,
    );
  });

  it('refuses to transfer the deposit with no successor to transfer it to', async () => {
    tx.leaseObligation.findFirst.mockResolvedValue({
      id: 'o1', paidAmount: '5000', notes: null,
    });

    await expect(
      service.endTenancy('l1', { ...endInput, depositDisposition: 'TRANSFER' }),
    ).rejects.toThrow(/successor lease/);
  });

  it('records REFUND as a note without touching the collection status', async () => {
    // PENDING/PARTIAL/SETTLED describe what was COLLECTED. Overloading them to also
    // mean "refunded" would corrupt the deposit report, so the decision is recorded
    // and Finance still books the actual refund as a payment.
    tx.leaseObligation.findFirst.mockResolvedValue({
      id: 'o1', paidAmount: '5000', notes: 'Collected in full',
    });

    await service.endTenancy('l1', { ...endInput, depositDisposition: 'REFUND' });

    const call = tx.leaseObligation.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'o1' });
    expect(call.data.notes).toContain('REFUND on 2026-06-30');
    expect(call.data.status).toBeUndefined();
  });

  it('leaves the deposit alone when nobody has decided yet', async () => {
    tx.leaseObligation.findFirst.mockResolvedValue({ id: 'o1', paidAmount: '5000', notes: null });

    const result = await service.endTenancy('l1', endInput);

    expect(tx.leaseObligation.update).not.toHaveBeenCalled();
    expect(result.deposit).toMatchObject({ disposition: 'DECIDE_LATER', applied: false });
  });

  it('rejects a successor that another tenancy already claims', async () => {
    mockPrisma.lease.findUnique.mockImplementation(({ where }: any) =>
      where.id === 'l2'
        ? Promise.resolve({ id: 'l2', unitId: 'u1', predecessorLease: { id: 'other' } })
        : Promise.resolve(LEASE),
    );

    await expect(
      service.endTenancy('l1', { ...endInput, successorLeaseId: 'l2' }),
    ).rejects.toThrow(/already recorded as the continuation/);
  });

  it('rejects a lease succeeding itself', async () => {
    await expect(
      service.endTenancy('l1', { ...endInput, successorLeaseId: 'l1' }),
    ).rejects.toThrow(/cannot succeed itself/);
  });
});

// ---------------------------------------------------------------------------
// S4 / T1 — LEASE_TRANSFERRED_WITH_SALE: the tenancy leaves Prime's book INTACT.
//
// Every other reason means the tenancy is over, so capAtTermination deletes the rest of
// the rent schedule and voidAfter voids the invoices after the date. When a tenanted unit
// is sold to a third party that is exactly backwards: the tenant is still in the unit and
// still owes the rent, to the buyer. Both deletions are unrecoverable, which is why this
// mode exists and why the tests below are about what does NOT happen.
// ---------------------------------------------------------------------------
describe('LeasesService.endTenancy — tenancy transferred with the sale', () => {
  let service: LeasesService;

  const tx: any = {
    lease: { update: jest.fn(), findUnique: (...a: any[]) => mockPrisma.lease.findUnique(...a) },
    unit: { findUnique: jest.fn(), update: jest.fn() },
    leaseObligation: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  };

  const LEASE = {
    id: 'l1',
    unitId: 'u1',
    tenantName: 'Sitting Tenant LLC',
    leaseStart: new Date('2025-01-01'),
    leaseEnd: new Date('2030-01-01'),
    terminationDate: null,
    deletedAt: null,
    status: 'ACTIVE',
  };

  const transferInput = {
    terminationDate: '2026-06-30',
    terminationReason: 'LEASE_TRANSFERRED_WITH_SALE' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();

    mockAudit.log.mockResolvedValue(undefined);
    mockPrisma.lease.findUnique.mockResolvedValue(LEASE);
    mockPrisma.unit.findUnique.mockResolvedValue({ building: { projectId: 'p1' } });
    mockPrisma.$transaction = jest.fn((fn: any) => fn(tx));

    tx.lease.update.mockImplementation(({ data }: any) => Promise.resolve({ ...LEASE, ...data }));
    // The sale flipped the unit to SOLD earlier in the same transaction — the state this
    // mode is only ever legitimately reached from.
    tx.unit.findUnique.mockResolvedValue({ status: 'SOLD' });
    tx.unit.update.mockResolvedValue({});
    tx.leaseObligation.findFirst.mockResolvedValue(null);

    mockRentPeriods.capAtTermination = jest.fn().mockResolvedValue({ deleted: 3, truncated: 1 });
    mockInvoices.paidAfter.mockResolvedValue([]);
    mockInvoices.voidAfter.mockResolvedValue(4);
    mockStatusEvents.record.mockResolvedValue({ id: 'evt1' });
  });

  it('DELETES NO RENT PERIODS AND VOIDS NO INVOICES — the data-loss case', async () => {
    // The single most important assertion in this file. Those rows are now the buyer's
    // record of a tenant in occupation; capAtTermination deletes them outright.
    const result = await service.endTenancy('l1', transferInput, 'user-1');

    expect(mockRentPeriods.capAtTermination).not.toHaveBeenCalled();
    expect(mockInvoices.voidAfter).not.toHaveBeenCalled();
    expect(result.periodsDeleted).toBe(0);
    expect(result.periodsTruncated).toBe(0);
    expect(result.invoicesVoided).toBe(0);
  });

  it('still marks the lease, so Prime stops treating it as its own', async () => {
    // "Survives" means the LEDGER survives, not that the lease is left looking live on
    // Prime's book. An untouched ACTIVE lease on a SOLD unit is the inconsistency the
    // whole sale-ends-the-tenancy path exists to prevent.
    await service.endTenancy('l1', transferInput, 'user-1');

    const data = tx.lease.update.mock.calls[0][0].data;
    expect(data.terminationDate).toEqual(new Date('2026-06-30'));
    expect(data.terminationReason).toBe('LEASE_TRANSFERRED_WITH_SALE');
    expect(data.status).toBe('TERMINATED'); // mid-term, so not EXPIRED
  });

  it('refuses the reason on a unit Prime still owns', async () => {
    // The skipped cap and void are only safe BECAUSE the unit is SOLD: NOT_ON_SOLD_UNIT
    // and the capAtSale / soldAt guards are what actually stop Prime billing it. On an
    // unsold unit this would leave a "terminated" lease whose schedule keeps running and
    // whose invoices keep being generated — the worst of both modes.
    tx.unit.findUnique.mockResolvedValue({ status: 'LEASED' });

    await expect(service.endTenancy('l1', transferInput)).rejects.toThrow(/has been SOLD/);
    expect(tx.lease.update).not.toHaveBeenCalled();
  });

  it('refuses on a building-level lease, which has no unit that could have been sold', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({ ...LEASE, unitId: null, buildingId: 'b1' });

    await expect(service.endTenancy('l1', transferInput)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.lease.update).not.toHaveBeenCalled();
  });

  it('is NOT blocked by rent already collected past the completion date', async () => {
    // That guard exists to stop voidAfter erasing money, and nothing is voided here. Rent
    // paid in advance across a completion is an apportionment between seller and buyer
    // (spec non-goal 1) — routine in commercial letting, and not a reason to refuse the
    // completion. Refusing it would also give advice ("clear those payments if they were
    // recorded in error") that is wrong for money correctly collected.
    mockInvoices.paidAfter.mockResolvedValue([
      { id: 'i1', periodMonth: new Date('2026-08-01'), status: 'PAID' },
    ]);

    await expect(service.endTenancy('l1', transferInput)).resolves.toBeDefined();
    expect(tx.lease.update).toHaveBeenCalled();
  });

  it('leaves the SOLD unit alone and logs the transfer as a LANDLORD CHANGE (R6)', async () => {
    await service.endTenancy('l1', transferInput, 'user-1');

    expect(tx.unit.update).not.toHaveBeenCalled();
    const event = mockStatusEvents.record.mock.calls[0][0];
    expect(event).toMatchObject({ unitId: 'u1', toStatus: 'SOLD', leaseId: 'l1' });
    // Whoever opens this unit's history must not read that the tenant left, because they
    // did not. "Tenancy ended (…)" is precisely the wrong sentence here.
    expect(event.reason).toMatch(/Landlord changed/);
    expect(event.reason).toMatch(/continues with the new owner/);
    expect(event.reason).not.toMatch(/Tenancy ended/);
  });

  it('notifies on the same footing as any other tenancy end, carrying the reason (R5)', async () => {
    await service.endTenancy('l1', transferInput, 'user-1');

    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lease.terminated',
        leaseId: 'l1',
        projectId: 'p1',
        tenantName: 'Sitting Tenant LLC',
        reason: 'LEASE_TRANSFERRED_WITH_SALE',
      }),
    );
  });

  it('every OTHER reason still caps and voids — regression guard on the default mode', async () => {
    // The skip must be reachable only through the one reason that names it. If this ever
    // fails, an ordinary move-out has stopped closing its own rent schedule.
    tx.unit.findUnique.mockResolvedValue({ status: 'LEASED' });

    await service.endTenancy('l1', {
      terminationDate: '2026-06-30',
      terminationReason: 'TENANT_BOUGHT',
    });

    expect(mockRentPeriods.capAtTermination).toHaveBeenCalledWith('l1', new Date('2026-06-30'), tx);
    expect(mockInvoices.voidAfter).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// assignTenant — the lease document survives, only the party changes.
//
// The whole value of this method is what it does NOT touch. An assignment that
// regenerated the schedule, or re-billed anything, or moved the unit, would break the
// one guarantee it exists to give: occupancy and billing continue uninterrupted.
// ---------------------------------------------------------------------------
describe('LeasesService.assignTenant', () => {
  let service: LeasesService;

  const tx: any = {
    lease: { update: jest.fn() },
    leaseTenantAssignment: { create: jest.fn() },
  };

  const LEASE = {
    id: 'l1',
    unitId: 'u1',
    tenantName: 'Old Holdings LLC',
    tenantLegalName: 'Old Holdings LLC',
    tenantPhone: '555-0100',
    leaseStart: new Date('2025-01-01'),
    leaseEnd: new Date('2030-01-01'),
    terminationDate: null,
    deletedAt: null,
  };

  const input = { effectiveDate: '2026-06-01', toTenantName: 'New Ventures LLC' };

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockAudit.log.mockResolvedValue(undefined);
    mockPrisma.lease.findUnique.mockResolvedValue(LEASE);
    mockPrisma.leaseTenantAssignment = { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn() };
    mockPrisma.$transaction = jest.fn((fn: any) => fn(tx));
    tx.leaseTenantAssignment.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'a1', ...data }),
    );
    tx.lease.update.mockResolvedValue({ ...LEASE, tenantName: 'New Ventures LLC' });
  });

  it('snapshots the outgoing tenant, because the lease row is about to lose it', async () => {
    const row = await service.assignTenant('l1', input, 'user-1');

    // Without this snapshot, last year's invoices would read as billed to a party that
    // did not exist yet, and "who was the tenant in March" becomes unanswerable.
    expect(row).toMatchObject({
      fromTenantName: 'Old Holdings LLC',
      fromTenantLegalName: 'Old Holdings LLC',
      toTenantName: 'New Ventures LLC',
      effectiveDate: new Date('2026-06-01'),
      recordedById: 'user-1',
    });
  });

  it('leaves the schedule, the ledger, the obligations and the unit completely alone', async () => {
    await service.assignTenant('l1', input, 'user-1');

    expect(mockRentPeriods.generateForLease).not.toHaveBeenCalled();
    expect(mockInvoices.voidAfter).not.toHaveBeenCalled();
    expect(mockStatusEvents.record).not.toHaveBeenCalled();
    expect(tx.lease.update).toHaveBeenCalledTimes(1);
    // The only lease fields touched are the tenant's identity.
    expect(Object.keys(tx.lease.update.mock.calls[0][0].data)).toEqual(['tenantName']);
  });

  it('does not blank contact fields the caller simply omitted', async () => {
    // An assignment often changes the legal entity while the same people stay in the
    // shop. Overwriting the phone number with null because a form omitted it loses
    // data nobody asked to lose.
    await service.assignTenant('l1', input, 'user-1');
    expect(tx.lease.update.mock.calls[0][0].data.tenantPhone).toBeUndefined();

    jest.clearAllMocks();
    tx.lease.update.mockResolvedValue(LEASE);
    tx.leaseTenantAssignment.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    await service.assignTenant('l1', { ...input, toTenantPhone: '555-0200' }, 'user-1');
    expect(tx.lease.update.mock.calls[0][0].data.tenantPhone).toBe('555-0200');
  });

  it('refuses an assignment dated before the lease started', async () => {
    await expect(
      service.assignTenant('l1', { ...input, effectiveDate: '2024-01-01' }),
    ).rejects.toThrow(/before the lease started/);
  });

  it('refuses to assign a tenancy that has already ended', async () => {
    // A party taking the space after the tenant left needs a new lease. Allowing an
    // assignment here would attach them to a ledger they were never billed on.
    mockPrisma.lease.findUnique.mockResolvedValue({
      ...LEASE,
      terminationDate: new Date('2026-03-31'),
    });

    await expect(
      service.assignTenant('l1', { ...input, effectiveDate: '2026-06-01' }),
    ).rejects.toThrow(/needs a new lease, not an assignment/);
  });

  it('refuses an out-of-order assignment', async () => {
    // Assignments are a chain — each one's "from" is the previous one's "to". Accepting
    // one dated before the last breaks the ability to say who the tenant was on a date.
    mockPrisma.leaseTenantAssignment.findFirst.mockResolvedValue({
      effectiveDate: new Date('2026-09-01'),
      toTenantName: 'Interim LLC',
    });

    await expect(service.assignTenant('l1', input)).rejects.toThrow(/Record assignments in order/);
  });

  it('refuses a no-op assignment to the tenant already on the lease', async () => {
    await expect(
      service.assignTenant('l1', { ...input, toTenantName: 'Old Holdings LLC' }),
    ).rejects.toThrow(/already the tenant/);
  });

  it('requires a non-empty new tenant name', async () => {
    await expect(
      service.assignTenant('l1', { ...input, toTenantName: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Lease activation drives unit status
//
// The root cause of the 2026-08-13 finding: of 113 units that either claimed to be
// tenanted or actually held a live lease, only 12 agreed with themselves — because
// nothing had ever set a unit's status from a lease.
//
// The restraint matters as much as the behaviour: this must not un-sell a SOLD unit,
// must not act on a DRAFT, and must not downgrade OCCUPIED.
// ---------------------------------------------------------------------------
describe('LeasesService — a lease activating moves its unit', () => {
  let service: LeasesService;

  const tx: any = {
    lease: { create: jest.fn(), update: jest.fn() },
    unit: { findUnique: jest.fn(), update: jest.fn() },
  };

  const NEW_LEASE = {
    unitId: 'u1',
    tenantName: 'Acme',
    monthlyRent: 1000,
    leaseStart: '2026-01-01',
    leaseEnd: '2027-01-01',
    termMonths: 12,
    status: 'ACTIVE',
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockAudit.log.mockResolvedValue(undefined);
    mockPrisma.lease.findFirst.mockResolvedValue(null);       // no overlap
    mockPrisma.unit.findUnique.mockResolvedValue({ building: { projectId: 'p1' } });
    mockPrisma.$transaction = jest.fn((fn: any) => fn(tx));
    tx.lease.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'l1', ...data, terminationDate: null }));
    tx.lease.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'l1', unitId: 'u1', leaseStart: new Date('2026-01-01'), terminationDate: null, ...data }));
    tx.unit.findUnique.mockResolvedValue({ status: 'AVAILABLE' });
    mockStatusEvents.record.mockResolvedValue({ id: 'evt1' });
  });

  it('flips an AVAILABLE unit to LEASED and clears its time-on-market clock', async () => {
    await service.create({ ...NEW_LEASE }, 'user-1');

    expect(tx.unit.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      // availableSince must go: continuing to age a unit that has a tenant in it is
      // what made the vacancy report untrustworthy in the first place.
      data: { status: 'LEASED', availableSince: null },
    });
  });

  it('dates the occupancy event by the LEASE, not by now()', async () => {
    // A lease entered three weeks late did not start occupying the unit the day
    // someone typed it in.
    await service.create({ ...NEW_LEASE }, 'user-1');

    expect(mockStatusEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        unitId: 'u1',
        fromStatus: 'AVAILABLE',
        toStatus: 'LEASED',
        // A Date, not the submitted string — create coerces it before Prisma sees it.
        effectiveAt: new Date('2026-01-01'),
        source: 'LEASE_ACTIVATED',
        leaseId: 'l1',
      }),
      tx,
    );
  });

  it('writes the unit inside the SAME transaction as the lease', async () => {
    // A lease that activated without moving its unit is precisely the inconsistency
    // this exists to stop creating, so it must not be able to half-commit.
    await service.create({ ...NEW_LEASE }, 'user-1');

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockStatusEvents.record.mock.calls[0][1]).toBe(tx);
  });

  it('moves a DRAFT lease to LEASE_PENDING, not LEASED', async () => {
    // Client-confirmed 2026-08-13: a draft means signed-but-not-started, so the unit is
    // committed even though nobody has moved in. This reverses the conservative default
    // shipped earlier that left a draft alone.
    await service.create({ ...NEW_LEASE, status: 'DRAFT' }, 'user-1');

    expect(tx.unit.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'LEASE_PENDING', availableSince: null },
    });
    expect(mockStatusEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'LEASE_PENDING' }),
      tx,
    );
  });

  it('a DRAFT never pulls an OCCUPIED unit backwards', async () => {
    // The tenant physically in the unit is a more certain fact than the paperwork on the
    // next one. Signing a successor must not make the unit look empty-ish.
    tx.unit.findUnique.mockResolvedValue({ status: 'OCCUPIED' });

    await service.create({ ...NEW_LEASE, status: 'DRAFT' }, 'user-1');

    expect(tx.unit.update).not.toHaveBeenCalled();
  });

  it('a DRAFT on an already LEASE_PENDING unit is a no-op', async () => {
    tx.unit.findUnique.mockResolvedValue({ status: 'LEASE_PENDING' });

    await service.create({ ...NEW_LEASE, status: 'DRAFT' }, 'user-1');

    expect(tx.unit.update).not.toHaveBeenCalled();
    expect(mockStatusEvents.record).not.toHaveBeenCalled();
  });

  it('activating a LEASE_PENDING unit promotes it to LEASED', async () => {
    tx.unit.findUnique.mockResolvedValue({ status: 'LEASE_PENDING' });

    await service.create({ ...NEW_LEASE }, 'user-1');

    expect(tx.unit.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'LEASED', availableSince: null },
    });
  });

  it('still ignores a lease that is neither ACTIVE nor DRAFT', async () => {
    await service.create({ ...NEW_LEASE, status: 'EXPIRED' }, 'user-1');
    expect(tx.unit.update).not.toHaveBeenCalled();
  });

  it('never un-sells a SOLD unit', async () => {
    // Prime does not own it. A lease on a sold unit is a data-integrity question —
    // there are 8 — not a licence to flip the sale back.
    tx.unit.findUnique.mockResolvedValue({ status: 'SOLD' });

    await service.create({ ...NEW_LEASE }, 'user-1');

    expect(tx.unit.update).not.toHaveBeenCalled();
  });

  it('does not downgrade OCCUPIED to LEASED', async () => {
    // OCCUPIED is the more specific claim and a human set it deliberately.
    tx.unit.findUnique.mockResolvedValue({ status: 'OCCUPIED' });

    await service.create({ ...NEW_LEASE }, 'user-1');

    expect(tx.unit.update).not.toHaveBeenCalled();
  });

  it('is a no-op when the unit already reads LEASED', async () => {
    tx.unit.findUnique.mockResolvedValue({ status: 'LEASED' });

    await service.create({ ...NEW_LEASE }, 'user-1');

    expect(tx.unit.update).not.toHaveBeenCalled();
    expect(mockStatusEvents.record).not.toHaveBeenCalled();
  });

  it('ignores a building-level lease, which has no unit to move', async () => {
    await service.create({ ...NEW_LEASE, unitId: null, buildingId: 'b1' }, 'user-1');

    expect(tx.unit.update).not.toHaveBeenCalled();
  });

  it('moves the unit when a DRAFT lease is later activated', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({
      id: 'l1', unitId: 'u1', status: 'DRAFT', deletedAt: null,
      leaseStart: new Date('2026-01-01'), leaseEnd: new Date('2027-01-01'),
      terminationDate: null, monthlyRent: 1000,
    });
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([]);

    await service.update('l1', { status: 'ACTIVE' } as any, 'user-1');

    expect(tx.unit.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'LEASED', availableSince: null },
    });
  });
});

// ---------------------------------------------------------------------------
// H2 — backfilling a tenancy that has already ended
//
// Client confirmed 2026-08-13 that per-month collection history IS known and the team
// will enter all past detail, so these ledgers are recorded fact rather than
// reconstruction. The property that matters most: entering 2019's tenant must not
// change who the system thinks is in the unit today.
// ---------------------------------------------------------------------------
describe('LeasesService.backfillTenancy', () => {
  let service: LeasesService;

  const PAST = {
    unitId: 'u1',
    tenantName: 'Former Tenant Ltd',
    leaseStart: '2019-01-01',
    leaseEnd: '2022-01-01',
    terminationDate: '2022-01-01',
    monthlyRent: 3000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockAudit.log.mockResolvedValue(undefined);
    mockPrisma.lease.findFirst.mockResolvedValue(null);           // no overlap
    mockPrisma.unit.findUnique.mockResolvedValue({
      id: 'u1', status: 'AVAILABLE', deletedAt: null, building: { projectId: 'p1' },
    });
    mockPrisma.$transaction = jest.fn((fn: any) =>
      typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn));
    mockPrisma.lease.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'hist1', ...data }));
    mockPrisma.leaseRentInvoice = {
      findMany: jest.fn().mockResolvedValue([
        { id: 'i1', periodMonth: new Date('2019-01-01'), amountDue: 3000, status: 'DUE' },
        { id: 'i2', periodMonth: new Date('2019-02-01'), amountDue: 3000, status: 'DUE' },
        { id: 'i3', periodMonth: new Date('2019-03-01'), amountDue: 0, status: 'FREE' },
      ]),
      update: jest.fn().mockResolvedValue({}),
    };
    mockInvoices.generateForLease = jest.fn().mockResolvedValue([]);
    mockStatusEvents.record.mockResolvedValue({ id: 'evt' });
  });

  it('does NOT move the unit — entering an old tenant must not change who is in it today', async () => {
    // The single most important property. It falls out of syncUnitFromLease only firing
    // for ACTIVE/DRAFT, and this writes EXPIRED/TERMINATED — but it is worth pinning,
    // because a future change to that guard would silently corrupt live occupancy.
    await service.backfillTenancy(PAST, 'user-1');

    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
  });

  it('derives EXPIRED when they ran to term, TERMINATED when they left early', async () => {
    await service.backfillTenancy(PAST, 'user-1');
    expect(mockPrisma.lease.create.mock.calls[0][0].data.status).toBe('EXPIRED');

    jest.clearAllMocks();
    mockPrisma.lease.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'h2', ...data }));
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([]);
    await service.backfillTenancy({ ...PAST, terminationDate: '2021-06-30' }, 'user-1');
    expect(mockPrisma.lease.create.mock.calls[0][0].data.status).toBe('TERMINATED');
  });

  it('refuses a tenancy that has not ended yet', async () => {
    // That is a live lease. Backfilling it would write a complete "paid" ledger for
    // months nobody has collected.
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);

    await expect(
      service.backfillTenancy({ ...PAST, terminationDate: future.toISOString() }, 'user-1'),
    ).rejects.toThrow(/has not ended yet/);
  });

  it('refuses a move-out before the lease started', async () => {
    await expect(
      service.backfillTenancy({ ...PAST, terminationDate: '2018-01-01' }, 'user-1'),
    ).rejects.toThrow(/cannot be before the lease started/);
  });

  it('caps the generated ledger at the move-out date', async () => {
    await service.backfillTenancy({ ...PAST, terminationDate: '2021-06-30' }, 'user-1');

    expect(mockInvoices.generateForLease).toHaveBeenCalledWith('hist1', {
      through: new Date('2021-06-30'),
    });
  });

  it('marks every month PAID by default, so history is never overdue AR', async () => {
    // A 2019 tenancy showing as overdue would put historical debt into today's
    // collection reports (client decision 2026-08-12).
    await service.backfillTenancy(PAST, 'user-1');

    const updates = mockPrisma.leaseRentInvoice.update.mock.calls.map((c: any) => c[0].data);
    expect(updates.every((d: any) => d.status === 'PAID')).toBe(true);
  });

  it('leaves FREE months alone — nothing was owed', async () => {
    await service.backfillTenancy(PAST, 'user-1');

    const ids = mockPrisma.leaseRentInvoice.update.mock.calls.map((c: any) => c[0].where.id);
    expect(ids).toEqual(['i1', 'i2']);   // i3 is FREE
  });

  it('applies per-month collection overrides where the team knows it differed', async () => {
    await service.backfillTenancy({ ...PAST, collections: { '2019-02': 1500 } }, 'user-1');

    const feb = mockPrisma.leaseRentInvoice.update.mock.calls
      .find((c: any) => c[0].where.id === 'i2')[0].data;
    expect(Number(feb.amountPaid)).toBe(1500);
    expect(feb.status).toBe('PARTIAL');
  });

  it('records a zero-collection month as DUE, not silently paid', async () => {
    await service.backfillTenancy({ ...PAST, collections: { '2019-01': 0 } }, 'user-1');

    const jan = mockPrisma.leaseRentInvoice.update.mock.calls
      .find((c: any) => c[0].where.id === 'i1')[0].data;
    expect(jan.status).toBe('DUE');
  });

  it('backdates both occupancy events and flags them historical', async () => {
    // Dated by the tenancy, not by now(), so the timeline sorts by what happened rather
    // than by when it was typed.
    await service.backfillTenancy(PAST, 'user-1');

    const [moveIn, moveOut] = mockStatusEvents.record.mock.calls.map((c: any) => c[0]);
    expect(moveIn).toMatchObject({
      toStatus: 'LEASED', effectiveAt: new Date('2019-01-01'), source: 'BACKFILL', isHistorical: true,
    });
    expect(moveOut).toMatchObject({
      toStatus: 'AVAILABLE', effectiveAt: new Date('2022-01-01'), source: 'BACKFILL', isHistorical: true,
    });
  });

  it('flags the lease as historical, which is what puts its deletion behind approval', async () => {
    await service.backfillTenancy(PAST, 'user-1');

    expect(mockPrisma.lease.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isHistorical: true }),
      }),
    );
  });

  it('refuses a unit that does not exist', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue(null);
    await expect(service.backfillTenancy(PAST, 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  // R9 field-gap audit (2026-08-23): landlordEntity/tenantEmail/tenantPhone/escalationPct/
  // rentPerSqft/nnnPerSqft/nnnTotalAmount/tiAllowance already existed on Lease and on the
  // live create() path, but backfillTenancy silently dropped every one of them.
  it('passes the R9 field-gap-audit fields through to the created lease', async () => {
    await service.backfillTenancy({
      ...PAST,
      landlordEntity: 'Texas Hazelwood OP 2 LLC',
      tenantEmail: 'tenant@example.com',
      tenantPhone: '555-0100',
      rentPerSqft: 2.5,
      escalationPct: 3,
      nnnPerSqft: 13,
      nnnTotalAmount: 3304.16,
      tiAllowance: 182400,
    }, 'user-1');

    expect(mockPrisma.lease.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          landlordEntity: 'Texas Hazelwood OP 2 LLC',
          tenantEmail: 'tenant@example.com',
          tenantPhone: '555-0100',
          rentPerSqft: 2.5,
          escalationPct: 3,
          nnnPerSqft: 13,
          nnnTotalAmount: 3304.16,
          tiAllowance: 182400,
        }),
      }),
    );
  });

  // R9.2 (2026-08-24): "can be active lease also, not only history" — a bulk import row
  // with no Termination Date means the tenancy is STILL GOING, not an error.
  describe('omitting terminationDate — the tenancy is still going', () => {
    const STILL_GOING = {
      unitId: 'u1',
      tenantName: 'Current Tenant LLC',
      leaseStart: '2021-01-01',
      leaseEnd: '2031-01-01',
      monthlyRent: 3000,
      // terminationDate deliberately omitted
    };

    it('creates the lease ACTIVE with a null terminationDate', async () => {
      await service.backfillTenancy(STILL_GOING, 'user-1');
      expect(mockPrisma.lease.create.mock.calls[0][0].data).toMatchObject({
        status: 'ACTIVE', terminationDate: null, terminationReason: null, isHistorical: true,
      });
    });

    it('DOES flip the unit to LEASED — unlike an ended backfill, this one is genuinely occupied today', async () => {
      await service.backfillTenancy(STILL_GOING, 'user-1');
      expect(mockPrisma.unit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'LEASED' }) }),
      );
    });

    it('dates the occupancy event by leaseStart, and records only ONE — no manual move-out for a tenant who has not left', async () => {
      await service.backfillTenancy(STILL_GOING, 'user-1');
      expect(mockStatusEvents.record).toHaveBeenCalledTimes(1);
      expect(mockStatusEvents.record.mock.calls[0][0]).toMatchObject({
        toStatus: 'LEASED', effectiveAt: new Date('2021-01-01'),
      });
    });

    it('generates the ledger through TODAY, not through a move-out date that does not exist', async () => {
      const before = new Date();
      await service.backfillTenancy(STILL_GOING, 'user-1');
      const through = mockInvoices.generateForLease.mock.calls[0][1].through;
      // Compared against UTC midnight, not `new Date(before.toDateString())`.
      // toDateString() renders the LOCAL date and re-parsing it yields LOCAL midnight, while
      // the service bills through UTC midnight. Once the local clock has ticked into
      // tomorrow but UTC has not, local-midnight sits AHEAD of the value under test and this
      // assertion flipped — so on a UTC+5:30 machine the suite went red every day between
      // 18:30 and 24:00 UTC. The service was right the whole time; the comparison was not.
      const utcMidnight = Date.UTC(
        before.getUTCFullYear(), before.getUTCMonth(), before.getUTCDate(),
      );
      expect(through.getTime()).toBeGreaterThanOrEqual(utcMidnight);
      expect(through.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('still refuses a Lease Start/End that fails to parse', async () => {
      await expect(
        service.backfillTenancy({ ...STILL_GOING, leaseStart: 'not-a-date' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('still marks the ledger paid-by-default, same as an ended backfill', async () => {
      await service.backfillTenancy(STILL_GOING, 'user-1');
      const dueUpdate = mockPrisma.leaseRentInvoice.update.mock.calls
        .find((c: any) => c[0].where.id === 'i1')[0].data;
      expect(dueUpdate.status).toBe('PAID');
    });
  });
});


/**
 * R27 — deleting a backfilled tenancy takes a Founder.
 *
 * The asymmetry is the point: a live lease can be rebuilt from its own terms, so deleting
 * one loses nothing that cannot be re-derived. A historical lease carries a ledger typed
 * in from paper the system never saw — its deletion is unrecoverable, so it takes a
 * second person.
 */
describe('LeasesService — historical deletion approval', () => {
  let service: LeasesService;

  const HISTORICAL = { id: 'l1', unitId: 'u1', tenantName: 'Old Tenant', isHistorical: true };
  const LIVE = { id: 'l2', unitId: 'u1', tenantName: 'Current Tenant', isHistorical: false };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue(null);
    mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue(null);
    // The service reads back what it wrote (the trimmed reason, the stored note), so the
    // doubles have to echo rather than return undefined.
    mockPrisma.historicalRecordDeletion.create.mockImplementation(
      ({ data }: any) => Promise.resolve({ id: 'r-new', ...data }),
    );
    mockPrisma.historicalRecordDeletion.update.mockImplementation(
      ({ where, data }: any) => Promise.resolve({ id: where.id, ...data }),
    );
    mockPrisma.lease.update.mockResolvedValue({ id: 'l1', deletedAt: new Date() });
    service = makeService();
  });

  describe('the delete gate', () => {
    it('refuses to delete a historical lease with no approval', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);

      await expect(service.delete('l1', 'user-1')).rejects.toThrow(/Request deletion first/);
      expect(mockPrisma.lease.update).not.toHaveBeenCalled();
    });

    it('says so specifically when a request is already pending', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);
      mockPrisma.historicalRecordDeletion.findFirst
        .mockResolvedValueOnce(null)                       // no APPROVED
        .mockResolvedValueOnce({ id: 'r1', status: 'PENDING' });

      await expect(service.delete('l1', 'user-1')).rejects.toThrow(/awaiting Founder approval/);
    });

    it('deletes once an approval exists', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);
      mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue({ id: 'r1', status: 'APPROVED' });

      await service.delete('l1', 'user-1');

      expect(mockPrisma.lease.update).toHaveBeenCalledWith({
        where: { id: 'l1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('lets an approver delete directly, recorded as self-approved', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);

      await service.delete('l1', 'founder-1', true);

      // A request they raised and decided in one act — the trail reads the same shape as
      // every other deletion instead of leaving a hole where an approval should be.
      expect(mockPrisma.historicalRecordDeletion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leaseId: 'l1',
          status: 'APPROVED',
          requestedById: 'founder-1',
          decidedById: 'founder-1',
        }),
      });
      expect(mockPrisma.lease.update).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          oldValues: expect.objectContaining({ selfApproved: true }),
        }),
      );
    });

    it('an approver deleting directly settles the request somebody else raised', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);
      mockPrisma.historicalRecordDeletion.findFirst
        .mockResolvedValueOnce(null)                                  // no APPROVED
        .mockResolvedValueOnce({ id: 'r1', status: 'PENDING' });      // one PENDING

      await service.delete('l1', 'founder-1', true);

      expect(mockPrisma.historicalRecordDeletion.create).not.toHaveBeenCalled();
      expect(mockPrisma.historicalRecordDeletion.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({ status: 'APPROVED', decidedById: 'founder-1' }),
      });
    });

    it('burns the approval, so one approval cannot authorise a second deletion', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);
      mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue({ id: 'r1', status: 'APPROVED' });

      await service.delete('l1', 'user-1');

      expect(mockPrisma.historicalRecordDeletion.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: 'COMPLETED' },
      });
    });

    it('leaves an ordinary lease deletable without ceremony', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(LIVE);

      await service.delete('l2', 'user-1');

      expect(mockPrisma.lease.update).toHaveBeenCalled();
      expect(mockPrisma.historicalRecordDeletion.findFirst).not.toHaveBeenCalled();
    });

    it('distinguishes the two in the audit trail', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(LIVE);
      await service.delete('l2', 'user-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LEASE_DELETED' }),
      );

      jest.clearAllMocks();
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);
      mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue({ id: 'r1', status: 'APPROVED' });
      await service.delete('l1', 'user-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LEASE_HISTORICAL_DELETED' }),
      );
    });
  });

  describe('requesting', () => {
    it('records the request with its reason and requester', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);

      await service.requestHistoricalDeletion('l1', '  duplicate of the 2019 record  ', 'user-1');

      expect(mockPrisma.historicalRecordDeletion.create).toHaveBeenCalledWith({
        data: {
          leaseId: 'l1',
          reason: 'duplicate of the 2019 record',
          requestedById: 'user-1',
        },
      });
    });

    it('tells leadership, or the gate is one nobody can pass', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);

      await service.requestHistoricalDeletion('l1', 'duplicate record', 'user-1');

      expect(mockBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'history.deletionRequested',
          leaseId: 'l1',
          reason: 'duplicate record',
          requestedById: 'user-1',
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'HISTORICAL_DELETION_REQUESTED' }),
      );
    });

    it('refuses for a lease that was recorded live', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(LIVE);

      await expect(service.requestHistoricalDeletion('l2', 'a good reason', 'user-1'))
        .rejects.toThrow(/recorded live/);
    });

    it('refuses a second pending request for the same record', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);
      mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue({ id: 'r1', status: 'PENDING' });

      await expect(service.requestHistoricalDeletion('l1', 'a good reason', 'user-1'))
        .rejects.toThrow(/already pending/);
    });

    it('lets a fresh request follow a rejection — rejection is not a permanent block', async () => {
      mockPrisma.lease.findUnique.mockResolvedValue(HISTORICAL);
      // Only PENDING blocks; a REJECTED row is not returned by that lookup.
      mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue(null);

      await expect(service.requestHistoricalDeletion('l1', 'trying again with detail', 'user-1'))
        .resolves.toBeTruthy();
    });
  });

  // Deciding / cancelling a request moved to HistoricalDeletionService (R6, entity-agnostic
  // — a Founder's queue mixes leases and sales) — see historical-deletion.service.spec.ts.
});
