import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeasesService } from './leases.service';

const mockPrisma: any = {
  lease: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

function makeService() {
  return new LeasesService(mockPrisma as any);
}

describe('LeasesService.delete — soft delete (preserves unit history)', () => {
  let service: LeasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('soft-deletes via update(deletedAt) instead of a hard Prisma delete', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({ id: 'l1', unitId: 'u1', status: 'EXPIRED' });
    mockPrisma.lease.update.mockResolvedValue({ id: 'l1', deletedAt: new Date() });
    expect(mockPrisma.lease.delete).toBeUndefined(); // never wired up — nothing in this service should call it

    await service.delete('l1');

    expect(mockPrisma.lease.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('a soft-deleted lease reads back as not-found', async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({ id: 'l1', deletedAt: new Date() });
    await expect(service.findById('l1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LeasesService.create — active-lease uniqueness ignores soft-deleted rows', () => {
  let service: LeasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  const validData = {
    unitId: 'u1',
    tenantName: 'Acme',
    monthlyRent: 1000,
    leaseStart: '2026-01-01',
    leaseEnd: '2027-01-01',
    termMonths: 12,
  } as any;

  it('allows a new lease when the only "active" row for the unit was soft-deleted', async () => {
    // findFirst is called with deletedAt: null — simulate the DB correctly excluding
    // the soft-deleted row by having the mock only match on that filter.
    mockPrisma.lease.findFirst.mockImplementation((args: any) =>
      args.where.deletedAt === null ? Promise.resolve(null) : Promise.resolve({ id: 'stale' }),
    );
    mockPrisma.lease.create.mockResolvedValue({ id: 'l2', ...validData });

    const result = await service.create(validData);

    expect(mockPrisma.lease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ unitId: 'u1', deletedAt: null }) }),
    );
    expect(result.id).toBe('l2');
  });

  it('still blocks creation when a genuinely active (non-deleted) lease exists', async () => {
    mockPrisma.lease.findFirst.mockResolvedValue({ id: 'active-lease' });
    await expect(service.create(validData)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.lease.create).not.toHaveBeenCalled();
  });
});
