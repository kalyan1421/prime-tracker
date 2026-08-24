import { NotFoundException } from '@nestjs/common';
import { CommissionInstallmentService } from './commission-installment.service';

const mockPrisma: any = {
  commissionInstallment: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
};

function makeService() {
  return new CommissionInstallmentService(mockPrisma as any);
}

describe('CommissionInstallmentService', () => {
  let service: CommissionInstallmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  describe('add', () => {
    it('numbers installments in sequence per parent', async () => {
      mockPrisma.commissionInstallment.count.mockResolvedValue(1);
      mockPrisma.commissionInstallment.create.mockImplementation((a: any) => Promise.resolve(a.data));
      const row: any = await service.add({ leaseId: 'l1' }, { brokerId: 'b1', amount: 5000 });
      expect(row.sequence).toBe(2);
      expect(row.leaseId).toBe('l1');
    });

    it('throws when neither a lease nor a sale is given', async () => {
      await expect(service.add({}, { brokerId: 'b1', amount: 1 })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('markPaid / remove', () => {
    it('markPaid 404s on an unknown id', async () => {
      mockPrisma.commissionInstallment.findUnique.mockResolvedValue(null);
      await expect(service.markPaid('x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('remove 404s on an unknown id', async () => {
      mockPrisma.commissionInstallment.findUnique.mockResolvedValue(null);
      await expect(service.remove('x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('settleAll', () => {
    it('marks every unpaid installment for the target paid, leaves paid ones alone', async () => {
      await service.settleAll({ saleId: 's1' });
      expect(mockPrisma.commissionInstallment.updateMany).toHaveBeenCalledWith({
        where: { saleId: 's1', paidAt: null },
        data: { paidAt: expect.any(Date) },
      });
    });
  });

  describe('syncStampedAmount', () => {
    it('does nothing without a broker or an amount', async () => {
      await service.syncStampedAmount({ leaseId: 'l1' }, null, 5000);
      await service.syncStampedAmount({ leaseId: 'l1' }, 'b1', null);
      expect(mockPrisma.commissionInstallment.findMany).not.toHaveBeenCalled();
    });

    it('creates installment #1 when none exist yet', async () => {
      mockPrisma.commissionInstallment.findMany.mockResolvedValue([]);
      mockPrisma.commissionInstallment.count.mockResolvedValue(0);
      mockPrisma.commissionInstallment.create.mockImplementation((a: any) => Promise.resolve(a.data));

      await service.syncStampedAmount({ leaseId: 'l1' }, 'b1', 9000);

      expect(mockPrisma.commissionInstallment.create).toHaveBeenCalledWith({
        data: { leaseId: 'l1', brokerId: 'b1', sequence: 1, amount: 9000, paidAt: null, notes: null },
      });
    });

    // The safe re-stamp case: nothing has been paid, so correcting the one installment's
    // amount cannot silently rewrite money that already moved.
    it('adjusts the single unpaid installment when the stamped amount changes', async () => {
      mockPrisma.commissionInstallment.findMany.mockResolvedValue([
        { id: 'ci1', sequence: 1, amount: 9000, paidAt: null, brokerId: 'b1' },
      ]);

      await service.syncStampedAmount({ leaseId: 'l1' }, 'b1', 12000);

      expect(mockPrisma.commissionInstallment.update).toHaveBeenCalledWith({
        where: { id: 'ci1' },
        data: { amount: 12000 },
      });
    });

    // The case R7's spec calls out explicitly: once an installment has been paid, a
    // re-stamp must NOT silently rewrite it — the stamped total and the installment sum
    // are allowed to disagree, surfaced for a human to reconcile rather than resolved
    // here by moving money that already moved.
    it('leaves installments untouched once one of them has been paid', async () => {
      mockPrisma.commissionInstallment.findMany.mockResolvedValue([
        { id: 'ci1', sequence: 1, amount: 9000, paidAt: new Date('2026-01-01'), brokerId: 'b1' },
      ]);

      await service.syncStampedAmount({ leaseId: 'l1' }, 'b1', 12000);

      expect(mockPrisma.commissionInstallment.update).not.toHaveBeenCalled();
      expect(mockPrisma.commissionInstallment.create).not.toHaveBeenCalled();
    });

    it('leaves installments untouched when more than one already exists', async () => {
      mockPrisma.commissionInstallment.findMany.mockResolvedValue([
        { id: 'ci1', sequence: 1, amount: 5000, paidAt: null, brokerId: 'b1' },
        { id: 'ci2', sequence: 2, amount: 4000, paidAt: null, brokerId: 'b1' },
      ]);

      await service.syncStampedAmount({ leaseId: 'l1' }, 'b1', 12000);

      expect(mockPrisma.commissionInstallment.update).not.toHaveBeenCalled();
      expect(mockPrisma.commissionInstallment.create).not.toHaveBeenCalled();
    });
  });
});
