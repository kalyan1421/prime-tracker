import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BrokersService } from './brokers.service';

const mockPrisma: any = {
  broker: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  lead: { count: jest.fn() },
  sale: { aggregate: jest.fn() },
};

function makeService() {
  return new BrokersService(mockPrisma as any);
}

describe('BrokersService', () => {
  let service: BrokersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  describe('create', () => {
    it('requires a name', async () => {
      await expect(service.create({ name: '  ' } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stores broker fields', async () => {
      mockPrisma.broker.create.mockImplementation((a: any) => Promise.resolve(a.data));
      const res: any = await service.create({ name: 'Jane Broker', company: 'Acme Realty', commissionRate: 2.5 });
      expect(res).toMatchObject({ name: 'Jane Broker', company: 'Acme Realty', commissionRate: 2.5 });
    });
  });

  describe('findById', () => {
    it('throws NotFound when missing', async () => {
      mockPrisma.broker.findFirst.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft-deletes (sets deletedAt + isActive false)', async () => {
      mockPrisma.broker.findFirst.mockResolvedValue({ id: 'b1' });
      mockPrisma.broker.update.mockImplementation((a: any) => Promise.resolve(a.data));
      const res: any = await service.remove('b1');
      expect(res.deletedAt).toBeInstanceOf(Date);
      expect(res.isActive).toBe(false);
    });
  });

  describe('report', () => {
    it('aggregates leads, closed sales, value, commission, and conversion per broker', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([
        { id: 'b1', name: 'Jane', company: 'Acme', commissionRate: 2, commissionFlat: null },
      ]);
      mockPrisma.lead.count.mockResolvedValue(10);
      mockPrisma.sale.aggregate.mockResolvedValue({ _count: 4, _sum: { salePrice: 4000000, brokerCommissionAmt: 80000 } });

      const rows = await service.report();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: 'Jane',
        leads: 10,
        closedSales: 4,
        closedValue: 4000000,
        commissionEarned: 80000,
        conversionPct: 40, // 4 / 10
      });
    });

    it('reports 0% conversion when a broker has no leads', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([{ id: 'b2', name: 'Bob', commissionRate: null, commissionFlat: 5000 }]);
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.sale.aggregate.mockResolvedValue({ _count: 0, _sum: { salePrice: null, brokerCommissionAmt: null } });

      const rows = await service.report();
      expect(rows[0]).toMatchObject({ leads: 0, closedSales: 0, closedValue: 0, commissionEarned: 0, conversionPct: 0 });
    });
  });
});
