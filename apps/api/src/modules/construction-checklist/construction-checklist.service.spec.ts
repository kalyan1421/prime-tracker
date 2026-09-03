import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConstructionChecklistService } from './construction-checklist.service';

const mockPrisma: any = {
  building: { findUnique: jest.fn() },
  unit: { findUnique: jest.fn(), update: jest.fn() },
  constructionStageTemplateItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  checklistTemplate: { findUnique: jest.fn() },
  unitConstructionStagePhoto: {
    create: jest.fn(), findUnique: jest.fn(), delete: jest.fn(), count: jest.fn(),
  },
  dailyLog: { count: jest.fn() },
  customOption: { findMany: jest.fn() },
  unitConstructionStage: {
    groupBy: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
};

// applyTemplate now resolves a versioned work-type template FIRST. Default: none exists,
// so existing suites keep exercising the building-override path they were written for.

// Stages now come back with signed photo URLs.
const mockStorage: any = { signedUrl: jest.fn().mockResolvedValue('https://signed') };

const mockAccess = {
  isScoped: jest.fn(),
  accessibleProjectIds: jest.fn(),
};

function makeService() {
  return new ConstructionChecklistService(mockPrisma as any, mockAccess as any, mockStorage);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Stage names resolve against the construction_stage catalogue on every write path.
  // Empty by default: a label that matches nothing is ad-hoc, which is a supported state,
  // so tests that are not about the catalogue do not have to know it exists.
  mockPrisma.customOption.findMany.mockResolvedValue([]);
});

describe('ConstructionChecklistService — building template', () => {
  it('lists a template ordered by sortOrder', async () => {
    mockPrisma.constructionStageTemplateItem.findMany.mockResolvedValue([{ id: 't1' }]);
    const service = makeService();
    const result = await service.getTemplate('b1');
    expect(mockPrisma.constructionStageTemplateItem.findMany).toHaveBeenCalledWith({
      where: { buildingId: 'b1' },
      orderBy: { sortOrder: 'asc' },
    });
    expect(result).toEqual([{ id: 't1' }]);
  });

  it('appends a stage at sortOrder 0 when the template is empty', async () => {
    mockPrisma.building.findUnique.mockResolvedValue({ id: 'b1', deletedAt: null });
    mockPrisma.constructionStageTemplateItem.findFirst.mockResolvedValue(null);
    mockPrisma.constructionStageTemplateItem.create.mockImplementation(({ data }: any) => data);

    const service = makeService();
    const created = await service.addTemplateItem('b1', '  01 - Contracts  ', 'u1');

    expect(created.sortOrder).toBe(0);
    expect(created.label).toBe('01 - Contracts');
    expect(created.createdById).toBe('u1');
  });

  it('appends after the last existing sortOrder', async () => {
    mockPrisma.building.findUnique.mockResolvedValue({ id: 'b1', deletedAt: null });
    mockPrisma.constructionStageTemplateItem.findFirst.mockResolvedValue({ sortOrder: 4 });
    mockPrisma.constructionStageTemplateItem.create.mockImplementation(({ data }: any) => data);

    const service = makeService();
    const created = await service.addTemplateItem('b1', 'Final Inspection');
    expect(created.sortOrder).toBe(5);
  });

  it('refuses to add a stage to a building that does not exist', async () => {
    mockPrisma.building.findUnique.mockResolvedValue(null);
    const service = makeService();
    await expect(service.addTemplateItem('missing', 'x')).rejects.toThrow(NotFoundException);
  });

  it('deletes a template item without touching units (no cascade call here)', async () => {
    mockPrisma.constructionStageTemplateItem.findUnique.mockResolvedValue({ id: 't1' });
    mockPrisma.constructionStageTemplateItem.delete.mockResolvedValue({ id: 't1' });
    const service = makeService();
    await service.deleteTemplateItem('t1');
    expect(mockPrisma.constructionStageTemplateItem.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
  });

  it('404s deleting a template item that does not exist', async () => {
    mockPrisma.constructionStageTemplateItem.findUnique.mockResolvedValue(null);
    const service = makeService();
    await expect(service.deleteTemplateItem('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('ConstructionChecklistService.applyTemplate', () => {
  it('refuses when the unit already has stages — never duplicates or clobbers progress', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1', buildingId: 'b1', deletedAt: null });
    mockPrisma.unitConstructionStage.count.mockResolvedValue(3);

    const service = makeService();
    await expect(service.applyTemplate('u1')).rejects.toThrow(BadRequestException);
    expect(mockPrisma.unitConstructionStage.createMany).not.toHaveBeenCalled();
  });

  it('refuses when the building has no template to copy', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1', buildingId: 'b1', deletedAt: null });
    mockPrisma.unitConstructionStage.count.mockResolvedValue(0);
    mockPrisma.constructionStageTemplateItem.findMany.mockResolvedValue([]);

    const service = makeService();
    await expect(service.applyTemplate('u1')).rejects.toThrow(BadRequestException);
  });

  it('copies every template stage onto the unit, preserving sortOrder and label', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1', buildingId: 'b1', deletedAt: null });
    mockPrisma.unitConstructionStage.count.mockResolvedValue(0);
    mockPrisma.constructionStageTemplateItem.findMany.mockResolvedValue([
      { sortOrder: 0, label: '01 - Contracts' },
      { sortOrder: 1, label: '02 - Timeline Calendar' },
    ]);
    mockPrisma.unitConstructionStage.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([
      { id: 's1', label: '01 - Contracts', photos: [] },
      { id: 's2', label: '02 - Timeline Calendar', photos: [] },
    ]);

    const service = makeService();
    await service.applyTemplate('u1', 'u9');

    const { data } = mockPrisma.unitConstructionStage.createMany.mock.calls[0][0];
    expect(data).toEqual([
      { unitId: 'u1', sortOrder: 0, label: '01 - Contracts', stageValue: null, createdById: 'u9' },
      { unitId: 'u1', sortOrder: 1, label: '02 - Timeline Calendar', stageValue: null, createdById: 'u9' },
    ]);
  });

  it('404s applying a template to a unit that does not exist', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue(null);
    const service = makeService();
    await expect(service.applyTemplate('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('ConstructionChecklistService — per-unit ad-hoc stages', () => {
  it('adds a one-off stage independent of the template', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1', deletedAt: null });
    mockPrisma.unitConstructionStage.findFirst.mockResolvedValue({ sortOrder: 2 });
    mockPrisma.unitConstructionStage.create.mockImplementation(({ data }: any) => data);

    const service = makeService();
    const created = await service.addUnitStage('u1', { label: 'Extra: HOA walkthrough' }, 'u1');
    expect(created.sortOrder).toBe(3);
    expect(created.label).toBe('Extra: HOA walkthrough');
  });

  it('404s adding a stage to a unit that does not exist', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue(null);
    const service = makeService();
    await expect(service.addUnitStage('missing', { label: 'x' })).rejects.toThrow(NotFoundException);
  });
});

describe('ConstructionChecklistService.updateStage', () => {
  it('updates only the fields supplied, leaving the rest alone', async () => {
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue({ id: 's1' });
    mockPrisma.unitConstructionStage.update.mockImplementation(({ data }: any) => data);

    const service = makeService();
    const updated = await service.updateStage('s1', { status: 'DONE' });

    expect(mockPrisma.unitConstructionStage.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'DONE' },
      include: { owner: { select: { id: true, name: true, email: true } } },
    });
    expect(updated).toEqual({ status: 'DONE' });
  });

  it('accepts null to clear the owner or inspection fields', async () => {
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue({ id: 's1' });
    mockPrisma.unitConstructionStage.update.mockImplementation(({ data }: any) => data);

    const service = makeService();
    await service.updateStage('s1', { ownerId: null, inspectionStatus: null, inspectionDate: null });

    expect(mockPrisma.unitConstructionStage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ownerId: null, inspectionStatus: null, inspectionDate: null },
      }),
    );
  });

  it('parses inspectionDate into a Date', async () => {
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue({ id: 's1' });
    mockPrisma.unitConstructionStage.update.mockImplementation(({ data }: any) => data);

    const service = makeService();
    await service.updateStage('s1', { inspectionDate: '2026-09-01' });

    const { data } = mockPrisma.unitConstructionStage.update.mock.calls[0][0];
    expect(data.inspectionDate).toBeInstanceOf(Date);
  });

  it('404s updating a stage that does not exist', async () => {
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue(null);
    const service = makeService();
    await expect(service.updateStage('missing', { status: 'DONE' })).rejects.toThrow(NotFoundException);
  });
});

describe('ConstructionChecklistService.deleteStage', () => {
  it('404s deleting a stage that does not exist', async () => {
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue(null);
    const service = makeService();
    await expect(service.deleteStage('missing')).rejects.toThrow(NotFoundException);
  });

  it('deletes an existing stage', async () => {
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue({ id: 's1' });
    mockPrisma.unitConstructionStage.delete.mockResolvedValue({ id: 's1' });
    const service = makeService();
    await service.deleteStage('s1');
    expect(mockPrisma.unitConstructionStage.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
  });
});

describe('ConstructionChecklistService.getProjectRollup', () => {
  it('groups stages by unit and reports progress + the next incomplete stage', async () => {
    const unitA = { id: 'u1', unitNumber: '101', building: { id: 'b1', name: 'Building A' } };
    const unitB = { id: 'u2', unitNumber: '102', building: { id: 'b1', name: 'Building A' } };
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([
      { unitId: 'u1', sortOrder: 0, label: 'Contracts', status: 'DONE', unit: unitA },
      { unitId: 'u1', sortOrder: 1, label: 'Framing', status: 'IN_PROGRESS', unit: unitA },
      { unitId: 'u1', sortOrder: 2, label: 'Final Inspection', status: 'NOT_STARTED', unit: unitA },
      { unitId: 'u2', sortOrder: 0, label: 'Contracts', status: 'DONE', unit: unitB },
    ]);

    const service = makeService();
    const rollup = await service.getProjectRollup('p1');

    expect(rollup).toHaveLength(2);
    const u1 = rollup.find((r) => r.unit.id === 'u1')!;
    expect(u1.totalStages).toBe(3);
    expect(u1.doneStages).toBe(1);
    expect(u1.nextStage?.label).toBe('Framing');
    expect(u1.stages).toEqual([
      { id: undefined, label: 'Contracts', status: 'DONE' },
      { id: undefined, label: 'Framing', status: 'IN_PROGRESS' },
      { id: undefined, label: 'Final Inspection', status: 'NOT_STARTED' },
    ]);

    const u2 = rollup.find((r) => r.unit.id === 'u2')!;
    expect(u2.totalStages).toBe(1);
    expect(u2.doneStages).toBe(1);
    expect(u2.nextStage).toBeNull();
    expect(u2.stages).toEqual([{ id: undefined, label: 'Contracts', status: 'DONE' }]);
  });

  it('returns an empty list when no units in the project have a checklist', async () => {
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([]);
    const service = makeService();
    expect(await service.getProjectRollup('p1')).toEqual([]);
  });

  it('with no projectId, scopes a project-scoped role to their accessible projects', async () => {
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([]);
    mockAccess.isScoped.mockReturnValue(true);
    mockAccess.accessibleProjectIds.mockResolvedValue(['p1', 'p2']);
    const service = makeService();

    await service.getProjectRollup(undefined, 'user1', 'CONSTRUCTION');

    expect(mockAccess.accessibleProjectIds).toHaveBeenCalledWith('user1');
    expect(mockPrisma.unitConstructionStage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          unit: {
            building: { deletedAt: null, project: { deletedAt: null }, projectId: { in: ['p1', 'p2'] } },
            deletedAt: null,
          },
        },
      }),
    );
  });

  it('with no projectId, applies no project filter for an unscoped role', async () => {
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([]);
    mockAccess.isScoped.mockReturnValue(false);
    const service = makeService();

    await service.getProjectRollup(undefined, 'user1', 'FOUNDER');

    expect(mockAccess.accessibleProjectIds).not.toHaveBeenCalled();
    expect(mockPrisma.unitConstructionStage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          unit: { building: { deletedAt: null, project: { deletedAt: null } }, deletedAt: null },
        },
      }),
    );
  });

  it('excludes an archived project — deletedAt: null applies to the project, not just the building', async () => {
    // Found live: getProjectRollup filtered on the building/unit only, so an archived
    // project's checklist rows kept surfacing in ConstructionReportsPage for any unscoped
    // role, after Site Tracker and everything else had already stopped showing it.
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([]);
    mockAccess.isScoped.mockReturnValue(false);
    const service = makeService();

    await service.getProjectRollup('p1', 'user1', 'FOUNDER');

    expect(mockPrisma.unitConstructionStage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          unit: {
            building: { deletedAt: null, project: { deletedAt: null }, projectId: 'p1' },
            deletedAt: null,
          },
        },
      }),
    );
  });
});

describe('ConstructionChecklistService — stage photos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue({ id: 's1', unitId: 'u1' });
  });

  it('attaches a photo to a stage', async () => {
    await makeService().addStagePhoto('s1', 'p1/daily-logs/x.jpg', 'Rough electrical', 'user1');
    expect(mockPrisma.unitConstructionStagePhoto.create).toHaveBeenCalledWith({
      data: { stageId: 's1', storagePath: 'p1/daily-logs/x.jpg', caption: 'Rough electrical', uploadedById: 'user1' },
    });
  });

  it('404s on an unknown stage', async () => {
    mockPrisma.unitConstructionStage.findUnique.mockResolvedValue(null);
    await expect(makeService().addStagePhoto('ghost', 'a/b.jpg')).rejects.toThrow(NotFoundException);
  });

  it.each([
    ['an absolute path', '/etc/passwd'],
    ['a traversal', 'a/../../secret.jpg'],
    ['an external URL', 'https://evil.test/x.jpg'],
    ['an empty path', ''],
  ])('refuses %s', async (_label, path) => {
    // storagePath must be a relative bucket key from our own presign — same hardening as
    // DailyLogsService.addPhoto.
    await expect(makeService().addStagePhoto('s1', path)).rejects.toThrow(BadRequestException);
    expect(mockPrisma.unitConstructionStagePhoto.create).not.toHaveBeenCalled();
  });

  it('signs photo URLs when reading a unit\'s stages', async () => {
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([
      { id: 's1', label: '01 - Contracts', photos: [{ id: 'ph1', storagePath: 'a/b.jpg' }] },
    ]);
    const out = await makeService().getUnitStages('u1');
    expect(out[0].photos[0].url).toBe('https://signed');
  });

  it('survives a signing failure rather than blanking the whole checklist', async () => {
    mockStorage.signedUrl.mockRejectedValueOnce(new Error('S3 down'));
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([
      { id: 's1', label: '01 - Contracts', photos: [{ id: 'ph1', storagePath: 'a/b.jpg' }] },
    ]);
    const out = await makeService().getUnitStages('u1');
    expect(out[0].photos[0].url).toBe('');
    expect(out[0].label).toBe('01 - Contracts');
  });

  it('removes a photo', async () => {
    mockPrisma.unitConstructionStagePhoto.findUnique.mockResolvedValue({ id: 'ph1' });
    await makeService().removeStagePhoto('ph1');
    expect(mockPrisma.unitConstructionStagePhoto.delete).toHaveBeenCalledWith({ where: { id: 'ph1' } });
  });

  it('404s removing a photo that is not there', async () => {
    mockPrisma.unitConstructionStagePhoto.findUnique.mockResolvedValue(null);
    await expect(makeService().removeStagePhoto('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('ConstructionChecklistService.addUnitStage — full field set', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1', deletedAt: null });
    mockPrisma.unitConstructionStage.findFirst.mockResolvedValue({ sortOrder: 4 });
  });

  it('accepts owner, status, inspection and dates at creation', async () => {
    // A stage used to be created bare and then edited six more times.
    await makeService().addUnitStage('u1', {
      label: '19 - Plumbing Final', ownerId: 'user1', status: 'IN_PROGRESS',
      inspectionStatus: 'SCHEDULED', inspectionDate: '2026-09-01',
      startsOn: '2026-09-01', endsOn: '2026-09-03', notes: 'Booked',
    }, 'creator');
    const data = mockPrisma.unitConstructionStage.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      label: '19 - Plumbing Final', ownerId: 'user1', status: 'IN_PROGRESS',
      inspectionStatus: 'SCHEDULED', notes: 'Booked', createdById: 'creator',
    });
    expect(data.inspectionDate).toBeInstanceOf(Date);
    expect(data.startsOn).toBeInstanceOf(Date);
  });

  it('appends rather than inserting', async () => {
    // sortOrder IS the step order; renumbering to slot something mid-list would rewrite
    // every row on the unit.
    await makeService().addUnitStage('u1', { label: 'x' });
    expect(mockPrisma.unitConstructionStage.create.mock.calls[0][0].data.sortOrder).toBe(5);
  });

  it('refuses a blank label', async () => {
    await expect(makeService().addUnitStage('u1', { label: '   ' })).rejects.toThrow(BadRequestException);
  });

  it('leaves untouched fields alone rather than writing nulls over the defaults', async () => {
    await makeService().addUnitStage('u1', { label: 'x' });
    const data = mockPrisma.unitConstructionStage.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('inspectionDate');
  });
});


/**
 * Adding many stages in one request. The reason this exists rather than the frontend
 * looping the single-stage route: the API throttles at 10 requests/second, so a
 * seventeen-stage template sent as seventeen calls silently lands about half of them and
 * leaves a checklist that looks complete and is not.
 */
describe('ConstructionChecklistService.addUnitStages', () => {
  beforeEach(() => {
    mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1', deletedAt: null });
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([]);
    mockPrisma.unitConstructionStage.createMany.mockResolvedValue({ count: 0 });
  });

  it('appends in the order given, continuing from the last stage', async () => {
    mockPrisma.unitConstructionStage.findMany
      .mockResolvedValueOnce([{ label: 'Existing', sortOrder: 4 }])
      .mockResolvedValueOnce([]);
    const service = makeService();
    await service.addUnitStages('u1', ['Rebar', 'Columns', 'Roof'], 'user-1');

    expect(mockPrisma.unitConstructionStage.createMany).toHaveBeenCalledWith({
      data: [
        { unitId: 'u1', label: 'Rebar', stageValue: null, sortOrder: 5, createdById: 'user-1' },
        { unitId: 'u1', label: 'Columns', stageValue: null, sortOrder: 6, createdById: 'user-1' },
        { unitId: 'u1', label: 'Roof', stageValue: null, sortOrder: 7, createdById: 'user-1' },
      ],
    });
  });

  it('skips a label already on the unit rather than failing the whole batch', async () => {
    // Selecting one stage twice is a slip; losing the other sixteen over it is not a fix.
    mockPrisma.unitConstructionStage.findMany
      .mockResolvedValueOnce([{ label: '  rebar ', sortOrder: 0 }])
      .mockResolvedValueOnce([]);
    const service = makeService();
    const res = await service.addUnitStages('u1', ['Rebar', 'Columns'], 'user-1');

    expect(res.added).toBe(1);
    expect(res.skipped).toEqual(['Rebar']);
    expect(mockPrisma.unitConstructionStage.createMany.mock.calls[0][0].data)
      .toEqual([{ unitId: 'u1', label: 'Columns', stageValue: null, sortOrder: 1, createdById: 'user-1' }]);
  });

  it('collapses the same label repeated within one request', async () => {
    const service = makeService();
    const res = await service.addUnitStages('u1', ['Rebar', 'rebar'], 'user-1');
    expect(res.added).toBe(1);
    expect(res.skipped).toEqual(['rebar']);
  });

  it('refuses an empty selection and a unit that does not exist', async () => {
    const service = makeService();
    await expect(service.addUnitStages('u1', ['  ', ''], 'user-1'))
      .rejects.toThrow(BadRequestException);

    mockPrisma.unit.findUnique.mockResolvedValue(null);
    await expect(service.addUnitStages('nope', ['Rebar'], 'user-1'))
      .rejects.toThrow(NotFoundException);
  });

  it('writes nothing when every label is already there', async () => {
    mockPrisma.unitConstructionStage.findMany
      .mockResolvedValueOnce([{ label: 'Rebar', sortOrder: 0 }])
      .mockResolvedValueOnce([]);
    const service = makeService();
    const res = await service.addUnitStages('u1', ['Rebar'], 'user-1');
    expect(res.added).toBe(0);
    expect(mockPrisma.unitConstructionStage.createMany).not.toHaveBeenCalled();
  });
});

describe('ConstructionChecklistService.reorderUnitStages', () => {
  beforeEach(() => {
    mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1', deletedAt: null });
    mockPrisma.unitConstructionStage.update.mockImplementation((a: any) => a);
  });

  it('parks every stage out of range before settling it, so no two collide mid-move', async () => {
    mockPrisma.unitConstructionStage.findMany
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      .mockResolvedValueOnce([]);
    const service = makeService();
    await service.reorderUnitStages('u1', ['c', 'a', 'b'], 'user-1');

    const orders = mockPrisma.unitConstructionStage.update.mock.calls.map(
      ([arg]: any) => [arg.where.id, arg.data.sortOrder],
    );
    expect(orders).toEqual([
      ['c', -1], ['a', -2], ['b', -3],
      ['c', 0], ['a', 1], ['b', 2],
    ]);
  });

  it('refuses a partial list — it would have to invent positions for the rest', async () => {
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const service = makeService();
    await expect(service.reorderUnitStages('u1', ['a'], 'user-1'))
      .rejects.toThrow(/every stage on this unit exactly once/);
    expect(mockPrisma.unitConstructionStage.update).not.toHaveBeenCalled();
  });

  it('refuses a stage that is not on this unit, and a repeated one', async () => {
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const service = makeService();
    await expect(service.reorderUnitStages('u1', ['a', 'zzz'], 'user-1'))
      .rejects.toThrow(/every stage on this unit exactly once/);
    await expect(service.reorderUnitStages('u1', ['a', 'a'], 'user-1'))
      .rejects.toThrow(/more than once/);
  });
});

/**
 * NOT the picker any more. Stage names come from the construction_stage CustomOption
 * category; what this reports is the inverse — labels running on real units that the
 * active catalogue does not offer, so Admin can promote the useful ones and leave the
 * retired numbering schemes alone.
 */
describe('ConstructionChecklistService.getAdHocStages', () => {
  beforeEach(() => {
    mockAccess.isScoped.mockReturnValue(false);
    mockPrisma.customOption.findMany.mockResolvedValue([]);
    mockPrisma.unitConstructionStage.groupBy.mockResolvedValue([]);
  });

  it('omits a stage the catalogue already offers', async () => {
    mockPrisma.customOption.findMany.mockResolvedValue([{ value: 'SOIL_COMPACTION' }]);
    mockPrisma.unitConstructionStage.groupBy.mockResolvedValue([
      { label: 'Soil Compaction', stageValue: 'SOIL_COMPACTION', _count: { label: 9 } },
      { label: 'Temporary hoarding', stageValue: null, _count: { label: 2 } },
    ]);
    const service = makeService();
    const out = await service.getAdHocStages({ buildingId: 'b1' }, 'u1', 'FOUNDER');
    expect(out).toEqual([{ label: 'Temporary hoarding', usedOn: 2 }]);
  });

  it('reports a label linked to a RETIRED entry — deactivating does not unstick the rows', async () => {
    mockPrisma.customOption.findMany.mockResolvedValue([{ value: 'SOIL_COMPACTION' }]);
    mockPrisma.unitConstructionStage.groupBy.mockResolvedValue([
      { label: '01 - Permits', stageValue: '01_PERMITS', _count: { label: 3 } },
    ]);
    const service = makeService();
    const out = await service.getAdHocStages({}, 'u1', 'FOUNDER');
    expect(out).toEqual([{ label: '01 - Permits', usedOn: 3 }]);
  });

  it('collapses one wording to one row and sums its uses, commonest first', async () => {
    mockPrisma.unitConstructionStage.groupBy.mockResolvedValue([
      { label: 'Scaffolding', stageValue: null, _count: { label: 1 } },
      { label: '  scaffolding ', stageValue: 'SCAFFOLDING_OLD', _count: { label: 4 } },
      { label: 'Site hut', stageValue: null, _count: { label: 6 } },
    ]);
    const service = makeService();
    const out = await service.getAdHocStages({}, 'u1', 'FOUNDER');
    expect(out).toEqual([
      { label: 'Site hut', usedOn: 6 },
      { label: 'Scaffolding', usedOn: 5 },
    ]);
  });

  it('limits a scoped role to stage names from projects it can see', async () => {
    mockAccess.isScoped.mockReturnValue(true);
    mockAccess.accessibleProjectIds.mockResolvedValue(['p1', 'p2']);
    const service = makeService();
    await service.getAdHocStages({}, 'u1', 'CONSTRUCTION');

    expect(mockPrisma.unitConstructionStage.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          unit: {
            deletedAt: null,
            building: { deletedAt: null, project: { deletedAt: null }, projectId: { in: ['p1', 'p2'] } },
          },
        },
      }),
    );
  });

  it('does not resolve the membership set when one project was named', async () => {
    mockAccess.isScoped.mockReturnValue(true);
    const service = makeService();
    await service.getAdHocStages({ projectId: 'p9' }, 'u1', 'CONSTRUCTION');
    expect(mockAccess.accessibleProjectIds).not.toHaveBeenCalled();
    expect(mockPrisma.unitConstructionStage.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          unit: { deletedAt: null, building: { deletedAt: null, project: { deletedAt: null }, projectId: 'p9' } },
        },
      }),
    );
  });

  it('narrows to one building without dropping the project scope', async () => {
    mockAccess.isScoped.mockReturnValue(false);
    const service = makeService();
    await service.getAdHocStages({ buildingId: 'b7', projectId: 'p9' }, 'u1', 'FOUNDER');
    expect(mockPrisma.unitConstructionStage.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          unit: {
            deletedAt: null,
            building: { deletedAt: null, project: { deletedAt: null }, projectId: 'p9' },
            buildingId: 'b7',
          },
        },
      }),
    );
  });
});

/**
 * The catalogue link on the write paths. `stageValue` is what a stage is grouped and
 * reported by; `label` is only its wording, mirrored so a rename does not have to rewrite
 * the rollup, the grid and the exports.
 */
describe('ConstructionChecklistService — stage catalogue link', () => {
  beforeEach(() => {
    mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1', buildingId: 'b1', deletedAt: null });
    mockPrisma.unitConstructionStage.findMany.mockResolvedValue([]);
    mockPrisma.unitConstructionStage.findFirst.mockResolvedValue(null);
    mockPrisma.unitConstructionStage.create.mockResolvedValue({ id: 's1' });
    mockPrisma.unitConstructionStage.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.customOption.findMany.mockResolvedValue([
      { value: 'SLAB_POUR', label: 'Slab Pour' },
    ]);
  });

  it('stamps the catalogue value on a single added stage, matching case-insensitively', async () => {
    const service = makeService();
    await service.addUnitStage('u1', { label: '  slab pour ' }, 'user-1');
    expect(mockPrisma.unitConstructionStage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ label: 'slab pour', stageValue: 'SLAB_POUR' }),
      }),
    );
  });

  it('leaves a one-off stage unlinked rather than refusing it', async () => {
    const service = makeService();
    await service.addUnitStage('u1', { label: 'Temporary hoarding' }, 'user-1');
    expect(mockPrisma.unitConstructionStage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ label: 'Temporary hoarding', stageValue: null }),
      }),
    );
  });

  it('stamps each stage in a bulk add', async () => {
    const service = makeService();
    await service.addUnitStages('u1', ['Slab Pour', 'Something bespoke'], 'user-1');
    expect(mockPrisma.unitConstructionStage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ label: 'Slab Pour', stageValue: 'SLAB_POUR' }),
        expect.objectContaining({ label: 'Something bespoke', stageValue: null }),
      ],
    });
  });
});
