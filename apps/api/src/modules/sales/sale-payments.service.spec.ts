import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalePaymentsService } from './sale-payments.service';

const mockPrisma = {
  sale: { findFirst: jest.fn() },
  salePayment: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};

const mockBus = { emit: jest.fn() };

function makeService() {
  return new SalePaymentsService(mockPrisma as any, mockBus as any);
}

describe('SalePaymentsService', () => {
  let service: SalePaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  describe('addPayment', () => {
    it('throws when the sale does not exist', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue(null);
      await expect(service.addPayment('s1', { label: 'Deposit', amount: 100 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('requires a milestoneId for ON_MILESTONE installments', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({ id: 's1', salePrice: 1000 });
      await expect(
        service.addPayment('s1', { label: 'Foundation', amount: 100, trigger: 'ON_MILESTONE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a dueDate for FIXED_DATE installments', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({ id: 's1', salePrice: 1000 });
      await expect(
        service.addPayment('s1', { label: 'Slab', amount: 100, trigger: 'FIXED_DATE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('computes amount from percentOfPrice when no explicit amount is given', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({ id: 's1', salePrice: 1000 });
      mockPrisma.salePayment.findFirst.mockResolvedValue(null); // nextSequence → 0
      mockPrisma.salePayment.create.mockResolvedValue({ id: 'p1' });
      await service.addPayment('s1', { label: 'Deposit', percentOfPrice: 10, trigger: 'ON_SIGNING' });
      expect(mockPrisma.salePayment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 100, sequence: 0 }) }),
      );
    });

    it('rejects when neither amount nor percentOfPrice is provided', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({ id: 's1', salePrice: 1000 });
      mockPrisma.salePayment.findFirst.mockResolvedValue(null);
      await expect(
        service.addPayment('s1', { label: 'Mystery', trigger: 'ON_SIGNING' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('applyTemplate', () => {
    it('seeds installments from the 10-40-50 template against the sale price', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({ id: 's1', salePrice: 1000 });
      mockPrisma.salePayment.count.mockResolvedValue(0);
      mockPrisma.salePayment.create.mockImplementation((args: any) => Promise.resolve(args.data));
      const result = await service.applyTemplate('s1', '10-40-50');
      expect(result).toHaveLength(3);
      expect(result.map((r: any) => r.amount)).toEqual([100, 400, 500]);
      expect(result.map((r: any) => r.sequence)).toEqual([0, 1, 2]);
    });

    it('refuses to apply a template when a schedule already exists', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({ id: 's1', salePrice: 1000 });
      mockPrisma.salePayment.count.mockResolvedValue(2);
      await expect(service.applyTemplate('s1', '10-40-50')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('logPayment (partial-aware)', () => {
    it('marks PARTIALLY_PAID when the payment is less than the total', async () => {
      mockPrisma.salePayment.findUnique.mockResolvedValue({ id: 'p1', saleId: 's1', amount: 1000, paidAmount: 0 });
      mockPrisma.salePayment.update.mockImplementation((args: any) => Promise.resolve(args.data));
      const res: any = await service.logPayment('p1', 400);
      expect(res.status).toBe('PARTIALLY_PAID');
      expect(res.paidAmount).toBe(400);
      expect(res.paidAt).toBeNull();
      expect(mockBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'salePayment.paid', amount: 400 }));
    });

    it('marks PAID and stamps paidAt when cumulative payments reach the total', async () => {
      mockPrisma.salePayment.findUnique.mockResolvedValue({ id: 'p1', saleId: 's1', amount: 1000, paidAmount: 600 });
      mockPrisma.salePayment.update.mockImplementation((args: any) => Promise.resolve(args.data));
      const res: any = await service.logPayment('p1', 400);
      expect(res.status).toBe('PAID');
      expect(res.paidAmount).toBe(1000);
      expect(res.paidAt).toBeInstanceOf(Date);
    });

    it('rejects a non-positive payment', async () => {
      await expect(service.logPayment('p1', 0)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('applyMilestoneCompletion', () => {
    it('stamps effectiveDueDate and flips linked SCHEDULED installments to DUE', async () => {
      const completedAt = new Date('2026-06-02T00:00:00Z');
      mockPrisma.salePayment.findMany.mockResolvedValue([
        { id: 'p1', saleId: 's1' },
        { id: 'p2', saleId: 's1' },
      ]);
      mockPrisma.salePayment.update.mockResolvedValue({});
      const count = await service.applyMilestoneCompletion('m1', completedAt);
      expect(count).toBe(2);
      expect(mockPrisma.salePayment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { effectiveDueDate: completedAt, status: 'DUE' } }),
      );
      expect(mockBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'salePayment.due' }));
    });

    it('only targets ON_MILESTONE + SCHEDULED rows for the milestone', async () => {
      mockPrisma.salePayment.findMany.mockResolvedValue([]);
      await service.applyMilestoneCompletion('m1', new Date());
      expect(mockPrisma.salePayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { milestoneId: 'm1', trigger: 'ON_MILESTONE', status: 'SCHEDULED' },
        }),
      );
    });
  });

  describe('receivables', () => {
    it('returns only rows due within the horizon, with outstanding computed, sorted by due date', async () => {
      const soon = new Date(Date.now() + 3 * 86_400_000);
      const later = new Date(Date.now() + 90 * 86_400_000);
      mockPrisma.salePayment.findMany.mockResolvedValue([
        { id: 'far', saleId: 's1', label: 'Late', amount: 500, paidAmount: 0, status: 'SCHEDULED', dueDate: later, effectiveDueDate: null, sale: { id: 's1', buyer: 'B', projectId: 'pr1' } },
        { id: 'near', saleId: 's1', label: 'Soon', amount: 200, paidAmount: 50, status: 'DUE', dueDate: soon, effectiveDueDate: null, sale: { id: 's1', buyer: 'B', projectId: 'pr1' } },
      ]);
      const res = await service.receivables(4);
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('near');
      expect(res[0].outstanding).toBe(150);
    });
  });
});
