import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UnitsService } from './units.service';

const mockPrisma: any = {
  unit: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  building: { findUnique: jest.fn() },
  user: { findMany: jest.fn() },
  customOption: { findFirst: jest.fn() },
  unitAssignee: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
  // combine()/create() pass a callback; setAssignees() passes an ARRAY of operations.
  $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
};

// Only the categories the Site Tracker validates against — the real service holds many more.
const mockCustomOptions = {
  getSystemDefaults: () => ({
    site_priority: [{ value: 'LOW' }, { value: 'MEDIUM' }, { value: 'HIGH' }],
  }),
};

// Pass-through EncryptionService double: these suites mock Prisma, so rows already
// carry plaintext. Real crypto is covered in common/encryption/encryption.service.spec.ts.
const mockEncryption = {
  decryptLoan: (l: any) => l,
  decryptLoans: (l: any[]) => l ?? [],
  encryptFields: (o: any, fields: string[]) => {
    const out: any = { ...o };
    for (const f of fields) out[f] = null;
    return { ...out, encryptedFields: 'enc' };
  },
  decryptFields: (o: any) => o,
};

// combine()/create() stamp opening/closing occupancy events via this service — a spy
// is enough here since these suites assert the unit-level effects, not the log itself.
const mockStatusEvents = { record: jest.fn(), recordIfChanged: jest.fn() };

function makeService() {
  // ProjectAccessService stub: no scoping in unit tests (undefined = unrestricted).
  return new UnitsService(
    mockPrisma as any,
    { listProjectScope: async () => undefined } as any,
    mockEncryption as any,
    mockStatusEvents as any,
    mockCustomOptions as any,
  );
}

const PM: UserRole = 'PROJECT_MANAGER';

const srcUnits = [
  { id: 'u1', buildingId: 'b1', unitType: 'RETAIL', unitNumber: '101', sqft: 1000, floorArea: null, mezzanineArea: null, primeOwned: true, status: 'AVAILABLE', _count: { sales: 0, leases: 0, interiorProjects: 0 } },
  { id: 'u2', buildingId: 'b1', unitType: 'RETAIL', unitNumber: '102', sqft: 500, floorArea: null, mezzanineArea: null, primeOwned: true, status: 'AVAILABLE', _count: { sales: 0, leases: 0, interiorProjects: 0 } },
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
      { ...srcUnits[1], _count: { sales: 1, leases: 0, interiorProjects: 0 } },
    ]);
    await expect(
      service.combine({ buildingId: 'b1', sourceUnitIds: ['u1', 'u2'], unitNumber: '101+102' }, PM),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.unit.create).not.toHaveBeenCalled();
  });

  it('rejects a combined number that clashes with an existing unit', async () => {
    mockPrisma.unit.findMany.mockResolvedValue(srcUnits);
    mockPrisma.unit.findFirst.mockResolvedValue({ id: 'u1' }); // number already taken
    await expect(
      service.combine({ buildingId: 'b1', sourceUnitIds: ['u1', 'u2'], unitNumber: '101' }, PM),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates the combined unit (summed area) and soft-archives the sources', async () => {
    mockPrisma.unit.findMany.mockResolvedValue(srcUnits);
    mockPrisma.unit.findFirst.mockResolvedValue(null);
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
    // Opening event on the combined unit + a closing event per archived source.
    expect(mockStatusEvents.record).toHaveBeenCalledTimes(3);
  });
});

describe('UnitsService.create', () => {
  let service: UnitsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.building.findUnique.mockResolvedValue({ id: 'b1', project: { status: 'ACTIVE' } });
  });

  it('rejects a unit number that clashes with a live unit', async () => {
    mockPrisma.unit.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(
      service.create({ buildingId: 'b1', unitNumber: '504', unitType: 'RETAIL' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.unit.create).not.toHaveBeenCalled();
  });

  it('refuses a unit number that differs from an existing one only in capitalisation', async () => {
    mockPrisma.building.findUnique.mockResolvedValue({ id: 'b1', project: { status: 'ACTIVE' } });
    mockPrisma.unit.findFirst.mockResolvedValue({ unitNumber: 'E2' });
    await expect(
      service.create({ buildingId: 'b1', unitNumber: 'e2', unitType: 'RETAIL' } as any),
    ).rejects.toThrow(/differs only in capitalisation/);
  });

  it('allows reusing a unit number that only exists on a soft-deleted (e.g. merged-away) unit', async () => {
    // The uniqueness lookup filters deletedAt: null, so an archived '504' must not surface here.
    mockPrisma.unit.findFirst.mockResolvedValue(null);
    mockPrisma.unit.create.mockResolvedValue({ id: 'new', buildingId: 'b1', unitNumber: '504' });

    const res: any = await service.create({ buildingId: 'b1', unitNumber: '504', unitType: 'RETAIL' });

    expect(res.id).toBe('new');
    // Case-insensitive since 2026-08-25: "E2" and "e2" were two units for one space.
    // The soft-delete filter is what this test is actually about and is unchanged.
    expect(mockPrisma.unit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          buildingId: 'b1',
          unitNumber: { equals: '504', mode: 'insensitive' },
          deletedAt: null,
        },
      }),
    );
  });
});

function stubUnitForDelete(overrides: Partial<{ leases: number; sales: number; loans: number; deletedAt: Date | null }> = {}) {
  mockPrisma.unit.findUnique.mockResolvedValue({
    id: 'unit-1',
    unitNumber: '101',
    deletedAt: overrides.deletedAt ?? null,
    building: { id: 'b1', name: 'Building A', deletedAt: null, project: { id: 'p1', name: 'P', status: 'ACTIVE', deletedAt: null } },
    leases: [],
    sales: [],
    loans: [],
    mergedFrom: [],
    _count: {
      comments: 0,
      sales: overrides.sales ?? 0,
      leases: overrides.leases ?? 0,
      loans: overrides.loans ?? 0,
    },
  });
}

describe('UnitsService.findInventory', () => {
  let service: UnitsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.unit.findMany.mockResolvedValue([]);
  });

  const whereOf = () => mockPrisma.unit.findMany.mock.calls[0][0].where;

  // Archiving a project soft-deletes the PROJECT only — never its buildings or units.
  // findById rejects a unit whose parent chain is deleted; findInventory did not, so the
  // cross-project list handed back 40 units from an archived project and every one of
  // them 404'd on click.
  it('excludes units whose building or project is soft-deleted', async () => {
    await service.findInventory({});

    expect(whereOf()).toMatchObject({
      deletedAt: null,
      building: { deletedAt: null, project: { deletedAt: null } },
    });
  });

  it('keeps the parent-chain filter when filtering to one project', async () => {
    await service.findInventory({ projectId: 'p1' });

    // projectId MERGED in, not assigned over — the branch used to replace the whole
    // `building` clause and would have dropped the deletedAt filters on the floor.
    expect(whereOf().building).toEqual({
      deletedAt: null,
      project: { deletedAt: null },
      projectId: 'p1',
    });
  });

  it('keeps the parent-chain filter alongside viewer project scoping', async () => {
    const scoped = new UnitsService(
      mockPrisma as any,
      { listProjectScope: async () => ['p1', 'p2'] } as any,
      mockEncryption as any,
      mockStatusEvents as any,
      mockCustomOptions as any,
    );

    await scoped.findInventory({ viewer: { userId: 'u1', role: 'SALES' } });

    // The other branch that assigned over `building` — scoping and the chain filter
    // must both survive, or a restricted user either sees everything or sees nothing.
    expect(whereOf().building).toEqual({
      deletedAt: null,
      project: { deletedAt: null },
      projectId: { in: ['p1', 'p2'] },
    });
  });
});

describe('UnitsService.delete', () => {
  let service: UnitsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('SALES role is forbidden from deleting a unit', async () => {
    await expect(service.delete('unit-1', 'SALES' as any, false)).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.unit.findUnique).not.toHaveBeenCalled();
  });

  it('blocks deletion without force when leases/sales are attached', async () => {
    stubUnitForDelete({ leases: 1, sales: 2 });
    await expect(service.delete('unit-1', 'FOUNDER' as any, false)).rejects.toThrow(ConflictException);
    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
  });

  it('soft-deletes (never hard-deletes) a unit with no history, even without force', async () => {
    stubUnitForDelete();
    mockPrisma.unit.update.mockResolvedValue({ id: 'unit-1', deletedAt: new Date() });
    await service.delete('unit-1', 'FOUNDER' as any, false);
    expect(mockPrisma.unit.delete).toBeUndefined(); // never even wired up — hard delete must not exist on this path
    expect(mockPrisma.unit.update).toHaveBeenCalledWith({
      where: { id: 'unit-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  // Client decision 2026-08-14: the confirmation must show the full blast radius. Loans
  // attach to a unit too, and were the one category the message never mentioned.
  it('names loans alongside leases and sales in the conflict message', async () => {
    stubUnitForDelete({ leases: 2, sales: 1, loans: 3 });
    await expect(service.delete('unit-1', 'FOUNDER' as any, false)).rejects.toThrow(
      /Unit '101' has 2 leases, 1 sale and 3 loans attached/,
    );
  });

  it('keeps the ?force=true affordance and the history-is-kept reassurance', async () => {
    stubUnitForDelete({ leases: 1 });
    await expect(service.delete('unit-1', 'FOUNDER' as any, false)).rejects.toThrow(
      /has 1 lease attached\. Pass \?force=true .*history is kept, not deleted/s,
    );
  });

  // The guard is unchanged — a loan alone has never blocked a unit archive, and this
  // change only alters what gets REPORTED.
  it('a loan on its own does not block the archive', async () => {
    stubUnitForDelete({ loans: 4 });
    mockPrisma.unit.update.mockResolvedValue({ id: 'unit-1', deletedAt: new Date() });
    await expect(service.delete('unit-1', 'FOUNDER' as any, false)).resolves.toBeDefined();
  });

  it('selects only non-deleted loans for the count', async () => {
    stubUnitForDelete();
    mockPrisma.unit.update.mockResolvedValue({ id: 'unit-1', deletedAt: new Date() });
    await service.delete('unit-1', 'FOUNDER' as any, false);
    const countSelect = mockPrisma.unit.findUnique.mock.calls[0][0].include._count.select;
    expect(countSelect.loans).toEqual({ where: { deletedAt: null } });
  });

  it('force=true bypasses the history guard but still only soft-deletes — history rows are never touched', async () => {
    stubUnitForDelete({ leases: 1, sales: 2 });
    mockPrisma.unit.update.mockResolvedValue({ id: 'unit-1', deletedAt: new Date() });
    const result = await service.delete('unit-1', 'FOUNDER' as any, true);
    expect(mockPrisma.unit.update).toHaveBeenCalledWith({
      where: { id: 'unit-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(result.deletedAt).toBeInstanceOf(Date);
  });
});

/**
 * The build/commercial split behind `unit:editBuild`.
 *
 * PUT /units/:id is gated on the wider `unit:editBuild` so CONSTRUCTION can reach it at
 * all; the real restriction is here, and these tests are what keep the route gate and
 * the field allowlist from drifting apart — widening one without the other silently
 * hands the site team the asking price.
 */
describe('UnitsService.update — unit:editBuild field allowlist', () => {
  let service: UnitsService;
  const CONSTRUCTION_PERMS = ['unit:view', 'unit:editBuild', 'checklist:edit'];
  const PM_PERMS = ['unit:view', 'unit:edit', 'unit:editBuild'];

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.unit.findUnique.mockResolvedValue({
      id: 'u1', buildingId: 'b1', unitNumber: '101', status: 'AVAILABLE',
      askingPrice: 480000, askingRent: 3200, deletedAt: null,
      _count: { sales: 0, leases: 0, interiorProjects: 0 },
    });
    mockPrisma.unit.findFirst.mockResolvedValue(null);
    mockPrisma.unit.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'u1', ...data }));
  });

  it.each(['askingPrice', 'askingRent', 'status', 'primeOwned'])(
    'refuses %s without unit:edit', async (field) => {
      const input: any = { [field]: field === 'status' ? 'SOLD' : field === 'primeOwned' ? true : 1 };
      await expect(
        service.update('u1', input, 'CONSTRUCTION' as UserRole, 'user-1', CONSTRUCTION_PERMS),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.unit.update).not.toHaveBeenCalled();
    },
  );

  it('names the offending fields so the caller knows what was refused', async () => {
    await expect(
      service.update('u1', { askingPrice: 1, askingRent: 2 } as any, 'CONSTRUCTION' as UserRole, 'user-1', CONSTRUCTION_PERMS),
    ).rejects.toThrow(/askingPrice, askingRent/);
  });

  it.each(['unitNumber', 'unitType', 'sqft', 'notes'])(
    'allows %s without unit:edit', async (field) => {
      const input: any = { [field]: field === 'sqft' ? 1200 : 'x' };
      await expect(
        service.update('u1', input, 'CONSTRUCTION' as UserRole, 'user-1', CONSTRUCTION_PERMS),
      ).resolves.toBeDefined();
    },
  );

  it('leaves the commercial fields untouched — omission is not a wipe', async () => {
    await service.update('u1', { sqft: 1250 } as any, 'CONSTRUCTION' as UserRole, 'user-1', CONSTRUCTION_PERMS);
    const written = mockPrisma.unit.update.mock.calls[0][0].data;
    expect(written).not.toHaveProperty('askingPrice');
    expect(written).not.toHaveProperty('askingRent');
    expect(written).not.toHaveProperty('status');
  });

  it('still lets a holder of unit:edit set the commercial fields', async () => {
    await expect(
      service.update('u1', { askingPrice: 500000 } as any, PM, 'user-1', PM_PERMS),
    ).resolves.toBeDefined();
  });

  it('does not weaken the pre-existing SALES restriction', async () => {
    // SALES holds unit:edit, so it clears the allowlist above and must still hit its own,
    // narrower rule — status and notes only.
    await expect(
      service.update('u1', { askingPrice: 1 } as any, 'SALES' as UserRole, 'user-1', ['unit:edit', 'unit:editBuild']),
    ).rejects.toThrow(/Sales role can only update unit status and notes/);
  });

  it('applies no field restriction to internal callers that pass no permissions', async () => {
    // Back-compat: update() has callers that supply their own field set and no viewer.
    await expect(
      service.update('u1', { askingPrice: 1 } as any, PM, 'user-1'),
    ).resolves.toBeDefined();
  });
});
