import { ConflictException } from '@nestjs/common';
import { BuildingsService } from './buildings.service';

const mockPrisma: any = {
  building: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  project: { findUnique: jest.fn() },
  unit: { findMany: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn((cb: any) => cb(mockPrisma)),
};
const mockProjectPhase = { recompute: jest.fn() };
const mockStorage = { signedUrl: jest.fn() };

function makeService() {
  return new BuildingsService(mockPrisma as any, mockProjectPhase as any, mockStorage as any);
}

/** Direct (building-level) relation counts — the shape `_count` returns on a read. */
function directCounts(o: Partial<{ units: number; leases: number; sales: number; loans: number }> = {}) {
  return { units: o.units ?? 0, leases: o.leases ?? 0, sales: o.sales ?? 0, loans: o.loans ?? 0 };
}

/** One row per LIVE unit, as nestedCounts()'s query returns them. */
function stubUnits(rows: Array<Partial<{ leases: number; sales: number; loans: number }>>, buildingId = 'b1') {
  mockPrisma.unit.findMany.mockResolvedValue(
    rows.map((r) => ({
      buildingId,
      _count: { leases: r.leases ?? 0, sales: r.sales ?? 0, loans: r.loans ?? 0 },
    })),
  );
}

function stubBuilding(unitCount: number, direct: Parameters<typeof directCounts>[0] = {}) {
  mockPrisma.building.findUnique.mockResolvedValue({
    id: 'b1',
    name: 'Building A',
    projectId: 'p1',
    coverPhotoPath: null,
    units: [],
    _count: directCounts({ ...direct, units: unitCount }),
    project: { id: 'p1', name: 'P', slug: 'p' },
  });
}

describe('BuildingsService blast radius', () => {
  let service: BuildingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1' });
  });

  // The whole point of the nested count: leases/sales/loans mostly hang off UNITS, and
  // Prisma's `_count` cannot see two levels down. A building with no direct attachments
  // is not empty if its units are carrying leases.
  it('rolls up records attached to the building’s units', async () => {
    mockPrisma.building.findMany.mockResolvedValue([
      { id: 'b1', name: 'Building A', coverPhotoPath: null, _count: directCounts({ units: 2 }) },
    ]);
    stubUnits([{ leases: 1, sales: 1 }, { leases: 2, loans: 1 }]);

    const [b]: any = await service.findByProject('p1');
    expect(b.blastRadius).toEqual({ units: 2, leases: 3, sales: 1, loans: 1 });
  });

  it('adds records attached to the building directly to the ones under its units', async () => {
    mockPrisma.building.findMany.mockResolvedValue([
      {
        id: 'b1',
        name: 'Building A',
        coverPhotoPath: null,
        // Whole-building lease + a building-level loan, on top of the unit-level rows.
        _count: directCounts({ units: 1, leases: 1, loans: 2 }),
      },
    ]);
    stubUnits([{ leases: 4, sales: 3 }]);

    const [b]: any = await service.findByProject('p1');
    expect(b.blastRadius).toEqual({ units: 1, leases: 5, sales: 3, loans: 2 });
  });

  // Soft-deleted units never come back from nestedCounts()'s query, so neither do the
  // rows hanging off them — archiving the building hides nothing that is already hidden.
  it('excludes soft-deleted units (and therefore their children) from the radius', async () => {
    mockPrisma.building.findMany.mockResolvedValue([
      { id: 'b1', name: 'Building A', coverPhotoPath: null, _count: directCounts({ units: 3 }) },
    ]);
    stubUnits([{ leases: 1 }]); // 3 unit rows exist; only 1 is live

    const [b]: any = await service.findByProject('p1');
    expect(mockPrisma.unit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buildingId: { in: ['b1'] }, deletedAt: null } }),
    );
    expect(b.blastRadius.units).toBe(1);
    expect(b.blastRadius.leases).toBe(1);
  });

  it('counts only non-deleted children of live units', async () => {
    mockPrisma.building.findMany.mockResolvedValue([
      { id: 'b1', name: 'Building A', coverPhotoPath: null, _count: directCounts({ units: 1 }) },
    ]);
    stubUnits([{ leases: 0, sales: 0, loans: 0 }]);

    await service.findByProject('p1');
    const select = mockPrisma.unit.findMany.mock.calls[0][0].select._count.select;
    expect(select).toEqual({
      leases: { where: { deletedAt: null } },
      sales: { where: { deletedAt: null } },
      loans: { where: { deletedAt: null } },
    });
  });

  // findByProject is a list endpoint — one aggregate for the whole page, never per row.
  it('resolves the nested half of a whole list in a single query', async () => {
    mockPrisma.building.findMany.mockResolvedValue([
      { id: 'b1', name: 'A', coverPhotoPath: null, _count: directCounts({ units: 1 }) },
      { id: 'b2', name: 'B', coverPhotoPath: null, _count: directCounts({ units: 1 }) },
      { id: 'b3', name: 'C', coverPhotoPath: null, _count: directCounts({ units: 1 }) },
    ]);
    mockPrisma.unit.findMany.mockResolvedValue([
      { buildingId: 'b1', _count: { leases: 1, sales: 0, loans: 0 } },
      { buildingId: 'b3', _count: { leases: 0, sales: 2, loans: 0 } },
    ]);

    const rows: any = await service.findByProject('p1');
    expect(mockPrisma.unit.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.unit.findMany.mock.calls[0][0].where.buildingId).toEqual({ in: ['b1', 'b2', 'b3'] });
    expect(rows.map((r: any) => r.blastRadius)).toEqual([
      { units: 1, leases: 1, sales: 0, loans: 0 },
      { units: 0, leases: 0, sales: 0, loans: 0 }, // b2 has no live units
      { units: 1, leases: 0, sales: 2, loans: 0 },
    ]);
  });

  it('findById returns the same blastRadius shape', async () => {
    stubBuilding(1, { sales: 1 });
    stubUnits([{ loans: 2 }]);

    const b: any = await service.findById('b1');
    expect(b.blastRadius).toEqual({ units: 1, leases: 0, sales: 1, loans: 2 });
  });
});

describe('BuildingsService.delete', () => {
  let service: BuildingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.building.update.mockResolvedValue({ id: 'b1', deletedAt: new Date() });
    mockPrisma.unit.updateMany.mockResolvedValue({ count: 3 });
    stubUnits([]);
  });

  // Client decision 2026-08-14: the confirmation must show the FULL blast radius. A
  // message that names only units hides the leases, sales and loans going dark with them.
  it('names every non-zero category in the conflict message', async () => {
    stubBuilding(2, { leases: 1 });
    stubUnits([{ leases: 1, sales: 1, loans: 1 }, { loans: 2 }]);

    await expect(service.delete('b1', false)).rejects.toThrow(
      /has 2 units, 2 leases, 1 sale and 3 loans attached/,
    );
  });

  it('omits zero categories and keeps the history-is-kept reassurance and ?force=true hint', async () => {
    stubBuilding(3);
    stubUnits([{}, {}, {}]);

    await expect(service.delete('b1', false)).rejects.toThrow(
      /Building 'Building A' has 3 units attached\. Delete the units first, or pass \?force=true .*history is kept, not deleted/s,
    );
  });

  it('falls back to naming archived units when nothing live is left under the building', async () => {
    stubBuilding(2); // 2 unit rows exist, both already soft-deleted
    stubUnits([]);

    await expect(service.delete('b1', false)).rejects.toThrow(/has 2 archived units attached/);
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
