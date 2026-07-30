import { ForbiddenException } from '@nestjs/common';
import { SalesService } from './sales.service';

const mockPrisma: any = {
  sale: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  unit: { findUnique: jest.fn(), update: jest.fn() },
  project: { findUnique: jest.fn() },
  orgSettings: { findUnique: jest.fn() },
  broker: { findUnique: jest.fn() },
  // Support both forms: array (batch) and callback (interactive) transactions.
  $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma))),
};

// The CLOSE-with-unit path uses an optimistic-locked interactive transaction
// (updateMany guarded on status != CLOSED, then findUniqueOrThrow). Default to "won the race".
function stubCloseTxn() {
  mockPrisma.sale.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.sale.findUniqueOrThrow.mockImplementation((args: any) =>
    Promise.resolve({ id: args.where.id, status: 'CLOSED' }),
  );
}
const mockBus = { emit: jest.fn() };

function makeService() {
  return new SalesService(mockPrisma as any, mockBus as any);
}

describe('SalesService.update — unit-status side effects', () => {
  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.sale.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, status: args.data.status }),
    );
    mockPrisma.unit.update.mockResolvedValue({});
    stubCloseTxn();
  });

  it('CANCELLING a sale releases the reserved unit back to AVAILABLE (backend-issue #1)', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'UNDER_CONTRACT', unitId: 'u1', unit: {} });
    mockPrisma.unit.findUnique.mockResolvedValue({ status: 'UNDER_CONTRACT' });

    await service.update('s1', { status: 'CANCELLED', lostReason: 'PRICE_TOO_HIGH' } as any);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.unit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ status: 'AVAILABLE', availableSince: expect.any(Date) }),
      }),
    );
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sale.statusChanged', from: 'UNDER_CONTRACT', to: 'CANCELLED' }),
    );
  });

  it('does NOT touch a unit that is already SOLD when a (closed) sale is cancelled', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'CLOSED', unitId: 'u1', unit: {} });
    mockPrisma.unit.findUnique.mockResolvedValue({ status: 'SOLD' });

    await service.update('s1', { status: 'CANCELLED' } as any);

    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
    expect(mockPrisma.sale.update).toHaveBeenCalledTimes(1);
  });

  it('still flips the unit to SOLD when a sale CLOSES (regression)', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'UNDER_CONTRACT', unitId: 'u1', unit: {} });

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockPrisma.unit.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { status: 'SOLD', availableSince: null } }),
    );
  });

  it('defaults lostReason to OTHER when cancelling without one', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'PROSPECT', unitId: null, unit: null });

    await service.update('s1', { status: 'CANCELLED' } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lostReason: 'OTHER' }) }),
    );
    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
  });
});

describe('SalesService — discount-approval gate', () => {
  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.sale.update.mockImplementation((args: any) => Promise.resolve({ id: args.where.id }));
    mockPrisma.unit.update.mockResolvedValue({});
    mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'o1' });
    mockPrisma.orgSettings.findUnique.mockResolvedValue({ discountApprovalThresholdPct: 5 });
    stubCloseTxn();
  });

  it('blocks committing a sale whose discount exceeds the threshold and is unapproved', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 90, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 }); // 10% discount > 5%

    await expect(service.update('s1', { status: 'CLOSED' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.sale.update).not.toHaveBeenCalled();
  });

  it('allows committing once the discount has been approved', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 90,
      discountApprovedAt: new Date(), unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 });

    await service.update('s1', { status: 'CLOSED' } as any);
    // close-with-unit commits via the optimistic-locked updateMany, not update
    expect(mockPrisma.sale.updateMany).toHaveBeenCalled();
  });

  it('allows committing when the discount is within the threshold', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 97, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 }); // 3% ≤ 5%

    await service.update('s1', { status: 'CLOSED' } as any);
    expect(mockPrisma.sale.updateMany).toHaveBeenCalled();
  });

  it('does NOT re-stamp commission / re-flip the unit when a concurrent CLOSE won the race', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 97, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 });
    mockPrisma.sale.updateMany.mockResolvedValue({ count: 0 }); // lost the optimistic lock

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
    expect(mockPrisma.sale.findUniqueOrThrow).toHaveBeenCalled();
  });

  it('the LOSER of a concurrent CLOSE emits nothing (no duplicate unit.sold notifications)', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 97, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 });
    mockPrisma.sale.updateMany.mockResolvedValue({ count: 0 }); // lost the optimistic lock

    await service.update('s1', { status: 'CLOSED' } as any);

    // The pre-transaction snapshot still says UNDER_CONTRACT, but this request wrote
    // nothing — announcing the close would double-notify ~10 recipients.
    expect(mockBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'unit.sold' }));
    expect(mockBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sale.statusChanged' }));
    expect(mockBus.emit).not.toHaveBeenCalled();
  });

  it('the WINNER of a concurrent CLOSE emits unit.sold + sale.statusChanged exactly once', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 97, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 });
    mockPrisma.sale.updateMany.mockResolvedValue({ count: 1 }); // won the optimistic lock

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockBus.emit).toHaveBeenCalledWith({
      type: 'unit.sold', unitId: 'u1', saleId: 's1', projectId: 'pr1',
    });
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sale.statusChanged', from: 'UNDER_CONTRACT', to: 'CLOSED' }),
    );
    expect(mockBus.emit.mock.calls.filter((c: any[]) => c[0].type === 'unit.sold')).toHaveLength(1);
  });

  it('does not gate a building-level sale (no unit asking price)', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'PROSPECT', projectId: 'pr1', unitId: null, salePrice: 90, discountApprovedAt: null, unit: null,
    });

    await service.update('s1', { status: 'UNDER_CONTRACT' } as any);
    expect(mockPrisma.sale.update).toHaveBeenCalled();
    expect(mockPrisma.unit.findUnique).not.toHaveBeenCalled();
  });

  it('approveDiscount stamps approver + timestamp', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', unit: {} });
    await service.approveDiscount('s1', 'founder-1');
    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ discountApprovedById: 'founder-1', discountApprovedAt: expect.any(Date) }),
      }),
    );
  });
});

describe('SalesService — broker commission on close', () => {
  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.sale.update.mockImplementation((args: any) => Promise.resolve({ id: args.where.id }));
  });

  // building-level sale (unitId null) → skips the discount gate, exercises commission only
  const brokerSale = (over: any = {}) => ({
    id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: null, salePrice: 1000000,
    brokerId: 'br1', brokerCommissionPct: null, discountApprovedAt: null, unit: null, ...over,
  });

  it('stamps commission = salePrice × broker rate on close', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale());
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokerCommissionAmt: 20000 }) }),
    );
  });

  it('per-sale commission % overrides the broker default rate', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ brokerCommissionPct: 3 }));
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokerCommissionAmt: 30000 }) }),
    );
  });

  it('falls back to a flat fee when no percentage is set', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale());
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: null, commissionFlat: 5000 });

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokerCommissionAmt: 5000 }) }),
    );
  });

  it('stamps no commission when the sale has no broker', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ brokerId: null }));

    await service.update('s1', { status: 'CLOSED' } as any);

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    expect(data.brokerCommissionAmt).toBeUndefined();
    expect(mockPrisma.broker.findUnique).not.toHaveBeenCalled();
  });

  // Correcting a closed sale's record afterward (e.g. from the unit detail page) must
  // keep the stamped commission honest — it must not go stale just because the sale
  // isn't transitioning INTO closed this time.
  it('recomputes commission when an ALREADY-CLOSED sale has its broker % edited', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED', brokerCommissionPct: 2 }));
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

    await service.update('s1', { brokerCommissionPct: 5 } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokerCommissionAmt: 50000 }) }),
    );
  });

  it('recomputes commission when an ALREADY-CLOSED sale has its sale price edited', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED' }));
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

    await service.update('s1', { salePrice: 2000000 } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokerCommissionAmt: 40000 }) }),
    );
  });

  it('zeroes the commission when the broker is explicitly cleared on an already-closed sale', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED' }));

    await service.update('s1', { brokerId: null } as any);

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    expect(data.brokerCommissionAmt).toBeNull();
    // Must not fall through to the OLD broker via computeBrokerCommission's `?? sale.brokerId`.
    expect(mockPrisma.broker.findUnique).not.toHaveBeenCalled();
  });

  it('does NOT touch commission on an unrelated field edit to an already-closed sale', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED' }));

    await service.update('s1', { notes: 'corrected buyer spelling' } as any);

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    expect(data.brokerCommissionAmt).toBeUndefined();
    expect(mockPrisma.broker.findUnique).not.toHaveBeenCalled();
  });

  // The edit form sends null (not undefined) for a field the user emptied, so "cleared"
  // and "omitted" arrive as different values and must behave differently.
  it('falls back to the broker default rate when the per-sale % is cleared on a closed sale', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED', brokerCommissionPct: 3 }));
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

    await service.update('s1', { brokerCommissionPct: null } as any);

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    // 2% of 1,000,000 — the broker default. NOT 30000, which would recompute from the
    // 3% override that this very request deleted.
    expect(Number(data.brokerCommissionAmt)).toBe(20000);
  });

  it('clears a stale commission when the new broker has neither a rate nor a flat fee', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED', brokerCommissionAmt: 20000 }));
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: null, commissionFlat: null });

    await service.update('s1', { brokerId: 'br2' } as any);

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    // Nothing computable for br2 → the $20,000 stamped for the previous broker must go,
    // not survive by omission.
    expect(data.brokerCommissionAmt).toBeNull();
  });
});

describe('SalesService.delete — soft delete (preserves unit history)', () => {
  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('soft-deletes via update(deletedAt) instead of a hard Prisma delete', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'PROSPECT', unitId: 'u1', unit: {} });
    mockPrisma.sale.update.mockResolvedValue({ id: 's1', deletedAt: new Date() });
    expect(mockPrisma.sale.delete).toBeUndefined(); // never wired up — nothing in this service should call it

    await service.delete('s1', 'FOUNDER' as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('a soft-deleted sale reads back as not-found', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'PROSPECT', deletedAt: new Date() });
    await expect(service.findById('s1')).rejects.toThrow('Sale not found');
  });

  it('still blocks a non-Founder/SuperAdmin from deleting a CLOSED sale', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'CLOSED', unitId: 'u1', unit: {} });
    await expect(service.delete('s1', 'SALES' as any)).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.sale.update).not.toHaveBeenCalled();
  });
});
