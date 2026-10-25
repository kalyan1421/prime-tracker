/**
 * A sale created straight into CLOSED is written and closed in ONE transaction.
 *
 * It used to be create → commit → update(CLOSED) in a second transaction, so a close that
 * failed (rent collected past the closing date, say) left the sale committed at
 * UNDER_CONTRACT after the user had been told it did not save.
 *
 * Today's stage-document map makes "create already CLOSED" unreachable (the paperwork has
 * to attach to a sale that exists — see sales.service.spec), so the gate is stubbed open
 * here to exercise the path the moment the map no longer forbids it.
 */
jest.mock('./sale-document-gates', () => ({
  ...jest.requireActual('./sale-document-gates'),
  requiredDocsForTransition: jest.fn(() => []),
}));

import { BadRequestException } from '@nestjs/common';
import { SalesService } from './sales.service';

function makeService() {
  const tx: any = {
    sale: {
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'new', projectId: 'pr1', buildingId: null, closingDate: null, brokerId: null, brokerCommissionAmt: null, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve({ id: where.id, projectId: 'pr1', unitId: 'u1', status: 'CLOSED', brokerId: null, brokerCommissionAmt: null })),
    },
    unit: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'AVAILABLE' }),
      update: jest.fn().mockResolvedValue({}),
    },
    lease: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma: any = {
    unit: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', askingPrice: null, building: { projectId: 'pr1' } }) },
    sale: { create: jest.fn() },
    project: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const bus = { emit: jest.fn() };
  const statusEvents = { record: jest.fn(), recordIfChanged: jest.fn() };
  const leases = { endTenancyWithin: jest.fn() };
  const commission = { syncStampedAmount: jest.fn() };
  const service = new SalesService(
    prisma, bus as any, statusEvents as any, leases as any, {} as any, commission as any, {} as any, {} as any,
  );
  return { service, prisma, tx, bus, statusEvents };
}

describe('SalesService.create — a sale born CLOSED is atomic', () => {
  it('inserts and closes in a single transaction, through the shared closing path', async () => {
    const { service, prisma, tx, bus, statusEvents } = makeService();

    const sale: any = await service.create(
      { projectId: 'pr1', unitId: 'u1', buyer: 'B', salePrice: 100, status: 'CLOSED' } as any,
      'user-1',
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Never written outside the transaction.
    expect(prisma.sale.create).not.toHaveBeenCalled();
    expect(tx.sale.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'UNDER_CONTRACT' }),
    });
    expect(tx.sale.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'new', status: { not: 'CLOSED' } },
      data: expect.objectContaining({ status: 'CLOSED' }),
    }));
    expect(tx.unit.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { status: 'SOLD', availableSince: null } });
    expect(statusEvents.recordIfChanged).toHaveBeenCalledWith(expect.objectContaining({ source: 'SALE_CLOSED' }), tx);
    expect(sale.status).toBe('CLOSED');
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'unit.sold', unitId: 'u1', saleId: 'new' }));
  });

  it('a failure while closing rejects the whole create — nothing was committed outside it', async () => {
    const { service, prisma, tx, bus } = makeService();
    tx.unit.update.mockRejectedValueOnce(new Error('unit write failed'));

    await expect(
      service.create({ projectId: 'pr1', unitId: 'u1', buyer: 'B', salePrice: 100, status: 'CLOSED' } as any),
    ).rejects.toThrow('unit write failed');
    expect(prisma.sale.create).not.toHaveBeenCalled();
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('still requires a price, before anything is written', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.create({ projectId: 'pr1', unitId: 'u1', buyer: 'B', status: 'CLOSED' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
