import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SaleUnitTransferService } from './sale-unit-transfer.service';

const D = (n: number) => new Prisma.Decimal(n);

const mockPrisma: any = {
  sale: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  unit: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
  lease: { findFirst: jest.fn() },
  salePayment: { count: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  saleUnitTransfer: { create: jest.fn(), findMany: jest.fn() },
  // Interactive form only — the whole swap is one callback transaction.
  $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma))),
};

// The occupancy log. A spy rather than a no-op: several cases below assert that a unit
// flip and its event stay in lockstep, and that both carry the transfer date.
const mockStatusEvents = { record: jest.fn(), recordIfChanged: jest.fn() };

// Only resolveDiscountThreshold is reached from here — the re-gate reads the same org
// threshold SalesService's own gate does, rather than a second copy of the number.
const mockSales = { resolveDiscountThreshold: jest.fn().mockResolvedValue(5) };

function makeService() {
  return new SaleUnitTransferService(
    mockPrisma as any,
    mockStatusEvents as any,
    mockSales as any,
  );
}

/** The sale being moved: unit 101, $800k, asking $800k (no discount), UNDER_CONTRACT. */
function armSale(overrides: Record<string, any> = {}) {
  mockPrisma.sale.findUnique.mockResolvedValue({
    id: 's1',
    projectId: 'pr1',
    status: 'UNDER_CONTRACT',
    buyer: 'Acme LLC',
    unitId: 'u1',
    salePrice: D(800_000),
    discountApprovedAt: null,
    discountApprovedById: null,
    deletedAt: null,
    unit: { id: 'u1', unitNumber: '101', askingPrice: D(800_000), status: 'UNDER_CONTRACT' },
    ...overrides,
  });
}

/** The unit being moved TO: 205, free, asking $1.1M. */
function armTarget(overrides: Record<string, any> = {}) {
  mockPrisma.unit.findUnique.mockResolvedValue({
    id: 'u2',
    unitNumber: '205',
    status: 'AVAILABLE',
    deletedAt: null,
    askingPrice: D(1_100_000),
    building: { projectId: 'pr1', name: 'Building 1' },
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSales.resolveDiscountThreshold.mockResolvedValue(5);
  mockPrisma.lease.findFirst.mockResolvedValue(null);
  mockPrisma.sale.findFirst.mockResolvedValue(null);
  mockPrisma.salePayment.count.mockResolvedValue(0);
  mockPrisma.salePayment.findMany.mockResolvedValue([]);
  mockPrisma.salePayment.update.mockImplementation((args: any) => Promise.resolve(args));
  mockPrisma.sale.update.mockImplementation((args: any) =>
    Promise.resolve({ id: args.where.id, ...args.data }),
  );
  mockPrisma.unit.update.mockResolvedValue({});
  // Inside the transaction each unit's prior status is re-read to stamp the event's
  // fromStatus. u1 is the reserved unit being released; u2 the free one being taken.
  mockPrisma.unit.findUniqueOrThrow.mockImplementation((args: any) =>
    Promise.resolve({ status: args.where.id === 'u1' ? 'UNDER_CONTRACT' : 'AVAILABLE' }),
  );
  mockPrisma.saleUnitTransfer.create.mockImplementation((args: any) =>
    Promise.resolve({ id: 'tr1', ...args.data }),
  );
  armSale();
  armTarget();
});

describe('SaleUnitTransferService — the transfer row', () => {
  it('records both units, both prices and the effective date', async () => {
    const res = await makeService().transferUnit(
      's1',
      { toUnitId: 'u2', newSalePrice: 1_000_000, effectiveDate: '2026-09-01', reason: 'Buyer wanted a corner unit' },
      'user-1',
    );

    expect(mockPrisma.saleUnitTransfer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          saleId: 's1',
          fromUnitId: 'u1',
          toUnitId: 'u2',
          effectiveDate: new Date('2026-09-01T00:00:00.000Z'),
          reason: 'Buyer wanted a corner unit',
          recordedById: 'user-1',
        }),
      }),
    );
    const data = mockPrisma.saleUnitTransfer.create.mock.calls[0][0].data;
    expect(Number(data.priceBefore)).toBe(800_000);
    expect(Number(data.priceAfter)).toBe(1_000_000);
    expect(res.transfer.id).toBe('tr1');
  });

  it('moves the sale onto the new unit and the new price', async () => {
    await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 1_000_000 });

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    expect(data.unitId).toBe('u2');
    expect(Number(data.salePrice)).toBe(1_000_000);
    expect(data.lastActivityAt).toBeInstanceOf(Date);
  });

  it('carries the existing price when no new price is given', async () => {
    await makeService().transferUnit('s1', { toUnitId: 'u2' });

    const data = mockPrisma.saleUnitTransfer.create.mock.calls[0][0].data;
    expect(Number(data.priceBefore)).toBe(800_000);
    expect(Number(data.priceAfter)).toBe(800_000);
  });
});

describe('SaleUnitTransferService — payment rebase', () => {
  const schedule = [
    { id: 'p1', label: 'Deposit', sequence: 0, percentOfPrice: D(10), amount: D(80_000), paidAmount: D(0), status: 'SCHEDULED' },
    { id: 'p2', label: 'Handover', sequence: 1, percentOfPrice: D(50), amount: D(400_000), paidAmount: D(0), status: 'DUE' },
    { id: 'p3', label: 'Legal fee', sequence: 2, percentOfPrice: null, amount: D(5_000), paidAmount: D(0), status: 'SCHEDULED' },
  ];

  it('recomputes percentOfPrice installments against the new price, keeping the rows', async () => {
    mockPrisma.salePayment.count.mockResolvedValue(2);
    mockPrisma.salePayment.findMany.mockResolvedValue(schedule);

    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 1_000_000 });

    expect(mockPrisma.salePayment.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { amount: expect.any(Prisma.Decimal) },
    });
    const p1 = mockPrisma.salePayment.update.mock.calls.find((c: any) => c[0].where.id === 'p1');
    const p2 = mockPrisma.salePayment.update.mock.calls.find((c: any) => c[0].where.id === 'p2');
    expect(Number(p1[0].data.amount)).toBe(100_000);
    expect(Number(p2[0].data.amount)).toBe(500_000);
    expect(res.payments.rebased.map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('leaves flat (non-percentage) installments alone — a figure agreed in dollars is not derived', async () => {
    mockPrisma.salePayment.count.mockResolvedValue(2);
    mockPrisma.salePayment.findMany.mockResolvedValue(schedule);

    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 1_000_000 });

    const touchedIds = mockPrisma.salePayment.update.mock.calls.map((c: any) => c[0].where.id);
    expect(touchedIds).not.toContain('p3');
    expect(res.payments.unchanged).toBe(1);
  });

  it('FLAGS a paid installment whose amount would move — never restates it (R22)', async () => {
    mockPrisma.salePayment.count.mockResolvedValue(1);
    mockPrisma.salePayment.findMany.mockResolvedValue([
      { id: 'p1', label: 'Deposit', sequence: 0, percentOfPrice: D(10), amount: D(80_000), paidAmount: D(80_000), status: 'PAID' },
    ]);

    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 1_000_000 });

    const call = mockPrisma.salePayment.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'p1' });
    // The flag and the reason, and NOTHING else — the billed amount is untouched.
    expect(Object.keys(call.data).sort()).toEqual(['needsReview', 'reviewReason']);
    expect(call.data.needsReview).toBe(true);
    expect(call.data.reviewReason).toContain('under-collected by 20000.00');
    expect(res.payments.flagged).toEqual([
      expect.objectContaining({ id: 'p1', amount: 80_000, paidAmount: 80_000, wouldHaveBeen: 100_000 }),
    ]);
    expect(res.payments.rebased).toEqual([]);
  });

  it('flags a PARTIALLY_PAID installment too — money has moved against that figure', async () => {
    mockPrisma.salePayment.count.mockResolvedValue(1);
    mockPrisma.salePayment.findMany.mockResolvedValue([
      { id: 'p1', label: 'Deposit', sequence: 0, percentOfPrice: D(10), amount: D(80_000), paidAmount: D(30_000), status: 'PARTIALLY_PAID' },
    ]);

    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 1_000_000 });

    expect(res.payments.flagged).toHaveLength(1);
    expect(mockPrisma.salePayment.update.mock.calls[0][0].data.needsReview).toBe(true);
  });

  it('leaves a WAIVED installment alone — a concession already granted is not restated', async () => {
    mockPrisma.salePayment.count.mockResolvedValue(1);
    mockPrisma.salePayment.findMany.mockResolvedValue([
      { id: 'p1', label: 'Deposit', sequence: 0, percentOfPrice: D(10), amount: D(80_000), paidAmount: D(0), status: 'WAIVED' },
    ]);

    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 1_000_000 });

    expect(mockPrisma.salePayment.update).not.toHaveBeenCalled();
    expect(res.payments.unchanged).toBe(1);
  });

  it('refuses when percentage installments exist and the transfer leaves no price to derive from', async () => {
    mockPrisma.salePayment.count.mockResolvedValue(2);
    armSale({ salePrice: null, unit: { id: 'u1', unitNumber: '101', askingPrice: null, status: 'UNDER_CONTRACT' } });

    await expect(
      makeService().transferUnit('s1', { toUnitId: 'u2' }),
    ).rejects.toThrow(/percentage of the sale price/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('SaleUnitTransferService — discount approval', () => {
  /** Approved 12% off unit 101 ($800k asking, sold at $704k). */
  function armApprovedSale() {
    armSale({
      salePrice: D(704_000),
      discountApprovedAt: new Date('2026-08-01'),
      discountApprovedById: 'founder-1',
      unit: { id: 'u1', unitNumber: '101', askingPrice: D(800_000), status: 'UNDER_CONTRACT' },
    });
  }

  it('CARRIES the approval when the new discount % is lower', async () => {
    armApprovedSale();
    // $1.1M asking, sold at $1.045M = 5% off — less than the approved 12%.
    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 1_045_000 });

    expect(mockPrisma.sale.update.mock.calls[0][0].data).not.toHaveProperty('discountApprovedAt');
    expect(res.approvalCarried).toBe(true);
    expect(mockPrisma.saleUnitTransfer.create.mock.calls[0][0].data.approvalReRequired).toBe(false);
  });

  it('CARRIES the approval when the new discount % is exactly the same', async () => {
    armApprovedSale();
    // 12% off $1.1M = $968,000 — same concession in %, larger in dollars, still carried.
    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 968_000 });

    expect(mockPrisma.sale.update.mock.calls[0][0].data).not.toHaveProperty('discountApprovedAt');
    expect(res.approvalCarried).toBe(true);
  });

  it('CLEARS the approval and re-gates when the new discount % increases', async () => {
    armApprovedSale();
    // 15% off $1.1M = $935,000 — a bigger concession than the Founder signed off.
    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 935_000 });

    expect(mockPrisma.sale.update.mock.calls[0][0].data).toMatchObject({
      discountApprovedAt: null,
      discountApprovedById: null,
    });
    expect(res.approvalCarried).toBe(false);
    expect(mockPrisma.saleUnitTransfer.create.mock.calls[0][0].data.approvalReRequired).toBe(true);
  });

  it('records the discount on both sides so the carry-or-clear decision is auditable', async () => {
    armApprovedSale();
    await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 935_000 });

    const data = mockPrisma.saleUnitTransfer.create.mock.calls[0][0].data;
    expect(Number(data.discountPctBefore)).toBe(12);
    expect(Number(data.discountPctAfter)).toBe(15);
  });

  it('clears an approval on an increase, but does not claim re-approval is required below the threshold', async () => {
    // Approved 1% off. New discount 4% — an increase, so the approval is cleared, but 4%
    // is under the 5% threshold and nothing is actually blocked.
    armSale({
      salePrice: D(792_000),
      discountApprovedAt: new Date('2026-08-01'),
      discountApprovedById: 'founder-1',
      unit: { id: 'u1', unitNumber: '101', askingPrice: D(800_000), status: 'UNDER_CONTRACT' },
    });

    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 1_056_000 });

    expect(res.approvalCarried).toBe(false);
    expect(mockPrisma.saleUnitTransfer.create.mock.calls[0][0].data.approvalReRequired).toBe(false);
  });

  it('flags re-approval on an UNAPPROVED sale that lands over the threshold', async () => {
    armSale(); // no approval on the sale at all
    // 10% off $1.1M = $990,000, over the 5% threshold, with nothing signed off.
    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 990_000 });

    expect(res.approvalCarried).toBe(false);
    expect(mockPrisma.saleUnitTransfer.create.mock.calls[0][0].data.approvalReRequired).toBe(true);
  });

  it('re-gates against the org threshold rather than a hardcoded one', async () => {
    mockSales.resolveDiscountThreshold.mockResolvedValue(15);
    armSale();
    // Same 10% discount, but this org tolerates 15% — nothing to re-approve.
    const res = await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 990_000 });

    expect(mockSales.resolveDiscountThreshold).toHaveBeenCalledWith('pr1');
    expect(mockPrisma.saleUnitTransfer.create.mock.calls[0][0].data.approvalReRequired).toBe(false);
    expect(res.transfer.approvalReRequired).toBe(false);
  });
});

describe('SaleUnitTransferService — unit statuses and occupancy events', () => {
  it('releases the old unit to AVAILABLE and reserves the new one, both dated to the transfer', async () => {
    const res = await makeService().transferUnit(
      's1',
      { toUnitId: 'u2', effectiveDate: '2026-09-01' },
      'user-1',
    );
    const on = new Date('2026-09-01T00:00:00.000Z');

    expect(mockPrisma.unit.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'AVAILABLE', availableSince: on },
    });
    expect(mockPrisma.unit.update).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { status: 'UNDER_CONTRACT', availableSince: null },
    });
    expect(res.fromUnitReleased).toBe(true);
  });

  it('writes SALE_TRANSFERRED_OUT / SALE_TRANSFERRED_IN events dated to the transfer, not now()', async () => {
    await makeService().transferUnit('s1', { toUnitId: 'u2', effectiveDate: '2026-09-01' }, 'user-1');
    const on = new Date('2026-09-01T00:00:00.000Z');

    expect(mockStatusEvents.recordIfChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        unitId: 'u1',
        fromStatus: 'UNDER_CONTRACT',
        toStatus: 'AVAILABLE',
        source: 'SALE_TRANSFERRED_OUT',
        saleId: 's1',
        effectiveAt: on,
        recordedById: 'user-1',
      }),
      mockPrisma,
    );
    expect(mockStatusEvents.recordIfChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        unitId: 'u2',
        fromStatus: 'AVAILABLE',
        toStatus: 'UNDER_CONTRACT',
        source: 'SALE_TRANSFERRED_IN',
        saleId: 's1',
        effectiveAt: on,
      }),
      mockPrisma,
    );
  });

  it('does NOT release an old unit this sale was not holding', async () => {
    // The unit reads SOLD — something other than this sale put it there, and stomping it
    // back to AVAILABLE would erase whatever did.
    mockPrisma.unit.findUniqueOrThrow.mockImplementation((args: any) =>
      Promise.resolve({ status: args.where.id === 'u1' ? 'SOLD' : 'AVAILABLE' }),
    );

    const res = await makeService().transferUnit('s1', { toUnitId: 'u2' });

    const flipped = mockPrisma.unit.update.mock.calls.map((c: any) => c[0].where.id);
    expect(flipped).toEqual(['u2']);
    expect(res.fromUnitReleased).toBe(false);
    expect(mockStatusEvents.recordIfChanged).toHaveBeenCalledTimes(1);
  });
});

describe('SaleUnitTransferService — refusals', () => {
  it('refuses a CLOSED sale', async () => {
    armSale({ status: 'CLOSED' });

    await expect(makeService().transferUnit('s1', { toUnitId: 'u2' })).rejects.toThrow(
      /already CLOSED/,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a CANCELLED sale', async () => {
    armSale({ status: 'CANCELLED' });

    await expect(makeService().transferUnit('s1', { toUnitId: 'u2' })).rejects.toThrow(
      /was CANCELLED/,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a swap to the unit the sale is already on', async () => {
    await expect(makeService().transferUnit('s1', { toUnitId: 'u1' })).rejects.toThrow(
      /already the unit on this sale/,
    );
  });

  it('refuses a building-level sale — there is no unit to swap', async () => {
    armSale({ unitId: null, unit: null });

    await expect(makeService().transferUnit('s1', { toUnitId: 'u2' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a target unit under contract to someone else, naming the conflict', async () => {
    mockPrisma.sale.findFirst.mockResolvedValue({ buyer: 'Beta Corp', status: 'UNDER_CONTRACT' });

    await expect(makeService().transferUnit('s1', { toUnitId: 'u2' })).rejects.toThrow(
      /already committed to another buyer \(Beta Corp\)/,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a target unit under a live tenancy, naming the tenant', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue({ tenantName: 'Cream Stone' });

    await expect(makeService().transferUnit('s1', { toUnitId: 'u2' })).rejects.toThrow(
      /live tenancy \(Cream Stone\)/,
    );
  });

  it('refuses a target unit whose own status holds it, naming the status', async () => {
    armTarget({ status: 'SOLD' });

    await expect(makeService().transferUnit('s1', { toUnitId: 'u2' })).rejects.toThrow(
      /has already been sold \(status SOLD\)/,
    );
  });

  it('refuses a soft-deleted target unit', async () => {
    armTarget({ deletedAt: new Date() });

    await expect(makeService().transferUnit('s1', { toUnitId: 'u2' })).rejects.toThrow(
      /has been deleted/,
    );
  });

  it('refuses a target unit in another project', async () => {
    armTarget({ building: { projectId: 'pr2', name: 'Other' } });

    await expect(makeService().transferUnit('s1', { toUnitId: 'u2' })).rejects.toThrow(
      /different project/,
    );
  });

  it('404s a missing sale and a missing target unit', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(null);
    await expect(makeService().transferUnit('nope', { toUnitId: 'u2' })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    armSale();
    mockPrisma.unit.findUnique.mockResolvedValue(null);
    await expect(makeService().transferUnit('s1', { toUnitId: 'gone' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('SaleUnitTransferService — atomicity', () => {
  it('does the whole swap in ONE transaction', async () => {
    mockPrisma.salePayment.count.mockResolvedValue(1);
    mockPrisma.salePayment.findMany.mockResolvedValue([
      { id: 'p1', label: 'Deposit', sequence: 0, percentOfPrice: D(10), amount: D(80_000), paidAmount: D(0), status: 'SCHEDULED' },
    ]);

    await makeService().transferUnit('s1', { toUnitId: 'u2', newSalePrice: 1_000_000 });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // Every write went through the transaction client, so a failure anywhere takes the
    // lot with it. A half-applied swap — new unit reserved, old one still held, schedule
    // rebased against a price the sale no longer carries — is worse than a refusal.
    const tx = mockPrisma.$transaction.mock.calls[0][0];
    expect(typeof tx).toBe('function');
    expect(mockStatusEvents.recordIfChanged.mock.calls.every((c: any) => c[1] === mockPrisma)).toBe(
      true,
    );
  });

  it('propagates a failure from the transfer-row write rather than leaving the sale moved', async () => {
    mockPrisma.saleUnitTransfer.create.mockRejectedValue(new Error('constraint violation'));

    await expect(makeService().transferUnit('s1', { toUnitId: 'u2' })).rejects.toThrow(
      'constraint violation',
    );
    // The sale/unit writes above it are inside the same transaction callback, so the
    // rejection is what rolls them back — nothing here is committed on its own.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
