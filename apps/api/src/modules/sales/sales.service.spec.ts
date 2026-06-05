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
});
