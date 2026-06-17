import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UnitsService } from './units.service';

const mockPrisma: any = {
  unit: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn((cb: any) => cb(mockPrisma)),
};

function makeService() {
  // ProjectAccessService stub: no scoping in unit tests (undefined = unrestricted).
  return new UnitsService(mockPrisma as any, { listProjectScope: async () => undefined } as any);
}

const PM: UserRole = 'PROJECT_MANAGER';

const srcUnits = [
  { id: 'u1', buildingId: 'b1', unitType: 'RETAIL', unitNumber: '101', sqft: 1000, floorArea: null, mezzanineArea: null, primeOwned: true, _count: { sales: 0, leases: 0 } },
  { id: 'u2', buildingId: 'b1', unitType: 'RETAIL', unitNumber: '102', sqft: 500, floorArea: null, mezzanineArea: null, primeOwned: true, _count: { sales: 0, leases: 0 } },
];

describe('UnitsService.combine', () => {
  let service: UnitsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('rejects the SALES role outright', async () => {
    await expect(
      service.combine({ buildingId: 'b1', sourceUnitIds: ['u1', 'u2'], unitNumber: '101+102' }, 'SALES'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects fewer than two source units', async () => {
    await expect(
      service.combine({ buildingId: 'b1', sourceUnitIds: ['u1'], unitNumber: '101+102' }, PM),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a blank combined unit number', async () => {
    await expect(
      service.combine({ buildingId: 'b1', sourceUnitIds: ['u1', 'u2'], unitNumber: '  ' }, PM),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when a source unit is missing or already merged', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([srcUnits[0]]); // only 1 of 2 found
    await expect(
      service.combine({ buildingId: 'b1', sourceUnitIds: ['u1', 'u2'], unitNumber: '101+102' }, PM),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects units from a different building', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([srcUnits[0], { ...srcUnits[1], buildingId: 'OTHER' }]);
    await expect(
      service.combine({ buildingId: 'b1', sourceUnitIds: ['u1', 'u2'], unitNumber: '101+102' }, PM),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to combine units that have attached sales or active leases', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([
      srcUnits[0],
      { ...srcUnits[1], _count: { sales: 1, leases: 0 } },
    ]);
    await expect(
      service.combine({ buildingId: 'b1', sourceUnitIds: ['u1', 'u2'], unitNumber: '101+102' }, PM),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.unit.create).not.toHaveBeenCalled();
  });

  it('rejects a combined number that clashes with an existing unit', async () => {
    mockPrisma.unit.findMany.mockResolvedValue(srcUnits);
    mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1' }); // number already taken
    await expect(
      service.combine({ buildingId: 'b1', sourceUnitIds: ['u1', 'u2'], unitNumber: '101' }, PM),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates the combined unit (summed area) and soft-archives the sources', async () => {
    mockPrisma.unit.findMany.mockResolvedValue(srcUnits);
    mockPrisma.unit.findUnique.mockResolvedValue(null);
    mockPrisma.unit.create.mockResolvedValue({ id: 'c1', unitNumber: '101+102' });
    mockPrisma.unit.updateMany.mockResolvedValue({ count: 2 });

    const res: any = await service.combine({ buildingId: 'b1', sourceUnitIds: ['u1', 'u2'], unitNumber: '101+102' }, PM);

    expect(res.id).toBe('c1');
    expect(mockPrisma.unit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ buildingId: 'b1', unitNumber: '101+102', sqft: 1500, status: 'AVAILABLE' }),
      }),
    );
    expect(mockPrisma.unit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['u1', 'u2'] } },
        data: expect.objectContaining({ mergedIntoId: 'c1', deletedAt: expect.any(Date) }),
      }),
    );
  });
});
