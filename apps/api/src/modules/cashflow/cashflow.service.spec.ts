import { CashFlowService } from './cashflow.service';

const mockPrisma = {
  cashFlowEntry: { findMany: jest.fn() },
  salePayment: { findMany: jest.fn() },
};

function makeService() {
  return new CashFlowService(mockPrisma as any);
}

describe('CashFlowService.getForecast — sale-payment inflows', () => {
  let service: CashFlowService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('adds outstanding sale-payment installments as projected inflows, bucketed by due month', async () => {
    mockPrisma.cashFlowEntry.findMany.mockResolvedValue([]); // no manual entries
    mockPrisma.salePayment.findMany.mockResolvedValue([
      { amount: 1000, paidAmount: 200, dueDate: new Date('2026-07-15T00:00:00Z'), effectiveDueDate: null },
      { amount: 500, paidAmount: 0, dueDate: null, effectiveDueDate: new Date('2026-08-01T00:00:00Z') },
    ]);

    const forecast = await service.getForecast('p1');
    const jul = forecast.monthly.find((m) => m.month === '2026-07');
    const aug = forecast.monthly.find((m) => m.month === '2026-08');

    expect(jul?.inflows).toBe(800); // 1000 - 200 outstanding
    expect(aug?.inflows).toBe(500);
    expect(forecast.summary.totalInflows).toBe(1300);
  });

  it('uses effectiveDueDate over dueDate and skips fully-paid / undated installments', async () => {
    mockPrisma.cashFlowEntry.findMany.mockResolvedValue([]);
    mockPrisma.salePayment.findMany.mockResolvedValue([
      { amount: 1000, paidAmount: 1000, dueDate: new Date('2026-07-15T00:00:00Z'), effectiveDueDate: null }, // fully paid → skip
      { amount: 300, paidAmount: 0, dueDate: null, effectiveDueDate: null }, // no date → skip
      { amount: 400, paidAmount: 0, dueDate: new Date('2026-09-30T00:00:00Z'), effectiveDueDate: new Date('2026-07-20T00:00:00Z') },
    ]);

    const forecast = await service.getForecast('p1');
    expect(forecast.monthly.find((m) => m.month === '2026-07')?.inflows).toBe(400); // bucketed by effectiveDueDate
    expect(forecast.summary.totalInflows).toBe(400);
  });
});
