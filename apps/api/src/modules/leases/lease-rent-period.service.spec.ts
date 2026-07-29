import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LeaseRentPeriodService,
  addMonthsUtc,
  assertRentInvariant,
  computeRentSchedule,
  monthsBetweenUtc,
  round2,
  summariseEffectiveRent,
} from './lease-rent-period.service';

/** UTC date literal — every boundary in this engine is a UTC calendar day. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Readable comparison of Decimal money. */
const money = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v).toFixed(2);

/** Inclusive-endDate period length in months. */
const lengthInMonths = (p: { startDate: Date; endDate: Date }) =>
  monthsBetweenUtc(p.startDate, new Date(p.endDate.getTime() + 86_400_000));

// A 36-month term: 2026-01-01 .. 2028-12-31 inclusive.
const TERM_36 = { leaseStart: d('2026-01-01'), leaseEnd: d('2028-12-31') };

describe('computeRentSchedule — compounding escalation', () => {
  it('36-month lease @ 5% every 12 months yields 3 periods that COMPOUND (100 → 105 → 110.25)', () => {
    const periods = computeRentSchedule({
      ...TERM_36,
      baseRent: 100,
      escalationPct: 5,
      escalationFreq: 12,
    });

    expect(periods).toHaveLength(3);
    expect(periods.map((p) => money(p.baseRent))).toEqual(['100.00', '105.00', '110.25']);
    // Simple interest off the original would give 110.00 — explicitly not that.
    expect(money(periods[2].baseRent)).not.toBe('110.00');
  });

  it('anchors every escalation boundary to leaseStart at a fixed month interval', () => {
    const periods = computeRentSchedule({
      ...TERM_36,
      baseRent: 100,
      escalationPct: 5,
      escalationFreq: 12,
    });
    expect(periods.map((p) => p.startDate.toISOString().slice(0, 10))).toEqual([
      '2026-01-01',
      '2027-01-01',
      '2028-01-01',
    ]);
    expect(periods.map((p) => p.endDate.toISOString().slice(0, 10))).toEqual([
      '2026-12-31',
      '2027-12-31',
      '2028-12-31',
    ]);
  });

  it('tags sources and escalationPct: first period INITIAL with no pct, rest AUTO_ESCALATION', () => {
    const periods = computeRentSchedule({
      ...TERM_36,
      baseRent: 100,
      escalationPct: 5,
      escalationFreq: 12,
    });
    expect(periods.map((p) => p.source)).toEqual(['INITIAL', 'AUTO_ESCALATION', 'AUTO_ESCALATION']);
    expect(periods[0].escalationPct).toBeNull();
    expect(money(periods[1].escalationPct!)).toBe('5.00');
    expect(periods.map((p) => p.sequence)).toEqual([1, 2, 3]);
  });

  it('supports a 6-month interval (interval semantics, not calendar anniversary)', () => {
    const periods = computeRentSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2026-12-31'),
      baseRent: 1000,
      escalationPct: 10,
      escalationFreq: 6,
    });
    expect(periods).toHaveLength(2);
    expect(periods.map((p) => p.startDate.toISOString().slice(0, 10))).toEqual([
      '2026-01-01',
      '2026-07-01',
    ]);
    expect(periods.map((p) => money(p.baseRent))).toEqual(['1000.00', '1100.00']);
  });
});

describe('computeRentSchedule — NNN never escalates', () => {
  it('carries nnnAmount forward unchanged while baseRent rises', () => {
    const periods = computeRentSchedule({
      ...TERM_36,
      baseRent: 100,
      nnnAmount: 25,
      escalationPct: 5,
      escalationFreq: 12,
    });

    expect(periods.map((p) => money(p.nnnAmount))).toEqual(['25.00', '25.00', '25.00']);
    expect(periods.map((p) => money(p.baseRent))).toEqual(['100.00', '105.00', '110.25']);
    expect(periods.map((p) => money(p.monthlyRent))).toEqual(['125.00', '130.00', '135.25']);
  });

  it('never compounds the NNN into the escalation base', () => {
    const periods = computeRentSchedule({
      ...TERM_36,
      baseRent: 100,
      nnnAmount: 25,
      escalationPct: 5,
      escalationFreq: 12,
    });
    // If NNN had been escalated, period 2 base would be 125 * 1.05 = 131.25.
    expect(money(periods[1].baseRent)).not.toBe('131.25');
  });
});

describe('computeRentSchedule — monthlyRent === baseRent + nnnAmount on every row', () => {
  const cases: Array<[string, Parameters<typeof computeRentSchedule>[0]]> = [
    ['flat', { ...TERM_36, baseRent: 4200 }],
    ['escalating', { ...TERM_36, baseRent: 4200, escalationPct: 3.5, escalationFreq: 12 }],
    [
      'escalating + NNN + free rent',
      {
        ...TERM_36,
        baseRent: 4200,
        nnnAmount: 812.5,
        escalationPct: 3.5,
        escalationFreq: 12,
        freeRentMonths: 2,
      },
    ],
    [
      'free rent mid-term crossing an escalation boundary',
      {
        ...TERM_36,
        baseRent: 3000,
        nnnAmount: 400,
        escalationPct: 4,
        escalationFreq: 12,
        freeRentMonths: 4,
        freeRentStartDate: d('2026-11-01'),
      },
    ],
  ];

  it.each(cases)('holds for: %s', (_label, input) => {
    const periods = computeRentSchedule(input);
    expect(periods.length).toBeGreaterThan(0);
    for (const p of periods) {
      expect(money(p.monthlyRent)).toBe(money(p.baseRent.add(p.nnnAmount)));
      expect(() => assertRentInvariant(p)).not.toThrow();
    }
  });
});

describe('assertRentInvariant', () => {
  it('throws BadRequestException when monthlyRent does not equal baseRent + nnnAmount', () => {
    expect(() =>
      assertRentInvariant({ baseRent: 100, nnnAmount: 25, monthlyRent: 130 }),
    ).toThrow(BadRequestException);
  });

  it('names both components and the delta in the message', () => {
    try {
      assertRentInvariant({ baseRent: 100, nnnAmount: 25, monthlyRent: 130 });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as Error).message).toContain('130.00');
      expect((e as Error).message).toContain('100.00');
      expect((e as Error).message).toContain('25.00');
      expect((e as Error).message).toContain('Off by 5.00');
    }
  });

  it('accepts an exact match', () => {
    expect(() =>
      assertRentInvariant({ baseRent: '100.10', nnnAmount: '25.90', monthlyRent: '126.00' }),
    ).not.toThrow();
  });
});

describe('computeRentSchedule — free rent sits inside the term', () => {
  const input = {
    ...TERM_36,
    baseRent: 100,
    escalationPct: 5,
    escalationFreq: 12,
    freeRentMonths: 3,
  };

  it('36-month lease with 3 free months leaves 33 paying months', () => {
    const periods = computeRentSchedule(input);
    const paying = periods.filter((p) => !p.isFreeRent);
    const free = periods.filter((p) => p.isFreeRent);

    expect(paying.reduce((s, p) => s + lengthInMonths(p), 0)).toBe(33);
    expect(free.reduce((s, p) => s + lengthInMonths(p), 0)).toBe(3);
  });

  it('does NOT extend leaseEnd', () => {
    const periods = computeRentSchedule(input);
    const last = periods[periods.length - 1];
    expect(last.endDate.toISOString().slice(0, 10)).toBe('2028-12-31');
    // whole timeline still 36 months
    expect(periods.reduce((s, p) => s + lengthInMonths(p), 0)).toBe(36);
  });

  it('keeps the escalation clock anchored to leaseStart, not to the first paying month', () => {
    const periods = computeRentSchedule(input);
    const escalations = periods.filter((p) => p.source === 'AUTO_ESCALATION');
    // Still 1 Jan each year — NOT 1 Apr (which is when rent actually starts).
    expect(escalations.map((p) => p.startDate.toISOString().slice(0, 10))).toEqual([
      '2027-01-01',
      '2028-01-01',
    ]);
  });

  it('emits free months as zeroed FREE_RENT periods', () => {
    const periods = computeRentSchedule(input);
    const free = periods.find((p) => p.isFreeRent)!;
    expect(free.source).toBe('FREE_RENT');
    expect(money(free.baseRent)).toBe('0.00');
    expect(money(free.nnnAmount)).toBe('0.00');
    expect(money(free.monthlyRent)).toBe('0.00');
    expect(free.startDate.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(free.endDate.toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(free.sequence).toBe(1);
  });

  it('splits an escalation period when the abatement lands mid-period, without shifting rents', () => {
    const periods = computeRentSchedule({
      ...TERM_36,
      baseRent: 100,
      escalationPct: 5,
      escalationFreq: 12,
      freeRentMonths: 2,
      freeRentStartDate: d('2026-05-01'),
    });

    expect(periods.map((p) => p.startDate.toISOString().slice(0, 10))).toEqual([
      '2026-01-01',
      '2026-05-01',
      '2026-07-01',
      '2027-01-01',
      '2028-01-01',
    ]);
    // Both halves of year one are still at the un-escalated 100.
    expect(money(periods[0].baseRent)).toBe('100.00');
    expect(money(periods[2].baseRent)).toBe('100.00');
    expect(periods[1].isFreeRent).toBe(true);
    // Year two still escalates on schedule.
    expect(money(periods[3].baseRent)).toBe('105.00');
  });

  it('clips a free-rent window that would spill past leaseEnd', () => {
    const periods = computeRentSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2026-12-31'),
      baseRent: 100,
      freeRentMonths: 24,
      freeRentStartDate: d('2026-10-01'),
    });
    const free = periods.find((p) => p.isFreeRent)!;
    expect(free.endDate.toISOString().slice(0, 10)).toBe('2026-12-31');
  });
});

describe('computeRentSchedule — no escalation', () => {
  it('produces exactly one period spanning the whole term when escalationPct is absent', () => {
    const periods = computeRentSchedule({ ...TERM_36, baseRent: 4200, nnnAmount: 300 });
    expect(periods).toHaveLength(1);
    expect(periods[0].source).toBe('INITIAL');
    expect(periods[0].escalationPct).toBeNull();
    expect(periods[0].startDate.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(periods[0].endDate.toISOString().slice(0, 10)).toBe('2028-12-31');
    expect(money(periods[0].monthlyRent)).toBe('4500.00');
  });

  it('treats a 0% escalation and a missing escalationFreq the same as no escalation', () => {
    expect(
      computeRentSchedule({ ...TERM_36, baseRent: 100, escalationPct: 0, escalationFreq: 12 }),
    ).toHaveLength(1);
    expect(computeRentSchedule({ ...TERM_36, baseRent: 100, escalationPct: 5 })).toHaveLength(1);
  });
});

describe('computeRentSchedule — intervals that do not divide the term evenly', () => {
  it('18-month interval in a 36-month term gives 2 periods, ending exactly at leaseEnd', () => {
    const periods = computeRentSchedule({
      ...TERM_36,
      baseRent: 1000,
      escalationPct: 5,
      escalationFreq: 18,
    });
    expect(periods).toHaveLength(2);
    expect(periods.map((p) => p.startDate.toISOString().slice(0, 10))).toEqual([
      '2026-01-01',
      '2027-07-01',
    ]);
    expect(periods[1].endDate.toISOString().slice(0, 10)).toBe('2028-12-31');
    expect(periods.map((p) => money(p.baseRent))).toEqual(['1000.00', '1050.00']);
  });

  it('12-month interval in a 30-month term truncates the final period at leaseEnd', () => {
    const periods = computeRentSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2028-06-30'), // 30 months
      baseRent: 1000,
      escalationPct: 5,
      escalationFreq: 12,
    });
    expect(periods).toHaveLength(3);
    expect(periods[2].startDate.toISOString().slice(0, 10)).toBe('2028-01-01');
    expect(periods[2].endDate.toISOString().slice(0, 10)).toBe('2028-06-30');
    expect(lengthInMonths(periods[2])).toBe(6);
    expect(periods.reduce((s, p) => s + lengthInMonths(p), 0)).toBe(30);
  });

  it('never emits a period starting on or after leaseEnd', () => {
    for (const freq of [1, 5, 7, 11, 12, 13, 18, 24, 35, 36, 40]) {
      const periods = computeRentSchedule({
        ...TERM_36,
        baseRent: 1000,
        escalationPct: 3,
        escalationFreq: freq,
      });
      for (const p of periods) {
        expect(p.startDate.getTime()).toBeLessThan(TERM_36.leaseEnd.getTime());
        expect(p.endDate.getTime()).toBeLessThanOrEqual(TERM_36.leaseEnd.getTime());
      }
      expect(periods.reduce((s, p) => s + lengthInMonths(p), 0)).toBe(36);
    }
  });

  it('does not open a degenerate trailing period when leaseEnd is stored exclusive-style', () => {
    const periods = computeRentSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2029-01-01'), // day AFTER a 36-month term
      baseRent: 1000,
      escalationPct: 5,
      escalationFreq: 12,
    });
    expect(periods).toHaveLength(3);
    expect(periods.map((p) => money(p.baseRent))).toEqual(['1000.00', '1050.00', '1102.50']);
  });

  it('rejects a term that ends on or before it starts', () => {
    expect(() =>
      computeRentSchedule({ leaseStart: d('2026-01-01'), leaseEnd: d('2026-01-01'), baseRent: 1 }),
    ).toThrow(BadRequestException);
  });
});

describe('computeRentSchedule — rounding (half-up to 2dp at each period boundary)', () => {
  it('rounds a repeating-decimal escalation at every boundary', () => {
    const periods = computeRentSchedule({
      ...TERM_36,
      baseRent: '3333.33',
      escalationPct: 7,
      escalationFreq: 12,
    });
    // 3333.33 x 1.07 = 3566.6631 -> 3566.66
    // 3566.66 x 1.07 = 3816.3262 -> 3816.33   (compounds off the ROUNDED 3566.66)
    expect(periods.map((p) => money(p.baseRent))).toEqual(['3333.33', '3566.66', '3816.33']);
  });

  it('every emitted amount is exactly 2dp — nothing leaks full Decimal precision', () => {
    const periods = computeRentSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2031-12-31'),
      baseRent: '3333.33',
      nnnAmount: '111.11',
      escalationPct: '3.33',
      escalationFreq: 12,
    });
    expect(periods.length).toBeGreaterThan(3);
    for (const p of periods) {
      expect(p.baseRent.decimalPlaces()).toBeLessThanOrEqual(2);
      expect(p.nnnAmount.decimalPlaces()).toBeLessThanOrEqual(2);
      expect(p.monthlyRent.decimalPlaces()).toBeLessThanOrEqual(2);
    }
  });

  it('each period compounds off the PREVIOUS period stored value, not the unrounded original', () => {
    const pct = new Prisma.Decimal('7');
    const factor = new Prisma.Decimal(1).add(pct.div(100));
    const periods = computeRentSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2031-12-31'),
      baseRent: '3333.33',
      escalationPct: pct,
      escalationFreq: 12,
    });
    for (let i = 1; i < periods.length; i++) {
      expect(money(periods[i].baseRent)).toBe(money(round2(periods[i - 1].baseRent.mul(factor))));
    }
  });

  it('rounds half-up, not half-even', () => {
    // 100.005 -> 100.01 under HALF_UP; 100.00 under HALF_EVEN.
    expect(round2('100.005').toFixed(2)).toBe('100.01');
  });
});

describe('summariseEffectiveRent', () => {
  it('straight-lines rent across the term with free months counted at zero', () => {
    const periods = computeRentSchedule({
      ...TERM_36,
      baseRent: 1000,
      escalationPct: 5,
      escalationFreq: 12,
      freeRentMonths: 3,
    });
    const summary = summariseEffectiveRent(periods, TERM_36.leaseEnd, 36);

    // 9 x 1000 + 12 x 1050 + 12 x 1102.50 = 9000 + 12600 + 13230 = 34830
    expect(money(summary.totalContractedRent)).toBe('34830.00');
    expect(summary.payingMonths).toBe(33);
    expect(summary.freeRentMonths).toBe(3);
    expect(summary.termMonths).toBe(36);
    expect(money(summary.effectiveMonthlyRent)).toBe('967.50'); // 34830 / 36
  });

  it('free rent drags the effective rent below the contractual first-year rent', () => {
    const withFree = summariseEffectiveRent(
      computeRentSchedule({ ...TERM_36, baseRent: 1000, freeRentMonths: 6 }),
      TERM_36.leaseEnd,
      36,
    );
    const withoutFree = summariseEffectiveRent(
      computeRentSchedule({ ...TERM_36, baseRent: 1000 }),
      TERM_36.leaseEnd,
      36,
    );
    expect(money(withoutFree.effectiveMonthlyRent)).toBe('1000.00');
    expect(money(withFree.effectiveMonthlyRent)).toBe('833.33'); // 30/36 x 1000
    expect(withFree.effectiveMonthlyRent.lt(withoutFree.effectiveMonthlyRent)).toBe(true);
  });

  it('separates the NNN-inclusive KPI from the base-rent-only KPI', () => {
    const periods = computeRentSchedule({ ...TERM_36, baseRent: 1000, nnnAmount: 200 });
    const summary = summariseEffectiveRent(periods, TERM_36.leaseEnd, 36);
    expect(money(summary.effectiveMonthlyRent)).toBe('1200.00');
    expect(money(summary.effectiveMonthlyBaseRent)).toBe('1000.00');
  });
});

describe('date helpers', () => {
  it('addMonthsUtc clamps instead of overflowing month ends', () => {
    expect(addMonthsUtc(d('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonthsUtc(d('2028-01-31'), 1).toISOString().slice(0, 10)).toBe('2028-02-29'); // leap
    expect(addMonthsUtc(d('2026-03-31'), 1).toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('monthsBetweenUtc counts whole months by anniversary', () => {
    expect(monthsBetweenUtc(d('2026-01-01'), d('2027-01-01'))).toBe(12);
    expect(monthsBetweenUtc(d('2026-01-31'), d('2026-02-28'))).toBe(1);
    expect(monthsBetweenUtc(d('2026-01-01'), d('2026-01-01'))).toBe(0);
  });
});

// ============================================================================
// Service — DB-touching paths, Prisma mocked in the house style
// ============================================================================

const mockPrisma: any = {
  lease: { findUnique: jest.fn() },
  leaseRentPeriod: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};

const LEASE = {
  id: 'lease-1',
  leaseStart: d('2026-01-01'),
  leaseEnd: d('2028-12-31'),
  termMonths: 36,
  monthlyRent: new Prisma.Decimal(1000),
  escalationPct: new Prisma.Decimal(5),
  escalationFreq: 12,
  freeRentMonths: null,
  freeRentStartDate: null,
  deletedAt: null,
};

function makeService() {
  return new LeaseRentPeriodService(mockPrisma as any);
}

/** Persisted-row shape, as Prisma would hand it back. */
const row = (
  sequence: number,
  startDate: string,
  endDate: string | null,
  base: string,
  nnn = '0',
  extra: Record<string, unknown> = {},
) => ({
  id: `p${sequence}`,
  leaseId: 'lease-1',
  sequence,
  startDate: d(startDate),
  endDate: endDate ? d(endDate) : null,
  baseRent: new Prisma.Decimal(base),
  nnnAmount: new Prisma.Decimal(nnn),
  monthlyRent: new Prisma.Decimal(base).add(new Prisma.Decimal(nnn)),
  isFreeRent: false,
  escalationPct: null,
  source: 'INITIAL',
  reason: null,
  createdById: null,
  createdAt: new Date(),
  ...extra,
});

describe('LeaseRentPeriodService.generateForLease', () => {
  let service: LeaseRentPeriodService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lease.findUnique.mockResolvedValue(LEASE);
  });

  it('writes the computed schedule when the lease has no periods yet', async () => {
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(['saved']);

    await service.generateForLease('lease-1', { createdById: 'u1' });

    expect(mockPrisma.leaseRentPeriod.createMany).toHaveBeenCalledTimes(1);
    const { data, skipDuplicates } = mockPrisma.leaseRentPeriod.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data).toHaveLength(3);
    expect(data.map((r: any) => r.sequence)).toEqual([1, 2, 3]);
    expect(data.map((r: any) => new Prisma.Decimal(r.baseRent).toFixed(2))).toEqual([
      '1000.00',
      '1050.00',
      '1102.50',
    ]);
    expect(data.every((r: any) => r.createdById === 'u1')).toBe(true);
  });

  it('is idempotent — a second run over existing periods writes nothing', async () => {
    const existing = [row(1, '2026-01-01', '2026-12-31', '1000')];
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue(existing);

    const result = await service.generateForLease('lease-1');

    expect(mockPrisma.leaseRentPeriod.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.leaseRentPeriod.deleteMany).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it('splits monthlyRent into base + NNN when an nnnAmount is supplied', async () => {
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await service.generateForLease('lease-1', { nnnAmount: 200 });

    const { data } = mockPrisma.leaseRentPeriod.createMany.mock.calls[0][0];
    // Headline monthlyRent (1000) stays the contractual total; base is the remainder.
    expect(new Prisma.Decimal(data[0].baseRent).toFixed(2)).toBe('800.00');
    expect(new Prisma.Decimal(data[0].nnnAmount).toFixed(2)).toBe('200.00');
    expect(new Prisma.Decimal(data[0].monthlyRent).toFixed(2)).toBe('1000.00');
    // NNN untouched by escalation; only base compounds.
    expect(new Prisma.Decimal(data[1].nnnAmount).toFixed(2)).toBe('200.00');
    expect(new Prisma.Decimal(data[1].baseRent).toFixed(2)).toBe('840.00');
  });

  it('rejects a lease that does not exist or was soft-deleted', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue(null);
    await expect(service.generateForLease('nope')).rejects.toThrow('Lease not found');

    mockPrisma.lease.findUnique.mockResolvedValue({ ...LEASE, deletedAt: new Date() });
    await expect(service.generateForLease('lease-1')).rejects.toThrow('Lease not found');
  });
});

describe('LeaseRentPeriodService.regenerateFuture — past periods are immutable', () => {
  let service: LeaseRentPeriodService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    jest.useFakeTimers().setSystemTime(d('2027-06-15'));
    mockPrisma.lease.findUnique.mockResolvedValue(LEASE);
  });

  afterEach(() => jest.useRealTimers());

  it('deletes only the periods that start in the future', async () => {
    const existing = [
      row(1, '2026-01-01', '2026-12-31', '1000'),
      row(2, '2027-01-01', '2027-12-31', '1050'), // in effect today — frozen
      row(3, '2028-01-01', '2028-12-31', '1102.50'), // future — rewritable
    ];
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue(existing);

    await service.regenerateFuture('lease-1', 'u9');

    expect(mockPrisma.leaseRentPeriod.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['p3'] } },
    });
  });

  it('re-inserts future periods with sequences continuing after the frozen ones', async () => {
    const existing = [
      row(1, '2026-01-01', '2026-12-31', '1000'),
      row(2, '2027-01-01', '2027-12-31', '1050'),
      row(3, '2028-01-01', '2028-12-31', '1102.50'),
    ];
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue(existing);

    await service.regenerateFuture('lease-1', 'u9');

    const { data } = mockPrisma.leaseRentPeriod.createMany.mock.calls[0][0];
    expect(data).toHaveLength(1);
    expect(data[0].sequence).toBe(3); // max frozen sequence (2) + 1
    expect(data[0].startDate.toISOString().slice(0, 10)).toBe('2028-01-01');
    expect(data[0].createdById).toBe('u9');
  });

  it('writes nothing at all when the whole term is already in the past', async () => {
    jest.setSystemTime(d('2030-01-01'));
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([
      row(1, '2026-01-01', '2026-12-31', '1000'),
      row(2, '2027-01-01', '2027-12-31', '1050'),
      row(3, '2028-01-01', '2028-12-31', '1102.50'),
    ]);

    await service.regenerateFuture('lease-1');

    expect(mockPrisma.leaseRentPeriod.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.leaseRentPeriod.createMany).not.toHaveBeenCalled();
  });
});

describe('LeaseRentPeriodService.getEffectivePeriod', () => {
  let service: LeaseRentPeriodService;

  const periods = [
    row(1, '2026-01-01', '2026-12-31', '1000'),
    row(2, '2027-01-01', '2027-12-31', '1050'),
    row(3, '2028-01-01', '2028-12-31', '1102.50'),
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    // Mirror the service's own ordering (startDate desc) plus its lte filter.
    mockPrisma.leaseRentPeriod.findMany.mockImplementation((args: any) => {
      const lte: Date = args.where.startDate.lte;
      return Promise.resolve(
        periods.filter((p) => p.startDate <= lte).sort((a, b) => +b.startDate - +a.startDate),
      );
    });
  });

  it('returns the period covering the FIRST day of that period', async () => {
    const p = await service.getEffectivePeriod('lease-1', d('2027-01-01'));
    expect(p?.sequence).toBe(2);
  });

  it('returns the period covering the LAST day of that period', async () => {
    const p = await service.getEffectivePeriod('lease-1', d('2027-12-31'));
    expect(p?.sequence).toBe(2);
  });

  it('rolls over on the day after a period ends', async () => {
    expect((await service.getEffectivePeriod('lease-1', d('2028-01-01')))?.sequence).toBe(3);
    expect((await service.getEffectivePeriod('lease-1', d('2026-12-31')))?.sequence).toBe(1);
  });

  it('ignores time-of-day on the asOf date', async () => {
    const p = await service.getEffectivePeriod(
      'lease-1',
      new Date('2027-12-31T23:59:59.000Z'),
    );
    expect(p?.sequence).toBe(2);
  });

  it('returns null before the lease starts and after it ends', async () => {
    expect(await service.getEffectivePeriod('lease-1', d('2025-12-31'))).toBeNull();
    expect(await service.getEffectivePeriod('lease-1', d('2029-01-01'))).toBeNull();
  });

  it('latest-start-wins: a MANUAL period supersedes the scheduled one it lands inside', async () => {
    const manual = row(4, '2027-07-01', '2027-12-31', '1200', '0', {
      id: 'p4',
      source: 'MANUAL',
      reason: 'renegotiated',
    });
    mockPrisma.leaseRentPeriod.findMany.mockImplementation((args: any) => {
      const lte: Date = args.where.startDate.lte;
      return Promise.resolve(
        [...periods, manual]
          .filter((p) => p.startDate <= lte)
          .sort((a, b) => +b.startDate - +a.startDate),
      );
    });

    expect((await service.getEffectivePeriod('lease-1', d('2027-06-30')))?.id).toBe('p2');
    expect((await service.getEffectivePeriod('lease-1', d('2027-07-01')))?.id).toBe('p4');
  });
});

describe('LeaseRentPeriodService.addManualPeriod', () => {
  let service: LeaseRentPeriodService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lease.findUnique.mockResolvedValue(LEASE);
    mockPrisma.leaseRentPeriod.findFirst.mockResolvedValue({ sequence: 3 });
    mockPrisma.leaseRentPeriod.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'new', ...args.data }),
    );
  });

  const base = {
    leaseId: 'lease-1',
    startDate: d('2027-07-01'),
    baseRent: 1200,
    reason: 'Renegotiated after tenant expansion',
  };

  it('throws when no reason is given', async () => {
    await expect(
      service.addManualPeriod({ ...base, reason: undefined as any }),
    ).rejects.toThrow(BadRequestException);
    await expect(service.addManualPeriod({ ...base, reason: '' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.addManualPeriod({ ...base, reason: '   ' })).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPrisma.leaseRentPeriod.create).not.toHaveBeenCalled();
  });

  it('appends with source MANUAL, the trimmed reason and the next sequence', async () => {
    const created: any = await service.addManualPeriod({
      ...base,
      reason: '  Renegotiated  ',
      nnnAmount: 150,
      createdById: 'u7',
    });

    expect(created.source).toBe('MANUAL');
    expect(created.reason).toBe('Renegotiated');
    expect(created.sequence).toBe(4);
    expect(created.createdById).toBe('u7');
    expect(new Prisma.Decimal(created.monthlyRent).toFixed(2)).toBe('1350.00');
    expect(created.isFreeRent).toBe(false);
  });

  it('rejects a monthlyRent that breaks the base + NNN invariant', async () => {
    await expect(
      service.addManualPeriod({ ...base, nnnAmount: 150, monthlyRent: 1400 }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.leaseRentPeriod.create).not.toHaveBeenCalled();
  });

  it('accepts a monthlyRent that matches base + NNN exactly', async () => {
    const created: any = await service.addManualPeriod({
      ...base,
      nnnAmount: 150,
      monthlyRent: 1350,
    });
    expect(new Prisma.Decimal(created.monthlyRent).toFixed(2)).toBe('1350.00');
  });

  it('rejects a start date outside the lease term and an end date past leaseEnd', async () => {
    await expect(
      service.addManualPeriod({ ...base, startDate: d('2025-01-01') }),
    ).rejects.toThrow('inside the lease term');
    await expect(
      service.addManualPeriod({ ...base, startDate: d('2029-01-01') }),
    ).rejects.toThrow('inside the lease term');
    await expect(
      service.addManualPeriod({ ...base, endDate: d('2029-06-30') }),
    ).rejects.toThrow('past leaseEnd');
    await expect(
      service.addManualPeriod({ ...base, endDate: d('2027-01-01') }),
    ).rejects.toThrow('cannot precede');
  });

  it('accepts an ISO date string as well as a Date', async () => {
    const created: any = await service.addManualPeriod({
      ...base,
      startDate: '2027-07-01',
    } as any);
    expect(created.startDate.toISOString().slice(0, 10)).toBe('2027-07-01');
  });
});

describe('LeaseRentPeriodService.getFirstPayingMonth', () => {
  let service: LeaseRentPeriodService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('returns the start of the first non-free period', async () => {
    mockPrisma.leaseRentPeriod.findFirst.mockResolvedValue({ startDate: d('2026-04-01') });
    await expect(service.getFirstPayingMonth('lease-1')).resolves.toEqual(d('2026-04-01'));
    expect(mockPrisma.leaseRentPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leaseId: 'lease-1', isFreeRent: false } }),
    );
  });

  it('returns null when there is no paying period', async () => {
    mockPrisma.leaseRentPeriod.findFirst.mockResolvedValue(null);
    await expect(service.getFirstPayingMonth('lease-1')).resolves.toBeNull();
  });
});

describe('LeaseRentPeriodService.getEffectiveRent', () => {
  let service: LeaseRentPeriodService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lease.findUnique.mockResolvedValue(LEASE);
  });

  it('straight-lines the persisted periods over the lease term', async () => {
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([
      row(1, '2026-01-01', '2026-12-31', '1000'),
      row(2, '2027-01-01', '2027-12-31', '1050'),
      row(3, '2028-01-01', '2028-12-31', '1102.50'),
    ]);

    const summary = await service.getEffectiveRent('lease-1');
    // 12 x 1000 + 12 x 1050 + 12 x 1102.50 = 12000 + 12600 + 13230 = 37830
    expect(summary.totalContractedRent.toFixed(2)).toBe('37830.00');
    // 37830 / 36 = 1050.8333... -> 1050.83 (half-up at 2dp)
    expect(summary.effectiveMonthlyRent.toFixed(2)).toBe('1050.83');
    expect(summary.payingMonths).toBe(36);
  });

  it('throws when the lease has no rent periods yet', async () => {
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([]);
    await expect(service.getEffectiveRent('lease-1')).rejects.toThrow(BadRequestException);
  });
});
