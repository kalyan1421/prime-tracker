import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomOptionsService } from './custom-options.service';

const mockPrisma: any = {
  customOption: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  unitConstructionStage: { updateMany: jest.fn() },
  constructionStageTemplateItem: { updateMany: jest.fn() },
  $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
};

const makeService = () => new CustomOptionsService(mockPrisma as any);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.customOption.update.mockImplementation(({ where, data }: any) => ({ id: where.id, ...data }));
});

/**
 * A construction stage's name lives in two places by design: the catalogue holds it, and
 * every stage row mirrors it so the rollup, the Site Tracker grid and the exports can keep
 * reading `label` without a join. A mirror that a rename does not reach is just two
 * spellings of one stage, which is the whole problem this feature exists to end.
 */
describe('CustomOptionsService.update — construction stage renames', () => {
  const stage = { id: 'o1', category: 'construction_stage', value: 'STORE_FRONT_GLASS', label: 'Store Front Glass' };

  it('pushes a new name onto the stages carrying it, and onto building templates', async () => {
    mockPrisma.customOption.findUnique.mockResolvedValue(stage);
    await makeService().update('o1', { label: 'Storefront Glazing' });

    expect(mockPrisma.unitConstructionStage.updateMany).toHaveBeenCalledWith({
      where: { stageValue: 'STORE_FRONT_GLASS' },
      data: { label: 'Storefront Glazing' },
    });
    expect(mockPrisma.constructionStageTemplateItem.updateMany).toHaveBeenCalledWith({
      where: { label: 'Store Front Glass' },
      data: { label: 'Storefront Glazing' },
    });
  });

  it('touches nothing when the label is unchanged, or when only the colour moved', async () => {
    mockPrisma.customOption.findUnique.mockResolvedValue(stage);
    await makeService().update('o1', { label: 'Store Front Glass' });
    await makeService().update('o1', { color: 'primary' });
    expect(mockPrisma.unitConstructionStage.updateMany).not.toHaveBeenCalled();
  });

  it('leaves other categories alone — only stages carry a mirrored label', async () => {
    mockPrisma.customOption.findUnique.mockResolvedValue({
      id: 'o2', category: 'lead_status', value: 'NEW', label: 'New',
    });
    await makeService().update('o2', { label: 'Fresh' });
    expect(mockPrisma.unitConstructionStage.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an option that does not exist', async () => {
    mockPrisma.customOption.findUnique.mockResolvedValue(null);
    await expect(makeService().update('ghost', { label: 'x' })).rejects.toThrow(NotFoundException);
  });
});

/**
 * Order is the work sequence for construction stages, so reordering is a real edit rather
 * than cosmetics — and it takes the whole list for the same reason reorderUnitStages does.
 */
describe('CustomOptionsService.reorder', () => {
  beforeEach(() => {
    mockPrisma.customOption.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  it('writes the given positions in one transaction', async () => {
    await makeService().reorder('construction_stage', ['c', 'a', 'b']);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.customOption.update.mock.calls.map((c: any[]) => c[0])).toEqual([
      { where: { id: 'c' }, data: { sortOrder: 0 } },
      { where: { id: 'a' }, data: { sortOrder: 1 } },
      { where: { id: 'b' }, data: { sortOrder: 2 } },
    ]);
  });

  it('refuses a partial list — it would have to invent positions for the rest', async () => {
    await expect(makeService().reorder('construction_stage', ['a', 'b']))
      .rejects.toThrow(/every option in this category exactly once/);
    expect(mockPrisma.customOption.update).not.toHaveBeenCalled();
  });

  it('refuses an option from another category, and a repeated one', async () => {
    await expect(makeService().reorder('construction_stage', ['a', 'b', 'zzz']))
      .rejects.toThrow(BadRequestException);
    await expect(makeService().reorder('construction_stage', ['a', 'a', 'b']))
      .rejects.toThrow(/more than once/);
    expect(mockPrisma.customOption.update).not.toHaveBeenCalled();
  });
});

/**
 * The category has to be listed even before anyone adds to it, or it cannot be found in
 * Admin to add to. It is registered as an EMPTY system-defaults key rather than a seeded
 * one: system options are synthesised on read and can never be renamed, reordered or
 * retired, which is the opposite of what a stage list needs.
 */
describe('CustomOptionsService — construction_stage registration', () => {
  it('is discoverable with no rows, and offers no frozen defaults', async () => {
    mockPrisma.customOption.findMany.mockResolvedValue([]);
    const service = makeService();

    expect(await service.findAllCategories()).toContain('construction_stage');
    expect(await service.findByCategory('construction_stage')).toEqual([]);
  });
});
