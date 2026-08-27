import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DailyLogsService } from './daily-logs.service';

const mockPrisma: any = {
  dailyLog: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  dailyLogPhoto: { create: jest.fn(), delete: jest.fn() },
  unit: { findUnique: jest.fn() },
  unitConstructionStage: { findUnique: jest.fn() },
};

const mockStorage: any = { signedUrl: jest.fn().mockResolvedValue('https://signed-url') };


function makeService() {
  return new DailyLogsService(mockPrisma as any, mockStorage);
}

describe('DailyLogsService', () => {
  let service: DailyLogsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  describe('findAll', () => {
    it('filters by project/building and orders most-recent first', async () => {
      mockPrisma.dailyLog.findMany.mockResolvedValue([]);
      await service.findAll({ projectId: 'p1', buildingId: 'b1' });
      const arg = mockPrisma.dailyLog.findMany.mock.calls[0][0];
      // toMatchObject, not toEqual: the where clause gained `parentId: null` when threading
      // landed (replies come back nested, not as separate rows), and pinning it exactly
      // makes this fail on every future filter without saying anything useful.
      expect(arg.where).toMatchObject({ projectId: 'p1', buildingId: 'b1' });
      expect(arg.where.parentId).toBeNull();
      expect(arg.orderBy[0]).toEqual({ logDate: 'desc' });
    });
  });

  describe('create', () => {
    it('requires notes', async () => {
      await expect(
        service.create({ projectId: 'p1', notes: '   ', authorId: 'u1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults logDate to now and stamps the author', async () => {
      mockPrisma.dailyLog.create.mockImplementation((a: any) => Promise.resolve(a.data));
      const res: any = await service.create({ projectId: 'p1', notes: 'Poured slab', authorId: 'u1', crewCount: 6, weather: 'Sunny' });
      expect(res.authorId).toBe('u1');
      expect(res.notes).toBe('Poured slab');
      expect(res.crewCount).toBe(6);
      expect(res.logDate).toBeInstanceOf(Date);
    });

    it('uses the provided logDate when given', async () => {
      mockPrisma.dailyLog.create.mockImplementation((a: any) => Promise.resolve(a.data));
      const res: any = await service.create({ projectId: 'p1', notes: 'x', authorId: 'u1', logDate: '2026-05-20' });
      expect(res.logDate.toISOString().slice(0, 10)).toBe('2026-05-20');
    });
  });

  describe('addPhoto', () => {
    it('throws NotFound when the log is missing', async () => {
      mockPrisma.dailyLog.findUnique.mockResolvedValue(null);
      await expect(service.addPhoto('nope', { storagePath: 'k' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('attaches a photo by storagePath', async () => {
      mockPrisma.dailyLog.findUnique.mockResolvedValue({ id: 'l1', photos: [] });
      mockPrisma.dailyLogPhoto.create.mockImplementation((a: any) => Promise.resolve(a.data));
      const res: any = await service.addPhoto('l1', { storagePath: 'logs/l1/p.jpg', caption: 'Footings' });
      expect(res).toEqual({ dailyLogId: 'l1', storagePath: 'logs/l1/p.jpg', caption: 'Footings' });
    });

    it('rejects an empty storagePath', async () => {
      mockPrisma.dailyLog.findUnique.mockResolvedValue({ id: 'l1', photos: [] });
      await expect(service.addPhoto('l1', { storagePath: '' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findById', () => {
    it('throws NotFound when missing', async () => {
      mockPrisma.dailyLog.findUnique.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('DailyLogsService — unit-level logs', () => {
  // `DailyLog.unitId` existed on the model from the start but nothing in this module ever
  // read or wrote it, so every log was building-level in practice and per-unit fit-out
  // progress had nowhere to go — exactly the gap the column was added for.
  const unit = (over: any = {}) => ({
    deletedAt: null, buildingId: 'b1', building: { projectId: 'p1' }, ...over,
  });

  beforeEach(() => {
    // The file's existing clearAllMocks lives inside another describe's beforeEach, so this
    // block does not inherit it — without this, call counts bleed between these tests.
    jest.clearAllMocks();
    mockPrisma.dailyLog.create.mockResolvedValue({ id: 'log1', unitId: 'u1' });
  });

  it('persists unitId on create', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue(unit());
    await makeService().create({ projectId: 'p1', unitId: 'u1', notes: 'Cabinets in.', authorId: 'a1' } as any);
    expect(mockPrisma.dailyLog.create.mock.calls[0][0].data).toMatchObject({ unitId: 'u1' });
  });

  it('derives the building from the unit rather than trusting the caller', async () => {
    // Otherwise a unit-level log can be filed under a building the unit is not in, and the
    // building's own log list quietly contains work from somewhere else.
    mockPrisma.unit.findUnique.mockResolvedValue(unit({ buildingId: 'real-building' }));
    await makeService().create({
      projectId: 'p1', unitId: 'u1', buildingId: 'wrong-building', notes: 'x', authorId: 'a1',
    } as any);
    expect(mockPrisma.dailyLog.create.mock.calls[0][0].data.buildingId).toBe('real-building');
  });

  it('rejects a unit that belongs to a different project', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue(unit({ building: { projectId: 'other' } }));
    await expect(makeService().create({
      projectId: 'p1', unitId: 'u1', notes: 'x', authorId: 'a1',
    } as any)).rejects.toThrow(BadRequestException);
    expect(mockPrisma.dailyLog.create).not.toHaveBeenCalled();
  });

  it('rejects a soft-deleted unit', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue(unit({ deletedAt: new Date() }));
    await expect(makeService().create({
      projectId: 'p1', unitId: 'u1', notes: 'x', authorId: 'a1',
    } as any)).rejects.toThrow(NotFoundException);
  });

  it('still allows a site-wide log with no unit', async () => {
    // Weather, crew count, a concrete pour — genuinely not about one unit.
    await makeService().create({ projectId: 'p1', notes: 'Concrete pour, 14 crew.', authorId: 'a1' } as any);
    expect(mockPrisma.unit.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.dailyLog.create.mock.calls[0][0].data.unitId).toBeNull();
  });

  it('accepts a unitId-only filter', async () => {
    mockPrisma.dailyLog.findMany.mockResolvedValue([]);
    await makeService().findAll({ unitId: 'u1' });
    expect(mockPrisma.dailyLog.findMany.mock.calls[0][0].where).toMatchObject({ unitId: 'u1' });
  });

  it('still requires at least one filter', async () => {
    await expect(makeService().findAll({})).rejects.toThrow(BadRequestException);
  });
});

describe('DailyLogsService — update provenance (source)', () => {
  const unit = { deletedAt: null, buildingId: 'b1', building: { projectId: 'p1' } };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.dailyLog.create.mockResolvedValue({ id: 'log1', unitId: 'u1' });
  });

  it('defaults to WEB', async () => {
    await makeService().create({ projectId: 'p1', notes: 'x', authorId: 'a1' } as any);
    expect(mockPrisma.dailyLog.create.mock.calls[0][0].data.source).toBe('WEB');
  });

  it('stamps whatever the caller of the SERVICE passes', async () => {
    // The parameter exists so a future ingestion path can stamp its own channel without the
    // value ever being client-supplied.
    await makeService().create({ projectId: 'p1', notes: 'x', authorId: 'a1' } as any, 'MOBILE');
    expect(mockPrisma.dailyLog.create.mock.calls[0][0].data.source).toBe('MOBILE');
  });

  it('IGNORES a source smuggled in through the request body', async () => {
    // The entire worth of an "arrived by email" badge is that it cannot be claimed. `source`
    // is a separate parameter, not a DTO field, so a body value has nowhere to land.
    await makeService().create({
      projectId: 'p1', notes: 'x', authorId: 'a1', source: 'MOBILE',
    } as any);
    expect(mockPrisma.dailyLog.create.mock.calls[0][0].data.source).toBe('WEB');
  });

  it('filters by source', async () => {
    mockPrisma.dailyLog.findMany.mockResolvedValue([]);
    await makeService().findAll({ projectId: 'p1', source: 'MOBILE' });
    expect(mockPrisma.dailyLog.findMany.mock.calls[0][0].where).toMatchObject({ source: 'MOBILE' });
  });

  it('rejects a channel that no longer exists', async () => {
    // Inbound email ingestion was removed; accepting the filter and returning nothing would
    // read as "no email updates" rather than "that channel is not wired".
    await expect(makeService().findAll({ projectId: 'p1', source: 'EMAIL' }))
      .rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown source filter rather than returning everything', async () => {
    // Passing it through would silently drop the filter and look like an empty result.
    await expect(makeService().findAll({ projectId: 'p1', source: 'CARRIER_PIGEON' }))
      .rejects.toThrow(BadRequestException);
  });

  it('leaves the filter off when no source is given', async () => {
    mockPrisma.dailyLog.findMany.mockResolvedValue([]);
    await makeService().findAll({ projectId: 'p1' });
    expect(mockPrisma.dailyLog.findMany.mock.calls[0][0].where.source).toBeUndefined();
  });
});

describe('DailyLogsService — threaded replies', () => {
  const parent = {
    id: 'p1', projectId: 'proj1', buildingId: 'b1', unitId: 'u1', parentId: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.dailyLog.create.mockResolvedValue({ id: 'log1', unitId: 'u1' });
  });

  it('a reply inherits its parent placement rather than declaring its own', async () => {
    // Otherwise a thread could have its answer filed against a different unit from the
    // question, and the two would never appear together again.
    mockPrisma.dailyLog.findUnique.mockResolvedValue(parent);
    await makeService().create({
      projectId: 'WRONG', unitId: 'WRONG-UNIT', parentId: 'p1', notes: 'Agreed.', authorId: 'a1',
    } as any);
    expect(mockPrisma.dailyLog.create.mock.calls[0][0].data).toMatchObject({
      projectId: 'proj1', buildingId: 'b1', unitId: 'u1', parentId: 'p1',
    });
  });

  it('refuses a reply to a reply — one level only', async () => {
    // Arbitrary nesting buys indentation and costs the ability to read a day at a glance,
    // and it would make the top-level list query recursive.
    mockPrisma.dailyLog.findUnique.mockResolvedValue({ ...parent, parentId: 'grandparent' });
    await expect(makeService().create({
      projectId: 'proj1', parentId: 'p1', notes: 'x', authorId: 'a1',
    } as any)).rejects.toThrow(BadRequestException);
  });

  it('404s when the update being replied to is gone', async () => {
    mockPrisma.dailyLog.findUnique.mockResolvedValue(null);
    await expect(makeService().create({
      projectId: 'proj1', parentId: 'ghost', notes: 'x', authorId: 'a1',
    } as any)).rejects.toThrow(NotFoundException);
  });

  it('lists only top-level updates, with replies nested', async () => {
    mockPrisma.dailyLog.findMany.mockResolvedValue([]);
    await makeService().findAll({ unitId: 'u1' });
    const args = mockPrisma.dailyLog.findMany.mock.calls[0][0];
    expect(args.where.parentId).toBeNull();
    expect(args.include.replies.orderBy).toEqual({ createdAt: 'asc' });
  });
});

describe('DailyLogsService — pinning an update to a stage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.dailyLog.create.mockResolvedValue({ id: 'log1', unitId: 'u1' });
    mockPrisma.unit.findUnique.mockResolvedValue({
      deletedAt: null, buildingId: 'b1', building: { projectId: 'p1' },
    });
  });

  it('pins when the stage belongs to the same unit', async () => {
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue({ unitId: 'u1' });
    await makeService().create({
      projectId: 'p1', unitId: 'u1', stageId: 's1', notes: 'x', authorId: 'a1',
    } as any);
    expect(mockPrisma.dailyLog.create.mock.calls[0][0].data.stageId).toBe('s1');
  });

  it("refuses a stage from a DIFFERENT unit", async () => {
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue({ unitId: 'someone-else' });
    await expect(makeService().create({
      projectId: 'p1', unitId: 'u1', stageId: 's1', notes: 'x', authorId: 'a1',
    } as any)).rejects.toThrow(BadRequestException);
    expect(mockPrisma.dailyLog.create).not.toHaveBeenCalled();
  });

  it('refuses a pin on a site-wide update with no unit', async () => {
    await expect(makeService().create({
      projectId: 'p1', stageId: 's1', notes: 'x', authorId: 'a1',
    } as any)).rejects.toThrow(/unit-level/i);
  });

  it('404s on an unknown stage', async () => {
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue(null);
    await expect(makeService().create({
      projectId: 'p1', unitId: 'u1', stageId: 'ghost', notes: 'x', authorId: 'a1',
    } as any)).rejects.toThrow(NotFoundException);
  });
});
