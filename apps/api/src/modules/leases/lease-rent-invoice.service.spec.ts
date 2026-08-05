import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LeaseRentInvoiceService,
  computeRentInvoiceSchedule,
  daysInMonthUtc,
  deriveInvoiceStatus,
  findCoveringPeriod,
  firstOfMonthUtc,
  resolveDueDate,
  summariseInvoices,
} from './lease-rent-invoice.service';
import { computeRentSchedule } from './lease-rent-period.service';

/** UTC date literal — every boundary in this ledger is a UTC calendar day. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Readable comparison of Decimal money. */
const money = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v).toFixed(2);
/** Readable comparison of a UTC date. */
const day = (v: Date) => v.toISOString().slice(0, 10);

/** A single flat rent period spanning a whole term. */
const flatPeriod = (start: string, end: string, rent: number | string, id = 'p1') => ({
  id,
  startDate: d(start),
  endDate: d(end),
  monthlyRent: new Prisma.Decimal(rent),
  isFreeRent: false,
});

// ============================================================================
// Pure engine — computeRentInvoiceSchedule
// ============================================================================

describe('computeRentInvoiceSchedule — whole months', () => {
  const input = {
    leaseStart: d('2026-01-01'),
    leaseEnd: d('2026-12-31'),
    periods: [flatPeriod('2026-01-01', '2026-12-31', 5000)],
    through: d('2027-06-01'),
  };

  it('a 12-month lease starting on the 1st yields 12 full-rent invoices, none prorated', () => {
    const invoices = computeRentInvoiceSchedule(input);

    expect(invoices).toHaveLength(12);
    expect(invoices.every((i) => money(i.amountDue) === '5000.00')).toBe(true);
    expect(invoices.every((i) => i.isProrated === false)).toBe(true);
    expect(invoices.every((i) => i.billedDays === i.monthDays)).toBe(true);
  });

  it('keys every row on the first day of its month, in order', () => {
    const invoices = computeRentInvoiceSchedule(input);
    expect(invoices.map((i) => day(i.periodMonth))).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
    ]);
  });

  it('records the real calendar length of each month, not a banker 30', () => {
    const invoices = computeRentInvoiceSchedule(input);
    expect(invoices.map((i) => i.monthDays)).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
  });

  it('stops at the horizon: `through` mid-term bills only the months up to it', () => {
    const invoices = computeRentInvoiceSchedule({ ...input, through: d('2026-04-17') });
    expect(invoices).toHaveLength(4); // Jan..Apr — the month CONTAINING `through` is billed
    expect(day(invoices[3].periodMonth)).toBe('2026-04-01');
  });

  it('bills nothing when the horizon predates the lease', () => {
    expect(computeRentInvoiceSchedule({ ...input, through: d('2025-11-30') })).toHaveLength(0);
  });

  it('bills nothing when there is no rent timeline at all', () => {
    expect(computeRentInvoiceSchedule({ ...input, periods: [] })).toHaveLength(0);
  });
});

describe('computeRentInvoiceSchedule — proration of the FIRST month', () => {
  // 15 Mar .. 31 Mar inclusive = 17 of March's 31 days.
  const invoices = computeRentInvoiceSchedule({
    leaseStart: d('2026-03-15'),
    leaseEnd: d('2027-03-14'),
    periods: [flatPeriod('2026-03-15', '2027-03-14', 5000)],
    through: d('2027-06-01'),
  });

  it('bills 17/31 of the month a lease starting 15 March', () => {
    const first = invoices[0];
    expect(day(first.periodMonth)).toBe('2026-03-01');
    // 5000 x 17 / 31 = 2741.935483... -> 2741.94 half-up
    expect(money(first.amountDue)).toBe('2741.94');
  });

  it('records billedDays / monthDays so the figure can be explained to a tenant', () => {
    expect(invoices[0].billedDays).toBe(17);
    expect(invoices[0].monthDays).toBe(31);
    expect(invoices[0].isProrated).toBe(true);
  });

  it('returns to full rent from the first whole month', () => {
    expect(day(invoices[1].periodMonth)).toBe('2026-04-01');
    expect(money(invoices[1].amountDue)).toBe('5000.00');
    expect(invoices[1].isProrated).toBe(false);
    expect(invoices[1].billedDays).toBe(30);
  });
});

describe('computeRentInvoiceSchedule — proration of the LAST month', () => {
  it('prorates a lease that ENDS mid-month', () => {
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2026-09-14'),
      periods: [flatPeriod('2026-01-01', '2026-09-14', 5000)],
      through: d('2027-01-01'),
    });

    expect(invoices).toHaveLength(9);
    const last = invoices[8];
    expect(day(last.periodMonth)).toBe('2026-09-01');
    expect(last.billedDays).toBe(14);
    expect(last.monthDays).toBe(30);
    expect(last.isProrated).toBe(true);
    // 5000 x 14 / 30 = 2333.333... -> 2333.33
    expect(money(last.amountDue)).toBe('2333.33');
  });

  it('prorates BOTH ends of a mid-month-to-mid-month term, and the two halves sum to one month', () => {
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-03-15'),
      leaseEnd: d('2027-03-14'),
      periods: [flatPeriod('2026-03-15', '2027-03-14', 5000)],
      through: d('2027-06-01'),
    });

    expect(invoices).toHaveLength(13); // Mar 2026 .. Mar 2027
    const first = invoices[0];
    const last = invoices[12];
    expect(first.isProrated).toBe(true);
    expect(last.isProrated).toBe(true);
    expect(last.billedDays).toBe(14);
    expect(last.monthDays).toBe(31);
    // 5000 x 14 / 31 = 2258.0645... -> 2258.06
    expect(money(last.amountDue)).toBe('2258.06');
    // 17/31 + 14/31 = 31/31: the split March pair bills exactly one month's rent.
    expect(money(first.amountDue.add(last.amountDue))).toBe('5000.00');
  });

  it('bills a single day when a term ends on the 1st of a month', () => {
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2026-02-01'),
      periods: [flatPeriod('2026-01-01', '2026-02-01', 2800)],
      through: d('2026-06-01'),
    });
    expect(invoices).toHaveLength(2);
    expect(invoices[1].billedDays).toBe(1);
    expect(invoices[1].monthDays).toBe(28);
    expect(money(invoices[1].amountDue)).toBe('100.00'); // 2800 / 28
  });
});

describe('computeRentInvoiceSchedule — rent due day', () => {
  const term = {
    leaseStart: d('2026-01-01'),
    leaseEnd: d('2026-12-31'),
    periods: [flatPeriod('2026-01-01', '2026-12-31', 5000)],
    through: d('2027-06-01'),
  };

  it('defaults a NULL rentDueDay to the 1st of every month', () => {
    const invoices = computeRentInvoiceSchedule({ ...term, rentDueDay: null });
    expect(invoices.map((i) => day(i.dueDate))).toEqual(invoices.map((i) => day(i.periodMonth)));
    expect(day(invoices[1].dueDate)).toBe('2026-02-01');
  });

  it('treats an omitted rentDueDay the same as null', () => {
    const invoices = computeRentInvoiceSchedule(term);
    expect(day(invoices[0].dueDate)).toBe('2026-01-01');
  });

  it('honours a mid-month due day', () => {
    const invoices = computeRentInvoiceSchedule({ ...term, rentDueDay: 10 });
    expect(invoices.map((i) => day(i.dueDate)).slice(0, 3)).toEqual([
      '2026-01-10',
      '2026-02-10',
      '2026-03-10',
    ]);
  });

  it('CLAMPS rentDueDay 31 to 28 February in a non-leap year instead of rolling into March', () => {
    const invoices = computeRentInvoiceSchedule({ ...term, rentDueDay: 31 });
    const feb = invoices.find((i) => day(i.periodMonth) === '2026-02-01')!;
    expect(day(feb.dueDate)).toBe('2026-02-28');
    expect(feb.dueDate.getUTCMonth()).toBe(1); // still February
  });

  it('CLAMPS rentDueDay 31 to 29 February in a LEAP year', () => {
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2028-01-01'),
      leaseEnd: d('2028-12-31'),
      periods: [flatPeriod('2028-01-01', '2028-12-31', 5000)],
      through: d('2029-06-01'),
      rentDueDay: 31,
    });
    const feb = invoices.find((i) => day(i.periodMonth) === '2028-02-01')!;
    expect(day(feb.dueDate)).toBe('2028-02-29');
  });

  it('clamps rentDueDay 31 to the last day of every short month, not just February', () => {
    const invoices = computeRentInvoiceSchedule({ ...term, rentDueDay: 31 });
    expect(invoices.map((i) => day(i.dueDate))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]);
  });

  it('never lets a due date fall outside the days actually billed', () => {
    // Starts 15 Mar with a 1st-of-month due day: the first invoice would otherwise
    // be born overdue. Ends 14 Sep: the last would otherwise fall due after the
    // tenant had gone.
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-03-15'),
      leaseEnd: d('2026-09-14'),
      periods: [flatPeriod('2026-03-15', '2026-09-14', 5000)],
      through: d('2027-01-01'),
      rentDueDay: 25,
    });
    expect(day(invoices[0].dueDate)).toBe('2026-03-25'); // inside 15..31 Mar, untouched
    expect(day(invoices[invoices.length - 1].dueDate)).toBe('2026-09-14'); // pulled back

    const firstOfMonth = computeRentInvoiceSchedule({
      leaseStart: d('2026-03-15'),
      leaseEnd: d('2026-09-14'),
      periods: [flatPeriod('2026-03-15', '2026-09-14', 5000)],
      through: d('2027-01-01'),
      rentDueDay: 1,
    });
    expect(day(firstOfMonth[0].dueDate)).toBe('2026-03-15'); // pushed forward to move-in
  });
});

describe('resolveDueDate (pure)', () => {
  it('clamps to month length', () => {
    expect(day(resolveDueDate(d('2026-02-01'), 31))).toBe('2026-02-28');
    expect(day(resolveDueDate(d('2028-02-01'), 31))).toBe('2028-02-29');
    expect(day(resolveDueDate(d('2026-04-01'), 31))).toBe('2026-04-30');
    expect(day(resolveDueDate(d('2026-01-01'), 31))).toBe('2026-01-31');
  });

  it('null / undefined / out-of-range days fall back into 1..monthLength', () => {
    expect(day(resolveDueDate(d('2026-02-01'), null))).toBe('2026-02-01');
    expect(day(resolveDueDate(d('2026-02-01')))).toBe('2026-02-01');
    expect(day(resolveDueDate(d('2026-02-01'), 0))).toBe('2026-02-01');
    expect(day(resolveDueDate(d('2026-02-01'), 99))).toBe('2026-02-28');
  });

  it('ignores time-of-day on the month it is given', () => {
    expect(day(resolveDueDate(new Date('2026-02-17T23:45:00.000Z'), 10))).toBe('2026-02-10');
  });
});

describe('daysInMonthUtc / firstOfMonthUtc', () => {
  it('knows leap Februaries', () => {
    expect(daysInMonthUtc(d('2026-02-14'))).toBe(28);
    expect(daysInMonthUtc(d('2028-02-14'))).toBe(29);
    expect(daysInMonthUtc(d('2100-02-14'))).toBe(28); // century, not a leap year
  });

  it('normalises any day of a month to its first day at UTC midnight', () => {
    const first = firstOfMonthUtc(new Date('2026-07-29T18:22:11.500Z'));
    expect(first.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('computeRentInvoiceSchedule — free rent months are ROWS, not gaps', () => {
  // 2 free months up front, then paying rent.
  const invoices = computeRentInvoiceSchedule({
    leaseStart: d('2026-01-01'),
    leaseEnd: d('2026-12-31'),
    periods: [
      {
        id: 'free',
        startDate: d('2026-01-01'),
        endDate: d('2026-02-28'),
        monthlyRent: new Prisma.Decimal(0),
        isFreeRent: true,
      },
      flatPeriod('2026-03-01', '2026-12-31', 5000, 'paying'),
    ],
    through: d('2027-06-01'),
  });

  it('still emits one row per month — the payment history has no unexplained gap', () => {
    expect(invoices).toHaveLength(12);
    expect(day(invoices[0].periodMonth)).toBe('2026-01-01');
    expect(day(invoices[1].periodMonth)).toBe('2026-02-01');
  });

  it('bills the abated months at zero and flags them free', () => {
    expect(money(invoices[0].amountDue)).toBe('0.00');
    expect(money(invoices[1].amountDue)).toBe('0.00');
    expect(invoices[0].isFreeRent).toBe(true);
    expect(invoices[1].isFreeRent).toBe(true);
    expect(invoices[0].periodId).toBe('free');
  });

  it('derives status FREE for them, and DUE for the paying months', () => {
    expect(deriveInvoiceStatus(invoices[0].amountDue, 0)).toBe('FREE');
    expect(deriveInvoiceStatus(invoices[2].amountDue, 0)).toBe('DUE');
  });

  it('resumes full rent the month abatement ends', () => {
    expect(day(invoices[2].periodMonth)).toBe('2026-03-01');
    expect(money(invoices[2].amountDue)).toBe('5000.00');
    expect(invoices[2].isFreeRent).toBe(false);
    expect(invoices[2].periodId).toBe('paying');
  });
});

describe('computeRentInvoiceSchedule — escalation mid-term', () => {
  it('bills the higher rent from the escalation month onwards', () => {
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2027-12-31'),
      periods: [
        flatPeriod('2026-01-01', '2026-12-31', 1000, 'y1'),
        flatPeriod('2027-01-01', '2027-12-31', 1050, 'y2'),
      ],
      through: d('2028-06-01'),
    });

    expect(invoices).toHaveLength(24);
    expect(money(invoices[11].amountDue)).toBe('1000.00'); // Dec 2026
    expect(money(invoices[12].amountDue)).toBe('1050.00'); // Jan 2027 — escalated
    expect(invoices[11].periodId).toBe('y1');
    expect(invoices[12].periodId).toBe('y2');
    expect(invoices.slice(12).every((i) => money(i.amountDue) === '1050.00')).toBe(true);
  });

  it('agrees with the rent period engine end to end (compounding 5% a year)', () => {
    const periods = computeRentSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2028-12-31'),
      baseRent: 1000,
      escalationPct: 5,
      escalationFreq: 12,
    }).map((p, i) => ({ ...p, id: `p${i + 1}` }));

    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2028-12-31'),
      periods,
      through: d('2029-06-01'),
    });

    expect(invoices).toHaveLength(36);
    expect(money(invoices[0].amountDue)).toBe('1000.00');
    expect(money(invoices[12].amountDue)).toBe('1050.00');
    expect(money(invoices[24].amountDue)).toBe('1102.50'); // compounded, not 1100
    // Total billed == 12 x (1000 + 1050 + 1102.50)
    const total = invoices.reduce((s, i) => s.add(i.amountDue), new Prisma.Decimal(0));
    expect(money(total)).toBe('37830.00');
  });

  it('a MANUAL renegotiation supersedes the scheduled period it lands inside', () => {
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2026-12-31'),
      periods: [
        flatPeriod('2026-01-01', '2026-12-31', 1000, 'scheduled'),
        flatPeriod('2026-07-01', '2026-12-31', 1200, 'manual'),
      ],
      through: d('2027-06-01'),
    });
    expect(money(invoices[5].amountDue)).toBe('1000.00'); // June
    expect(money(invoices[6].amountDue)).toBe('1200.00'); // July — latest start wins
    expect(invoices[6].periodId).toBe('manual');
  });

  it('does not open a bogus trailing month when leaseEnd is stored exclusive-style', () => {
    // leaseEnd = the day AFTER a 12-month term. The period timeline already
    // resolved this, so the invoice horizon follows the periods, not leaseEnd.
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-01-01'),
      leaseEnd: d('2027-01-01'),
      periods: [flatPeriod('2026-01-01', '2026-12-31', 5000)],
      through: d('2027-06-01'),
    });
    expect(invoices).toHaveLength(12);
    expect(day(invoices[11].periodMonth)).toBe('2026-12-01');
  });
});

describe('computeRentInvoiceSchedule — rounding', () => {
  it('every amountDue is exactly 2dp', () => {
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-01-17'),
      leaseEnd: d('2029-08-09'),
      periods: [flatPeriod('2026-01-17', '2029-08-09', '3333.33')],
      through: d('2030-01-01'),
    });
    expect(invoices.length).toBeGreaterThan(40);
    for (const i of invoices) expect(i.amountDue.decimalPlaces()).toBeLessThanOrEqual(2);
  });

  it('applies exactly one half-up rounding to monthlyRent x billedDays / monthDays', () => {
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-01-16'),
      leaseEnd: d('2026-12-31'),
      periods: [flatPeriod('2026-01-16', '2026-12-31', '1000.01')],
      through: d('2027-01-01'),
    });
    // 1000.01 x 16 / 31 = 516.13419... -> 516.13
    expect(invoices[0].billedDays).toBe(16);
    expect(money(invoices[0].amountDue)).toBe('516.13');
  });

  it('stored billedDays / monthDays always reproduce the stored amountDue', () => {
    const invoices = computeRentInvoiceSchedule({
      leaseStart: d('2026-02-11'),
      leaseEnd: d('2027-05-20'),
      periods: [flatPeriod('2026-02-11', '2027-05-20', '4275.55')],
      through: d('2028-01-01'),
    });
    for (const i of invoices) {
      const recomputed = i.monthlyRent
        .mul(i.billedDays)
        .div(i.monthDays)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      expect(money(i.amountDue)).toBe(money(recomputed));
    }
  });
});

describe('findCoveringPeriod (pure)', () => {
  const periods = [
    flatPeriod('2026-01-01', '2026-12-31', 1000, 'a'),
    flatPeriod('2027-01-01', '2027-12-31', 1050, 'b'),
  ];

  it('picks the period in force on the day', () => {
    expect(findCoveringPeriod(periods, d('2026-12-31'))?.id).toBe('a');
    expect(findCoveringPeriod(periods, d('2027-01-01'))?.id).toBe('b');
  });

  it('returns null outside the timeline', () => {
    expect(findCoveringPeriod(periods, d('2025-12-31'))).toBeNull();
    expect(findCoveringPeriod(periods, d('2028-01-01'))).toBeNull();
  });

  it('treats a null endDate as running to the end of time', () => {
    const open = [{ ...flatPeriod('2026-01-01', '2026-12-31', 1000, 'open'), endDate: null }];
    expect(findCoveringPeriod(open, d('2099-01-01'))?.id).toBe('open');
  });
});

// ============================================================================
// Status derivation
// ============================================================================

describe('deriveInvoiceStatus', () => {
  it('walks DUE -> PARTIAL -> PAID as money arrives', () => {
    expect(deriveInvoiceStatus(5000, 0)).toBe('DUE');
    expect(deriveInvoiceStatus(5000, 2500)).toBe('PARTIAL');
    expect(deriveInvoiceStatus(5000, 5000)).toBe('PAID');
  });

  it('lands an EXACT payment on PAID, not PARTIAL', () => {
    expect(deriveInvoiceStatus('2741.94', '2741.94')).toBe('PAID');
    expect(deriveInvoiceStatus('2741.94', '2741.93')).toBe('PARTIAL');
  });

  it('treats an overpayment as PAID', () => {
    expect(deriveInvoiceStatus(5000, 5100)).toBe('PAID');
  });

  it('reports a zero-due month as FREE, never as a permanently unpaid DUE', () => {
    expect(deriveInvoiceStatus(0, 0)).toBe('FREE');
  });

  it('sums Decimals rather than concatenating them', () => {
    // A naive `a + b` on Prisma Decimals gives the string "25002500".
    const due = new Prisma.Decimal('5000.00');
    const paid = new Prisma.Decimal('2500.00').plus(new Prisma.Decimal('2500.00'));
    expect(deriveInvoiceStatus(due, paid)).toBe('PAID');
  });

  it('never returns WAIVED — that is set only by waive()', () => {
    const statuses = [
      deriveInvoiceStatus(0, 0),
      deriveInvoiceStatus(100, 0),
      deriveInvoiceStatus(100, 50),
      deriveInvoiceStatus(100, 100),
    ];
    expect(statuses).not.toContain('WAIVED');
  });
});

describe('summariseInvoices (pure)', () => {
  const rows = [
    { amountDue: '0', amountPaid: '0', status: 'FREE', dueDate: d('2026-01-01') },
    { amountDue: '5000', amountPaid: '5000', status: 'PAID', dueDate: d('2026-02-01') },
    { amountDue: '5000', amountPaid: '2000', status: 'PARTIAL', dueDate: d('2026-03-01') },
    { amountDue: '5000', amountPaid: '0', status: 'DUE', dueDate: d('2026-04-01') },
    { amountDue: '5000', amountPaid: '0', status: 'DUE', dueDate: d('2026-06-01') }, // future
    { amountDue: '5000', amountPaid: '0', status: 'WAIVED', dueDate: d('2026-05-01') },
  ];

  it('excludes waived months from billed but keeps money actually collected', () => {
    const s = summariseInvoices(rows, d('2026-05-15'));
    expect(s.billed).toBe(20000); // 0 + 5000 x 4, waived excluded
    expect(s.collected).toBe(7000);
    expect(s.outstanding).toBe(13000);
    expect(s.invoiceCount).toBe(6);
  });

  it('counts only DUE and PARTIAL rows whose due date has passed', () => {
    // FREE / PAID / WAIVED are never overdue; the 1 Jun row is not due yet.
    expect(summariseInvoices(rows, d('2026-05-15')).overdueCount).toBe(2);
  });

  it('does not treat a payment due TODAY as overdue', () => {
    expect(summariseInvoices(rows, d('2026-04-01')).overdueCount).toBe(1); // only March
  });

  it('zeroes cleanly on an empty ledger', () => {
    expect(summariseInvoices([], d('2026-05-15'))).toEqual({
      invoiceCount: 0,
      billed: 0,
      collected: 0,
      outstanding: 0,
      overdueCount: 0,
    });
  });
});

// ============================================================================
// Service — DB-touching paths, Prisma mocked in the house style
// ============================================================================

const mockPrisma: any = {
  lease: { findUnique: jest.fn(), findMany: jest.fn() },
  leaseRentPeriod: { findMany: jest.fn() },
  leaseRentInvoice: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    // Present only so the tests can assert the generator NEVER reaches for them.
    updateMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const LEASE = {
  id: 'lease-1',
  leaseStart: d('2026-01-01'),
  leaseEnd: d('2026-12-31'),
  monthlyRent: new Prisma.Decimal(5000),
  rentDueDay: null,
  status: 'ACTIVE',
  deletedAt: null,
};

const PERIODS = [
  {
    id: 'p1',
    leaseId: 'lease-1',
    sequence: 1,
    startDate: d('2026-01-01'),
    endDate: d('2026-12-31'),
    monthlyRent: new Prisma.Decimal(5000),
    isFreeRent: false,
  },
];

/** Persisted invoice row, as Prisma would hand it back. */
const invoiceRow = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  leaseId: 'lease-1',
  periodId: 'p1',
  periodMonth: d('2026-03-01'),
  dueDate: d('2026-03-01'),
  amountDue: new Prisma.Decimal('5000.00'),
  amountPaid: new Prisma.Decimal('0'),
  isProrated: false,
  billedDays: 31,
  monthDays: 31,
  paidAt: null,
  status: 'DUE',
  method: null,
  reference: null,
  notes: null,
  recordedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function makeService() {
  return new LeaseRentInvoiceService(mockPrisma as any);
}

describe('LeaseRentInvoiceService.generateForLease', () => {
  let service: LeaseRentInvoiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lease.findUnique.mockResolvedValue(LEASE);
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue(PERIODS);
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([]);
    mockPrisma.leaseRentInvoice.createMany.mockResolvedValue({ count: 12 });
  });

  it('writes one row per month, append-only, with skipDuplicates', async () => {
    await service.generateForLease('lease-1', { through: d('2027-01-15') });

    expect(mockPrisma.leaseRentInvoice.createMany).toHaveBeenCalledTimes(1);
    const { data, skipDuplicates } = mockPrisma.leaseRentInvoice.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data).toHaveLength(12);
    expect(data.map((r: any) => day(r.periodMonth))[0]).toBe('2026-01-01');
    expect(data.every((r: any) => r.leaseId === 'lease-1')).toBe(true);
    expect(data.every((r: any) => r.periodId === 'p1')).toBe(true);
  });

  it('creates every row at amountPaid 0 with a DERIVED status — callers never set it', async () => {
    await service.generateForLease('lease-1', { through: d('2027-01-15') });
    const { data } = mockPrisma.leaseRentInvoice.createMany.mock.calls[0][0];
    expect(data.every((r: any) => new Prisma.Decimal(r.amountPaid).isZero())).toBe(true);
    expect(data.every((r: any) => r.status === 'DUE')).toBe(true);
  });

  it('marks free months FREE at creation', async () => {
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([
      { ...PERIODS[0], id: 'free', endDate: d('2026-02-28'), monthlyRent: new Prisma.Decimal(0), isFreeRent: true },
      { ...PERIODS[0], id: 'p2', startDate: d('2026-03-01') },
    ]);

    await service.generateForLease('lease-1', { through: d('2027-01-15') });

    const { data } = mockPrisma.leaseRentInvoice.createMany.mock.calls[0][0];
    expect(data.slice(0, 2).map((r: any) => r.status)).toEqual(['FREE', 'FREE']);
    expect(data.slice(0, 2).every((r: any) => new Prisma.Decimal(r.amountDue).isZero())).toBe(true);
    expect(data[2].status).toBe('DUE');
  });

  it('defaults the horizon to today', async () => {
    jest.useFakeTimers().setSystemTime(d('2026-04-20'));
    await service.generateForLease('lease-1');
    const { data } = mockPrisma.leaseRentInvoice.createMany.mock.calls[0][0];
    expect(data).toHaveLength(4); // Jan..Apr
    jest.useRealTimers();
  });

  it('falls back to lease.monthlyRent for a legacy lease with no rent periods', async () => {
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue([]);

    await service.generateForLease('lease-1', { through: d('2027-01-15') });

    const { data } = mockPrisma.leaseRentInvoice.createMany.mock.calls[0][0];
    expect(data).toHaveLength(12);
    expect(new Prisma.Decimal(data[0].amountDue).toFixed(2)).toBe('5000.00');
    expect(data[0].periodId).toBeNull();
  });

  it('rejects a lease that does not exist or was soft-deleted', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue(null);
    await expect(service.generateForLease('nope')).rejects.toThrow(NotFoundException);

    mockPrisma.lease.findUnique.mockResolvedValue({ ...LEASE, deletedAt: new Date() });
    await expect(service.generateForLease('lease-1')).rejects.toThrow('Lease not found');
    expect(mockPrisma.leaseRentInvoice.createMany).not.toHaveBeenCalled();
  });
});

describe('LeaseRentInvoiceService.generateForLease — idempotency', () => {
  let service: LeaseRentInvoiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lease.findUnique.mockResolvedValue(LEASE);
    mockPrisma.leaseRentPeriod.findMany.mockResolvedValue(PERIODS);
    mockPrisma.leaseRentInvoice.createMany.mockResolvedValue({ count: 0 });
  });

  it('NEVER overwrites an invoice that already has a payment recorded against it', async () => {
    // March was already collected in full by a human.
    const paidMarch = invoiceRow({
      amountPaid: new Prisma.Decimal('5000.00'),
      status: 'PAID',
      paidAt: d('2026-03-03'),
      reference: 'WIRE-8891',
    });
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([paidMarch]);

    const after: any[] = (await service.generateForLease('lease-1', {
      through: d('2027-01-15'),
    })) as any;

    // The only write is an append that the unique constraint filters.
    expect(mockPrisma.leaseRentInvoice.createMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.leaseRentInvoice.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    // Nothing that could clobber a recorded payment is ever issued.
    expect(mockPrisma.leaseRentInvoice.update).not.toHaveBeenCalled();
    expect(mockPrisma.leaseRentInvoice.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.leaseRentInvoice.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.leaseRentInvoice.delete).not.toHaveBeenCalled();
    expect(mockPrisma.leaseRentInvoice.deleteMany).not.toHaveBeenCalled();
    // The recorded payment survives untouched.
    expect(after[0].status).toBe('PAID');
    expect(money(after[0].amountPaid)).toBe('5000.00');
    expect(after[0].reference).toBe('WIRE-8891');
  });

  it('produces a byte-identical payload on a re-run, so the DB can drop it wholesale', async () => {
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([]);

    await service.generateForLease('lease-1', { through: d('2027-01-15') });
    const first = mockPrisma.leaseRentInvoice.createMany.mock.calls[0][0].data;

    await service.generateForLease('lease-1', { through: d('2027-01-15') });
    const second = mockPrisma.leaseRentInvoice.createMany.mock.calls[1][0].data;

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // periodMonth is the natural key — it must be a stable UTC midnight every time.
    expect(first.every((r: any) => r.periodMonth.toISOString().endsWith('T00:00:00.000Z'))).toBe(
      true,
    );
  });
});

describe('LeaseRentInvoiceService.generateDueThrough (cron)', () => {
  let service: LeaseRentInvoiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.leaseRentInvoice.createMany.mockResolvedValue({ count: 3 });
  });

  it('walks every ACTIVE, non-deleted lease and appends the missing months', async () => {
    mockPrisma.lease.findMany.mockResolvedValue([
      { ...LEASE, rentPeriods: PERIODS },
      { ...LEASE, id: 'lease-2', rentPeriods: PERIODS },
    ]);

    const result = await service.generateDueThrough(d('2026-03-10'));

    expect(mockPrisma.lease.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, status: 'ACTIVE', NOT: { unit: { status: 'SOLD' } } },
      }),
    );
    expect(result.leasesProcessed).toBe(2);
    expect(result.invoicesCreated).toBe(6);
    expect(result.leaseIds).toEqual(['lease-1', 'lease-2']);
    // Bills through the month CONTAINING asOf: Jan, Feb, Mar.
    expect(mockPrisma.leaseRentInvoice.createMany.mock.calls[0][0].data).toHaveLength(3);
  });

  it('excludes leases on a SOLD unit from billing', async () => {
    mockPrisma.lease.findMany.mockResolvedValue([]);

    await service.generateDueThrough(d('2026-03-10'));

    // Selling a unit does not end its lease, and the lease stays ACTIVE. Without this
    // filter the cron kept minting invoices for units Prime no longer owns — six real
    // leases had accumulated 99 invoices, one billing out to 2032.
    const where = mockPrisma.lease.findMany.mock.calls[0][0].where;
    expect(where.NOT).toEqual({ unit: { status: 'SOLD' } });
  });

  it('reports zero without writing when every lease is already up to date', async () => {
    mockPrisma.leaseRentInvoice.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.lease.findMany.mockResolvedValue([{ ...LEASE, rentPeriods: PERIODS }]);

    const result = await service.generateDueThrough(d('2026-03-10'));

    expect(result.invoicesCreated).toBe(0);
    expect(result.leaseIds).toEqual([]);
  });

  it('skips a lease whose term has not started yet without touching the DB', async () => {
    mockPrisma.lease.findMany.mockResolvedValue([
      { ...LEASE, leaseStart: d('2030-01-01'), leaseEnd: d('2030-12-31'), rentPeriods: [] },
    ]);

    const result = await service.generateDueThrough(d('2026-03-10'));

    expect(mockPrisma.leaseRentInvoice.createMany).not.toHaveBeenCalled();
    expect(result.invoicesCreated).toBe(0);
  });
});

describe('LeaseRentInvoiceService.recordPayment — the mirror', () => {
  let service: LeaseRentInvoiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.leaseRentInvoice.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, ...args.data }),
    );
  });

  it('DUE -> PARTIAL on a part payment', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(invoiceRow());
    const updated: any = await service.recordPayment('inv-1', { amountPaid: 2000 });
    expect(updated.status).toBe('PARTIAL');
    expect(money(updated.amountPaid)).toBe('2000.00');
  });

  it('PARTIAL -> PAID when the balance arrives — and SETS the total, never adds to it', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(
      invoiceRow({ amountPaid: new Prisma.Decimal('2000.00'), status: 'PARTIAL' }),
    );
    const updated: any = await service.recordPayment('inv-1', { amountPaid: 5000 });
    // 5000, not 2000 + 5000. A re-submitted form cannot inflate collections.
    expect(money(updated.amountPaid)).toBe('5000.00');
    expect(updated.status).toBe('PAID');
  });

  it('an EXACT payment lands on PAID, not PARTIAL — including on a prorated month', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(
      invoiceRow({ amountDue: new Prisma.Decimal('2741.94'), isProrated: true, billedDays: 17 }),
    );
    const updated: any = await service.recordPayment('inv-1', { amountPaid: '2741.94' });
    expect(updated.status).toBe('PAID');
  });

  it('is idempotent — recording the same total twice leaves the same mirror', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(invoiceRow());
    const a: any = await service.recordPayment('inv-1', { amountPaid: 5000 });
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(
      invoiceRow({ amountPaid: new Prisma.Decimal('5000.00'), status: 'PAID' }),
    );
    const b: any = await service.recordPayment('inv-1', { amountPaid: 5000 });
    expect(money(b.amountPaid)).toBe(money(a.amountPaid));
    expect(b.status).toBe('PAID');
  });

  it('allows an overpayment and reports PAID', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(invoiceRow());
    const updated: any = await service.recordPayment('inv-1', { amountPaid: 5100 });
    expect(updated.status).toBe('PAID');
    expect(money(updated.amountPaid)).toBe('5100.00');
  });

  it('stamps paidAt, method, reference and the recorder', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(invoiceRow());
    const updated: any = await service.recordPayment('inv-1', {
      amountPaid: 5000,
      paidAt: '2026-03-05',
      method: 'ACH',
      reference: 'WIRE-1',
      recordedById: 'u1',
    });
    expect(day(updated.paidAt)).toBe('2026-03-05');
    expect(updated.method).toBe('ACH');
    expect(updated.reference).toBe('WIRE-1');
    expect(updated.recordedById).toBe('u1');
  });

  it('rounds the recorded amount to 2dp', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(invoiceRow());
    const updated: any = await service.recordPayment('inv-1', { amountPaid: '1234.567' });
    expect(money(updated.amountPaid)).toBe('1234.57');
  });

  it('rejects zero, negative and non-numeric amounts', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(invoiceRow());
    await expect(service.recordPayment('inv-1', { amountPaid: 0 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.recordPayment('inv-1', { amountPaid: -5 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.recordPayment('inv-1', { amountPaid: 'abc' })).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPrisma.leaseRentInvoice.update).not.toHaveBeenCalled();
  });

  it('refuses to collect against a free-rent month', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(
      invoiceRow({ amountDue: new Prisma.Decimal(0), status: 'FREE' }),
    );
    await expect(service.recordPayment('inv-1', { amountPaid: 100 })).rejects.toThrow(
      'free-rent month',
    );
  });

  it('refuses to collect against a waived month', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(invoiceRow({ status: 'WAIVED' }));
    await expect(service.recordPayment('inv-1', { amountPaid: 100 })).rejects.toThrow('waived');
  });

  it('404s on an unknown invoice', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(null);
    await expect(service.recordPayment('nope', { amountPaid: 100 })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('LeaseRentInvoiceService.clearPayment', () => {
  let service: LeaseRentInvoiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.leaseRentInvoice.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, ...args.data }),
    );
  });

  it('recomputes the mirror to zero rather than decrementing it — a mis-keyed 50000 fully reverses', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(
      invoiceRow({ amountPaid: new Prisma.Decimal('50000.00'), status: 'PAID', paidAt: d('2026-03-05') }),
    );

    const cleared: any = await service.clearPayment('inv-1');

    expect(money(cleared.amountPaid)).toBe('0.00');
    expect(cleared.status).toBe('DUE');
    expect(cleared.paidAt).toBeNull();
    expect(cleared.method).toBeNull();
    expect(cleared.reference).toBeNull();
  });

  it('sends a free month back to FREE, not to DUE', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(
      invoiceRow({ amountDue: new Prisma.Decimal(0), amountPaid: new Prisma.Decimal('100'), status: 'FREE' }),
    );
    const cleared: any = await service.clearPayment('inv-1');
    expect(cleared.status).toBe('FREE');
  });

  it('lifts a waiver — it is the only un-waive path', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(
      invoiceRow({ status: 'WAIVED', notes: 'Waived: goodwill' }),
    );
    const cleared: any = await service.clearPayment('inv-1');
    expect(cleared.status).toBe('DUE');
    // Notes survive: they are the audit trail of what happened.
    expect(cleared.notes).toBeUndefined();
  });
});

describe('LeaseRentInvoiceService.waive', () => {
  let service: LeaseRentInvoiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.leaseRentInvoice.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, ...args.data }),
    );
  });

  it('requires a reason', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(invoiceRow());
    await expect(service.waive('inv-1', '')).rejects.toThrow(BadRequestException);
    await expect(service.waive('inv-1', '   ')).rejects.toThrow(BadRequestException);
    expect(mockPrisma.leaseRentInvoice.update).not.toHaveBeenCalled();
  });

  it('sets WAIVED and stamps the reason into notes', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(invoiceRow({ notes: 'Chased twice' }));
    const waived: any = await service.waive('inv-1', '  COVID goodwill  ');
    expect(waived.status).toBe('WAIVED');
    expect(waived.notes).toBe('Chased twice\nWaived: COVID goodwill');
  });

  it('keeps any money already collected on the row', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(
      invoiceRow({ amountPaid: new Prisma.Decimal('1000'), status: 'PARTIAL' }),
    );
    const waived: any = await service.waive('inv-1', 'settled at 1000');
    expect(waived.amountPaid).toBeUndefined(); // untouched by the update payload
    expect(waived.status).toBe('WAIVED');
  });

  it('refuses to double-waive', async () => {
    mockPrisma.leaseRentInvoice.findUnique.mockResolvedValue(invoiceRow({ status: 'WAIVED' }));
    await expect(service.waive('inv-1', 'again')).rejects.toThrow('already waived');
  });
});

describe('LeaseRentInvoiceService — reads and rollups', () => {
  let service: LeaseRentInvoiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('findByLease returns the months in order', async () => {
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([invoiceRow()]);
    await service.findByLease('lease-1');
    expect(mockPrisma.leaseRentInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leaseId: 'lease-1' },
        orderBy: { periodMonth: 'asc' },
      }),
    );
  });

  it('findByUnit spans ALL leases on the unit so a re-let reads as one timeline', async () => {
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([
      invoiceRow({ id: 'a', leaseId: 'old-lease' }),
      invoiceRow({ id: 'b', leaseId: 'new-lease' }),
    ]);

    const rows: any = await service.findByUnit('unit-9');

    const args = mockPrisma.leaseRentInvoice.findMany.mock.calls[0][0];
    // Not scoped to a single lease — the whole unit's history.
    expect(args.where).toEqual({ lease: { unitId: 'unit-9', deletedAt: null } });
    expect(args.orderBy).toEqual([{ periodMonth: 'asc' }, { leaseId: 'asc' }]);
    expect(rows.map((r: any) => r.leaseId)).toEqual(['old-lease', 'new-lease']);
  });

  it('summaryForLease reports billed / collected / outstanding / overdueCount', async () => {
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([
      { amountDue: new Prisma.Decimal(0), amountPaid: new Prisma.Decimal(0), status: 'FREE', dueDate: d('2026-01-01') },
      { amountDue: new Prisma.Decimal(5000), amountPaid: new Prisma.Decimal(5000), status: 'PAID', dueDate: d('2026-02-01') },
      { amountDue: new Prisma.Decimal(5000), amountPaid: new Prisma.Decimal(1500), status: 'PARTIAL', dueDate: d('2026-03-01') },
      { amountDue: new Prisma.Decimal(5000), amountPaid: new Prisma.Decimal(0), status: 'DUE', dueDate: d('2026-04-01') },
    ]);

    const summary = await service.summaryForLease('lease-1', d('2026-04-20'));

    expect(summary).toEqual({
      leaseId: 'lease-1',
      invoiceCount: 4,
      billed: 15000,
      collected: 6500,
      outstanding: 8500,
      overdueCount: 2,
    });
  });
});

describe('LeaseRentInvoiceService.findOverdue', () => {
  let service: LeaseRentInvoiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([]);
  });

  it('excludes FREE, PAID and WAIVED rows at the query level', async () => {
    await service.findOverdue(d('2026-04-20'));
    const args = mockPrisma.leaseRentInvoice.findMany.mock.calls[0][0];

    expect(args.where.status).toEqual({ in: ['DUE', 'PARTIAL'] });
    expect(args.where.status.in).not.toContain('FREE');
    expect(args.where.status.in).not.toContain('PAID');
    expect(args.where.status.in).not.toContain('WAIVED');
  });

  it('does not chase a payment due TODAY — strictly past-due only', async () => {
    await service.findOverdue(new Date('2026-04-20T18:30:00.000Z'));
    const args = mockPrisma.leaseRentInvoice.findMany.mock.calls[0][0];
    expect(args.where.dueDate).toEqual({ lt: d('2026-04-20') });
  });

  it('ignores soft-deleted leases', async () => {
    await service.findOverdue(d('2026-04-20'));
    const args = mockPrisma.leaseRentInvoice.findMany.mock.calls[0][0];
    expect(args.where.lease).toEqual({ deletedAt: null });
  });

  it('annotates each row with what is still owed and how late it is', async () => {
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([
      invoiceRow({ dueDate: d('2026-03-01'), amountPaid: new Prisma.Decimal('1500'), status: 'PARTIAL' }),
      invoiceRow({ id: 'inv-2', dueDate: d('2026-04-01'), status: 'DUE' }),
    ]);

    const rows: any = await service.findOverdue(d('2026-04-20'));

    expect(rows[0].outstanding).toBe(3500);
    expect(rows[0].daysOverdue).toBe(50); // 31 Mar days + 19 Apr days
    expect(rows[1].outstanding).toBe(5000);
    expect(rows[1].daysOverdue).toBe(19);
  });
});
