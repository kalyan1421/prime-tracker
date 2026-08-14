import { ConflictException } from '@nestjs/common';
import { BuildingsService } from './buildings.service';

const mockPrisma: any = {
  building: { findUnique: jest.fn(), update: jest.fn() },
  unit: { updateMany: jest.fn() },
  $transaction: jest.fn((cb: any) => cb(mockPrisma)),
};
const mockProjectPhase = { recompute: jest.fn() };
const mockStorage = { signedUrl: jest.fn() };

function makeService() {
  return new BuildingsService(mockPrisma as any, mockProjectPhase as any, mockStorage as any);
}

function stubBuilding(unitCount: number) {
  mockPrisma.building.findUnique.mockResolvedValue({
    id: 'b1',
    name: 'Building A',
    projectId: 'p1',
    coverPhotoPath: null,
    units: [],
    _count: { units: unitCount },
    project: { id: 'p1', name: 'P', slug: 'p' },
  });
}

describe('BuildingsService.delete', () => {
  let service: BuildingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.building.update.mockResolvedValue({ id: 'b1', deletedAt: new Date() });
    mockPrisma.unit.updateMany.mockResolvedValue({ count: 3 });
  });

  it('blocks deletion without force when units exist', async () => {
    stubBuilding(3);
    await expect(service.delete('b1', false)).rejects.toThrow(ConflictException);
    expect(mockPrisma.building.update).not.toHaveBeenCalled();
    expect(mockPrisma.unit.updateMany).not.toHaveBeenCalled();
  });

  it('soft-deletes a building with no units, never hard-deletes', async () => {
    stubBuilding(0);
    await service.delete('b1', false);
    expect(mockPrisma.building.delete).toBeUndefined(); // hard delete must not exist on this path
    expect(mockPrisma.unit.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.building.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(mockProjectPhase.recompute).toHaveBeenCalledWith('p1');
  });

  it('force=true soft-deletes the building AND archives its live units — never hard-deletes either', async () => {
    stubBuilding(3);
    const result = await service.delete('b1', true);
    expect(mockPrisma.unit.updateMany).toHaveBeenCalledWith({
      where: { buildingId: 'b1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(mockPrisma.building.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(result.deletedAt).toBeInstanceOf(Date);
  });

  it('units.updateMany and building.update are stamped with the same timestamp', async () => {
    stubBuilding(2);
    await service.delete('b1', true);
    const unitStamp = mockPrisma.unit.updateMany.mock.calls[0][0].data.deletedAt;
    const buildingStamp = mockPrisma.building.update.mock.calls[0][0].data.deletedAt;
    expect(unitStamp).toEqual(buildingStamp);
  });
});
