import { ForbiddenException } from '@nestjs/common';
import { SalesService } from './sales.service';

const mockPrisma: any = {
  sale: { findUnique: jest.fn(), update: jest.fn() },
  unit: { findUnique: jest.fn(), update: jest.fn() },
  project: { findUnique: jest.fn() },
  orgSettings: { findUnique: jest.fn() },
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};
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
    expect(mockPrisma.sale.update).toHaveBeenCalled();
  });

  it('allows committing when the discount is within the threshold', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 97, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 }); // 3% ≤ 5%

    await service.update('s1', { status: 'CLOSED' } as any);
    expect(mockPrisma.sale.update).toHaveBeenCalled();
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
