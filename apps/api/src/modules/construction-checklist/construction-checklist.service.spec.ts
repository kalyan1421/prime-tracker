import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConstructionChecklistService } from './construction-checklist.service';

const mockPrisma = {
  building: { findUnique: jest.fn() },
  unit: { findUnique: jest.fn() },
  constructionStageTemplateItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  unitConstructionStage: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

function makeService() {
  return new ConstructionChecklistService(mockPrisma as any);
}

beforeEach(() => {
  jest.clearAllMocks();
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
      { id: 's1', label: '01 - Contracts' },
      { id: 's2', label: '02 - Timeline Calendar' },
    ]);

    const service = makeService();
    await service.applyTemplate('u1', 'u9');

    const { data } = mockPrisma.unitConstructionStage.createMany.mock.calls[0][0];
    expect(data).toEqual([
      { unitId: 'u1', sortOrder: 0, label: '01 - Contracts', createdById: 'u9' },
      { unitId: 'u1', sortOrder: 1, label: '02 - Timeline Calendar', createdById: 'u9' },
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
    const created = await service.addUnitStage('u1', 'Extra: HOA walkthrough', 'u1');
    expect(created.sortOrder).toBe(3);
    expect(created.label).toBe('Extra: HOA walkthrough');
  });

  it('404s adding a stage to a unit that does not exist', async () => {
    mockPrisma.unit.findUnique.mockResolvedValue(null);
    const service = makeService();
    await expect(service.addUnitStage('missing', 'x')).rejects.toThrow(NotFoundException);
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
});
