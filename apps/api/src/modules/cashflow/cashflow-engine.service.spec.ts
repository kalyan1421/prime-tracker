import { CashflowEngineService } from './cashflow-engine.service';

// All source queries return [] unless a test overrides them.
function emptyPrisma() {
  const empty = { findMany: jest.fn().mockResolvedValue([]) };
  return {
    salePayment: { findMany: jest.fn().mockResolvedValue([]) },
    lease: { findMany: jest.fn().mockResolvedValue([]) },
    drawSchedule: { findMany: jest.fn().mockResolvedValue([]) },
    cashFlowEntry: { findMany: jest.fn().mockResolvedValue([]) },
    loan: { findMany: jest.fn().mockResolvedValue([]) },
    commitment: { findMany: jest.fn().mockResolvedValue([]) },
    interiorInvoice: { findMany: jest.fn().mockResolvedValue([]) },
    sale: { findMany: jest.fn().mockResolvedValue([]) },
    _empty: empty,
  } as any;
}

const NOW = new Date('2026-06-15T00:00:00Z'); // start month = 2026-06
const d = (s: string) => new Date(s + 'T00:00:00Z');

describe('CashflowEngineService.buildTimeline', () => {
  let prisma: any;
  let engine: CashflowEngineService;

  beforeEach(() => {
    prisma = emptyPrisma();
    engine = new CashflowEngineService(prisma);
  });

  const build = (months = 12) => engine.buildTimeline({ projectId: 'p1', months, now: NOW });
  const monthOf = (t: any, key: string) => t.monthly.find((m: any) => m.month === key);

  it('produces a continuous month range from the current month', async () => {
    const t = await build(12);
    expect(t.monthly).toHaveLength(12);
    expect(t.startMonth).toBe('2026-06');
    expect(t.monthly[0].month).toBe('2026-06');
    expect(t.monthly[11].month).toBe('2027-05');
  });

  it('buckets outstanding sale installments as inflow by effective due month', async () => {
    prisma.salePayment.findMany.mockResolvedValue([
      { amount: 1000, paidAmount: 200, dueDate: d('2026-07-15'), effectiveDueDate: null },
      { amount: 500, paidAmount: 0, dueDate: null, effectiveDueDate: d('2026-08-01') },
      { amount: 999, paidAmount: 0, dueDate: null, effectiveDueDate: null }, // undated → skipped
    ]);
    const t = await build();
    expect(monthOf(t, '2026-07').inflowsBySource.salePayments).toBe(800);
    expect(monthOf(t, '2026-08').inflowsBySource.salePayments).toBe(500);
    expect(t.summary.totalInflows).toBe(1300);
  });

  it('excludes lease income from units that have been sold', async () => {
    prisma.lease.findMany.mockResolvedValue([]);

    await build();

    // One of these leases ran to 2032 — the forecast was projecting rent years out on
    // units Prime had already sold.
    const where = prisma.lease.findMany.mock.calls[0][0].where;
    expect(where.NOT).toEqual({ unit: { status: 'SOLD' } });
  });

  it('spreads ACTIVE lease rent across each in-range month, applying escalation', async () => {
    prisma.lease.findMany.mockResolvedValue([
      { monthlyRent: 1000, leaseStart: d('2026-01-01'), leaseEnd: d('2027-12-31'), escalationPct: 10, escalationFreq: 6 },
    ]);
    const t = await build(12);
    // Lease started Jan; by Jun (month 5) no escalation step yet (floor(5/6)=0) → 1000
    expect(monthOf(t, '2026-06').inflowsBySource.leaseIncome).toBe(1000);
    // Jul = month 6 since start → floor(6/6)=1 escalation → 1100
    expect(monthOf(t, '2026-07').inflowsBySource.leaseIncome).toBe(1100);
  });

  it('places planned draws as inflow in their scheduled month', async () => {
    prisma.drawSchedule.findMany.mockResolvedValue([
      { plannedAmount: 50000, plannedDate: d('2026-09-10') },
    ]);
    const t = await build();
    expect(monthOf(t, '2026-09').inflowsBySource.drawSchedule).toBe(50000);
  });

  it('recurs loan payments monthly as outflow, stopping after maturity', async () => {
    prisma.loan.findMany.mockResolvedValue([
      { monthlyPayment: 2000, maturityDate: d('2026-08-31') },
    ]);
    const t = await build();
    expect(monthOf(t, '2026-06').outflowsByCategory.loanPayments).toBe(2000);
    expect(monthOf(t, '2026-08').outflowsByCategory.loanPayments).toBe(2000);
    expect(monthOf(t, '2026-09').outflowsByCategory.loanPayments).toBe(0); // past maturity
  });

  it('puts outstanding commitments, interior TI and commissions in the first (near-term) month', async () => {
    prisma.commitment.findMany.mockResolvedValue([{ contractAmt: 100000, paidToDate: 30000, retainage: 5000 }]);
    prisma.interiorInvoice.findMany.mockResolvedValue([{ amount: 12000 }]);
    prisma.sale.findMany.mockResolvedValue([{ brokerCommissionAmt: 8000 }]);
    const t = await build();
    const first = monthOf(t, '2026-06');
    expect(first.outflowsByCategory.subcontractorAP).toBe(65000); // 100k - 30k - 5k
    expect(first.outflowsByCategory.interiorTI).toBe(12000);
    expect(first.outflowsByCategory.commissions).toBe(8000);
  });

  it('splits manual entries into manual inflow vs misc outflow', async () => {
    prisma.cashFlowEntry.findMany.mockResolvedValue([
      { month: d('2026-06-01'), entryType: 'INFLOW', amount: 5000 },
      { month: d('2026-06-01'), entryType: 'OUTFLOW', amount: 3000 },
    ]);
    const t = await build();
    const first = monthOf(t, '2026-06');
    expect(first.inflowsBySource.manual).toBe(5000);
    expect(first.outflowsByCategory.misc).toBe(3000);
    expect(first.net).toBe(2000);
  });

  it('computes a running cumulative across months', async () => {
    prisma.cashFlowEntry.findMany.mockResolvedValue([
      { month: d('2026-06-01'), entryType: 'INFLOW', amount: 100 },
      { month: d('2026-07-01'), entryType: 'OUTFLOW', amount: 40 },
    ]);
    const t = await build();
    expect(monthOf(t, '2026-06').cumulative).toBe(100);
    expect(monthOf(t, '2026-07').cumulative).toBe(60);
    expect(t.summary.endingCumulative).toBe(60);
  });
});
