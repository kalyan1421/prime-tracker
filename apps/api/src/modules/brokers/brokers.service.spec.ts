import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BrokersService } from './brokers.service';

const mockPrisma: any = {
  broker: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  lead: { groupBy: jest.fn() },
  sale: { groupBy: jest.fn() },
  // Leasing commission (R23) — the report now aggregates leases alongside sales.
  lease: { groupBy: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
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
      mockPrisma.lead.groupBy.mockResolvedValue([{ brokerId: 'b1', _count: 10 }]);
      mockPrisma.sale.groupBy.mockResolvedValue([
        { brokerId: 'b1', _count: 4, _sum: { salePrice: 4000000, brokerCommissionAmt: 80000 } },
      ]);
      mockPrisma.lease.groupBy.mockResolvedValue([]);

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
      mockPrisma.lead.groupBy.mockResolvedValue([]);
      mockPrisma.sale.groupBy.mockResolvedValue([]);
      mockPrisma.lease.groupBy.mockResolvedValue([]);

      const rows = await service.report();
      expect(rows[0]).toMatchObject({ leads: 0, closedSales: 0, closedValue: 0, commissionEarned: 0, conversionPct: 0 });
    });

    // Leasing commission is reported as its OWN pair of columns, not folded into the
    // sale totals: a sale fee is a one-off on a disposal, a leasing fee is earned on a
    // tenancy, and a single blended "commission earned" would reconcile to neither
    // side's ledger. Both are exposed, plus a total for callers that want one number.
    it('reports leasing commission separately from sale commission', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([
        { id: 'b1', name: 'Jane', company: 'Acme', commissionRate: 2, commissionFlat: null },
      ]);
      mockPrisma.lead.groupBy.mockResolvedValue([]);
      mockPrisma.sale.groupBy
        .mockResolvedValueOnce([{ brokerId: 'b1', _count: 2, _sum: { salePrice: 1000000, brokerCommissionAmt: 20000 } }])
        .mockResolvedValueOnce([{ brokerId: 'b1', _sum: { brokerCommissionAmt: 5000 } }])  // paid
        .mockResolvedValueOnce([]);                                                        // pipeline
      mockPrisma.lease.groupBy
        .mockResolvedValueOnce([{ brokerId: 'b1', _count: 3, _sum: { brokerCommissionAmt: 9000, monthlyRent: 30000 } }])
        .mockResolvedValueOnce([{ brokerId: 'b1', _sum: { brokerCommissionAmt: 4000 } }]);  // paid

      const rows = await service.report();

      expect(rows[0]).toMatchObject({
        commissionEarned: 20000,          // sales only
        commissionOwed: 15000,            // 20000 - 5000
        leasesSigned: 3,
        leaseCommissionEarned: 9000,
        leaseCommissionPaid: 4000,
        leaseCommissionOwed: 5000,
        totalCommissionEarned: 29000,     // both sides
        totalCommissionOwed: 20000,
      });
    });

    // REGRESSION: both leasing groupBys filtered `status: 'ACTIVE'`. A 3-year lease with
    // $18,000 stamped at activation and never paid fell out of the report the day its
    // term ran out and endTenancy flipped it to EXPIRED — earned, paid and owed all read
    // 0, and the report showed Prime owing the broker nothing on a live debt.
    it('still counts an unpaid leasing commission after the tenancy has ended', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([
        { id: 'b1', name: 'Jane', company: 'Acme', commissionRate: 3, commissionFlat: null },
      ]);
      mockPrisma.lead.groupBy.mockResolvedValue([]);
      mockPrisma.sale.groupBy.mockResolvedValue([]);
      // The EXPIRED lease — returned only because the query no longer filters on status.
      mockPrisma.lease.groupBy
        .mockResolvedValueOnce([
          { brokerId: 'b1', _count: 1, _sum: { brokerCommissionAmt: 18000, monthlyRent: 9000 } },
        ])
        .mockResolvedValueOnce([]); // nothing paid

      const rows = await service.report();

      expect(rows[0]).toMatchObject({
        leasesSigned: 1,
        signedMonthlyRent: 9000,
        leaseCommissionEarned: 18000,
        leaseCommissionPaid: 0,
        leaseCommissionOwed: 18000,
        totalCommissionOwed: 18000,
      });
    });

    it('filters leasing commission on "an amount was stamped", never on a lease status', async () => {
      mockPrisma.broker.findMany.mockResolvedValue([]);
      mockPrisma.lead.groupBy.mockResolvedValue([]);
      mockPrisma.sale.groupBy.mockResolvedValue([]);
      mockPrisma.lease.groupBy.mockResolvedValue([]);

      await service.report();

      // ACTIVE is a state a lease LEAVES; the amount being non-null is the durable
      // record that the fee was earned (it is stamped once, at activation), which also
      // keeps DRAFT leases that never went live out of the totals.
      for (const [args] of mockPrisma.lease.groupBy.mock.calls) {
        expect(args.where.status).toBeUndefined();
        expect(args.where.brokerCommissionAmt).toEqual({ not: null });
        expect(args.where.deletedAt).toBeNull();
      }
      // The sale side is unchanged — CLOSED is terminal, so it was never affected.
      for (const [args] of mockPrisma.sale.groupBy.mock.calls) {
        expect(args.where.brokerCommissionAmt).toBeUndefined();
      }
    });
  });

  describe('markLeaseCommissionPaid', () => {
    it('refuses a lease with no broker attached', async () => {
      mockPrisma.lease.findFirst.mockResolvedValue({ id: 'l1', brokerId: null });
      await expect(service.markLeaseCommissionPaid('l1')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.lease.update).not.toHaveBeenCalled();
    });

    it('stamps the paid date', async () => {
      mockPrisma.lease.findFirst.mockResolvedValue({ id: 'l1', brokerId: 'b1' });
      mockPrisma.lease.update.mockImplementation((a: any) => Promise.resolve(a.data));
      const res: any = await service.markLeaseCommissionPaid('l1');
      expect(res.brokerCommissionPaidAt).toBeInstanceOf(Date);
    });
  });
});
