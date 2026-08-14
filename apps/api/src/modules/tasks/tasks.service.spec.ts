import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TasksService } from './tasks.service';

/**
 * TasksService had no spec file at all before Phase 2 — the only module its size
 * without one. These cover the behaviour the construction board depends on:
 * multi-unit items, the legacy scalar staying a truthful mirror, and the fact that
 * assigning work now actually reaches someone.
 */

const mockPrisma: any = {
  task: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  taskUnit: { deleteMany: jest.fn(), createMany: jest.fn() },
  // Multi-building and multi-person links (2026-08-14). `findMany` on taskAssignment is
  // what notifyAssigned reads to decide who has NOT been told yet.
  taskBuilding: { deleteMany: jest.fn(), createMany: jest.fn() },
  taskAssignment: {
    deleteMany: jest.fn(), createMany: jest.fn(), updateMany: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  building: { findMany: jest.fn() },
  taskUpdate: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
  taskComment: { create: jest.fn() },
  unit: { findMany: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(),
};

const mockNotifications: any = { send: jest.fn() };

// Photos are bucket keys; the service swaps them for signed URLs before returning.
const mockStorage: any = { signedUrl: jest.fn().mockResolvedValue('https://signed/x.jpg') };

function makeService() {
  return new TasksService(mockPrisma as any, mockNotifications as any, mockStorage as any);
}

const TASK = {
  id: 't1',
  projectId: 'p1',
  buildingId: 'b1',
  title: 'Interior finishout',
  createdBy: 'user-1',
  assignedTo: null,
  kind: 'CONSTRUCTION',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
  mockPrisma.task.findUnique.mockResolvedValue(TASK);
  mockPrisma.task.create.mockImplementation(({ data }: any) => Promise.resolve({ ...TASK, ...data }));
  mockPrisma.task.update.mockImplementation(({ data }: any) => Promise.resolve({ ...TASK, ...data }));
  // Echo whatever ids are asked for: resolveAssigneeIds validates that every person
  // exists, so a blanket [] would make every tagging test fail as "does not exist". The
  // @mention tests override this with named users.
  mockPrisma.user.findMany.mockImplementation(({ where }: any) =>
    Promise.resolve((where?.id?.in ?? []).map((id: string) => ({ id }))));
  mockPrisma.user.findUnique.mockResolvedValue({ name: 'Priya' });
  mockPrisma.building.findMany.mockImplementation(({ where }: any) =>
    Promise.resolve((where?.id?.in ?? []).map((id: string) => ({ id }))));
  // notifyAssigned asks "which of these people has NOT been told yet". The realistic
  // default is "all of them" — the rows were just created, so notifiedAt is null. Tests
  // about the re-notify guard override this with an empty result.
  mockPrisma.taskAssignment.findMany.mockImplementation(({ where }: any) =>
    Promise.resolve((where?.userId?.in ?? []).map((userId: string) => ({ userId }))));
});

describe('TasksService — multi-unit items', () => {
  it('links every unit on the item, which a scalar unitId could never express', async () => {
    // "UNITS 402,403,404" on the client's board is ONE item over three units that each
    // keep their own lease and rent history.
    mockPrisma.unit.findMany.mockResolvedValue([
      { id: 'u1', buildingId: 'b1' }, { id: 'u2', buildingId: 'b1' }, { id: 'u3', buildingId: 'b1' },
    ]);

    await makeService().create(
      { projectId: 'p1', buildingId: 'b1', title: 'Interior finishout', unitIds: ['u1', 'u2', 'u3'] },
      'user-1',
    );

    const data = mockPrisma.task.create.mock.calls[0][0].data;
    expect(data.units.create).toEqual([{ unitId: 'u1' }, { unitId: 'u2' }, { unitId: 'u3' }]);
  });

  it('leaves the legacy scalar NULL on a multi-unit item rather than picking a winner', async () => {
    // A silently-chosen "primary" unit is what makes a mirror start lying.
    mockPrisma.unit.findMany.mockResolvedValue([
      { id: 'u1', buildingId: 'b1' }, { id: 'u2', buildingId: 'b1' },
    ]);

    await makeService().create(
      { projectId: 'p1', title: 'Permit', unitIds: ['u1', 'u2'] },
      'user-1',
    );

    expect(mockPrisma.task.create.mock.calls[0][0].data.unitId).toBeNull();
  });

  it('mirrors the scalar when the item covers exactly one unit', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([{ id: 'u1', buildingId: 'b1' }]);

    await makeService().create({ projectId: 'p1', title: 'Snag', unitIds: ['u1'] }, 'user-1');

    expect(mockPrisma.task.create.mock.calls[0][0].data.unitId).toBe('u1');
  });

  it('accepts the legacy single unitId and still writes the join row', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([{ id: 'u1', buildingId: 'b1' }]);

    await makeService().create({ projectId: 'p1', title: 'Snag', unitId: 'u1' }, 'user-1');

    const data = mockPrisma.task.create.mock.calls[0][0].data;
    expect(data.units.create).toEqual([{ unitId: 'u1' }]);
    expect(data.unitId).toBe('u1');
  });

  it('ALLOWS units from two different buildings, and covers both', async () => {
    // The one-item-one-building rule was an assumption, not a requirement, and the client
    // removed it on 2026-08-14: one contractor doing the same job across B1 and B2 is one
    // item, not two. Both buildings are linked so the board shows it under each.
    mockPrisma.unit.findMany.mockResolvedValue([
      { id: 'u1', buildingId: 'b1' }, { id: 'u2', buildingId: 'b2' },
    ]);

    await makeService().create({ projectId: 'p1', title: 'x', unitIds: ['u1', 'u2'] }, 'user-1');

    const data = mockPrisma.task.create.mock.calls[0][0].data;
    expect(data.buildings.create).toEqual([{ buildingId: 'b1' }, { buildingId: 'b2' }]);
    // …and the scalar stays null rather than picking one of them.
    expect(data.buildingId).toBeNull();
  });

  it('refuses a unit that does not exist rather than silently dropping it', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([{ id: 'u1', buildingId: 'b1' }]);

    await expect(
      makeService().create({ projectId: 'p1', title: 'x', unitIds: ['u1', 'ghost'] }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does NOT touch the unit links when an edit does not mention units', async () => {
    // Otherwise renaming an item would strip a three-unit link back to nothing.
    await makeService().update('t1', { title: 'Renamed' }, 'user-1', 'PROJECT_MANAGER');

    expect(mockPrisma.taskUnit.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.task.update.mock.calls[0][0].data.unitId).toBeUndefined();
  });

  it('replaces the unit set when the edit does mention units', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([
      { id: 'u5', buildingId: 'b1' }, { id: 'u6', buildingId: 'b1' },
    ]);

    await makeService().update('t1', { unitIds: ['u5', 'u6'] }, 'user-1', 'PROJECT_MANAGER');

    expect(mockPrisma.taskUnit.deleteMany).toHaveBeenCalledWith({ where: { taskId: 't1' } });
    expect(mockPrisma.taskUnit.createMany).toHaveBeenCalledWith({
      data: [{ taskId: 't1', unitId: 'u5' }, { taskId: 't1', unitId: 'u6' }],
    });
    expect(mockPrisma.task.update.mock.calls[0][0].data.unitId).toBeNull();
  });
});

describe('TasksService — a unit sees every item that covers it', () => {
  it('filters through the join table, not a scalar equality', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await makeService().findAll({ unitId: 'u2' });

    // where.unitId = 'u2' would miss "UNITS 402,403,404" entirely — the item's scalar
    // is null precisely because it covers more than one.
    expect(mockPrisma.task.findMany.mock.calls[0][0].where.units).toEqual({ some: { unitId: 'u2' } });
    expect(mockPrisma.task.findMany.mock.calls[0][0].where.unitId).toBeUndefined();
  });

  it('does not filter by kind unless asked, so no caller silently loses half the rows', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    await makeService().findAll({ projectId: 'p1' });
    expect(mockPrisma.task.findMany.mock.calls[0][0].where.kind).toBeUndefined();

    await makeService().findAll({ projectId: 'p1', kind: 'CONSTRUCTION' });
    expect(mockPrisma.task.findMany.mock.calls[1][0].where.kind).toBe('CONSTRUCTION');
  });
});

describe('TasksService — tagging actually reaches someone', () => {
  it('notifies the person tagged on create', async () => {
    // Before this, assigning work notified nobody and the column was decorative.
    mockPrisma.unit.findMany.mockResolvedValue([]);

    await makeService().create(
      { projectId: 'p1', title: 'Interior finishout', assignedTo: 'user-2' },
      'user-1',
    );

    expect(mockNotifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['user-2'], type: 'TASK_ASSIGNED' }),
    );
  });

  it('notifies EVERY person on a multi-person item, not just the first', async () => {
    // The whole reason the join table exists: a scalar silently dropped everybody after
    // the first, so half the crew never heard they were on it.
    mockPrisma.unit.findMany.mockResolvedValue([]);

    await makeService().create(
      { projectId: 'p1', title: 'Snagging', assigneeIds: ['user-2', 'user-3'] },
      'user-1',
    );

    expect(mockPrisma.task.create.mock.calls[0][0].data.assignees.create)
      .toEqual([{ userId: 'user-2' }, { userId: 'user-3' }]);
    expect(mockNotifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['user-2', 'user-3'] }),
    );
  });

  it('leaves the legacy scalar NULL when several people hold it', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await makeService().create(
      { projectId: 'p1', title: 'x', assigneeIds: ['user-2', 'user-3'] },
      'user-1',
    );
    expect(mockPrisma.task.create.mock.calls[0][0].data.assignedTo).toBeNull();
  });

  it('refuses a person who does not exist rather than silently dropping them', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-2' }]);

    await expect(
      makeService().create({ projectId: 'p1', title: 'x', assigneeIds: ['user-2', 'ghost'] }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('says nothing when you tag only yourself', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await makeService().create({ projectId: 'p1', title: 'x', assignedTo: 'user-1' }, 'user-1');
    expect(mockNotifications.send).not.toHaveBeenCalled();
  });

  it('tells the others when you tag yourself alongside them', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await makeService().create(
      { projectId: 'p1', title: 'x', assigneeIds: ['user-1', 'user-2'] },
      'user-1',
    );
    expect(mockNotifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['user-2'] }),
    );
  });

  it('fires when somebody is added on an edit', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ ...TASK, assignedTo: 'user-2' });

    await makeService().update('t1', { assignedTo: 'user-3' }, 'user-1', 'PROJECT_MANAGER');

    expect(mockNotifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['user-3'] }),
    );
  });

  it('does NOT re-notify people already on the item when the form re-posts them', async () => {
    // The R23 bug in its task form: every save posts every field. The guard is now
    // `notifiedAt IS NULL` on the join row, which is stronger than comparing scalars —
    // it can tell "added Priya" from "added Priya and Ravi".
    mockPrisma.task.findUnique.mockResolvedValue({ ...TASK, assignedTo: 'user-2' });
    mockPrisma.taskAssignment.findMany.mockResolvedValue([]);   // everybody already told

    await makeService().update('t1', { assignedTo: 'user-2', title: 'Renamed' }, 'user-1', 'PROJECT_MANAGER');

    expect(mockNotifications.send).not.toHaveBeenCalled();
  });

  it('keeps the existing rows on an edit, so nobody is re-alerted by a delete-and-recreate', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ ...TASK, assignedTo: 'user-2' });

    await makeService().update('t1', { assigneeIds: ['user-2', 'user-3'] }, 'user-1', 'PROJECT_MANAGER');

    // Only people NO LONGER on the item are deleted.
    expect(mockPrisma.taskAssignment.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 't1', userId: { notIn: ['user-2', 'user-3'] } },
    });
    expect(mockPrisma.taskAssignment.createMany).toHaveBeenCalledWith({
      data: [{ taskId: 't1', userId: 'user-2' }, { taskId: 't1', userId: 'user-3' }],
      skipDuplicates: true,
    });
  });

  it('stamps notifiedAt so the same person is never told twice', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);

    await makeService().create({ projectId: 'p1', title: 'x', assignedTo: 'user-2' }, 'user-1');

    expect(mockPrisma.taskAssignment.updateMany).toHaveBeenCalledWith({
      where: { taskId: expect.any(String), userId: { in: ['user-2'] } },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it('links to the tab that actually exists', async () => {
    // 'board' is the slug in ProjectDetailPage's TAB_MAP. A near-miss here produces a
    // notification whose link lands on a blank tab, which is worse than no link.
    mockPrisma.unit.findMany.mockResolvedValue([]);

    await makeService().create(
      { projectId: 'p1', kind: 'CONSTRUCTION', title: 'x', assignedTo: 'user-2' },
      'user-1',
    );

    expect(mockNotifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ link: '/projects/p1/board' }),
    );
  });

  it('never lets a notification failure cost the user their save', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    mockNotifications.send.mockRejectedValueOnce(new Error('notification service down'));

    await expect(
      makeService().create({ projectId: 'p1', title: 'x', assignedTo: 'user-2' }, 'user-1'),
    ).resolves.toBeDefined();
  });
});

describe('TasksService — day-wise updates', () => {
  beforeEach(() => {
    mockPrisma.taskUpdate.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'up1', ...data }));
  });

  it('defaults the reported day to today but accepts a backdated one', async () => {
    // Site notes get written up the next morning; dating them by createdAt would shift
    // the whole record.
    await makeService().addUpdate('t1', 'user-1', { content: 'Drywall done', updateDate: '2026-08-01' });
    expect(mockPrisma.taskUpdate.create.mock.calls[0][0].data.updateDate).toEqual(new Date('2026-08-01'));
  });

  it('refuses a future-dated update', async () => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    await expect(
      makeService().addUpdate('t1', 'user-1', { content: 'x', updateDate: nextYear.toISOString() }),
    ).rejects.toThrow(/future/);
  });

  it('refuses an empty update', async () => {
    await expect(
      makeService().addUpdate('t1', 'user-1', { content: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('notifies anyone named in the update, but never the author', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'user-1', name: 'Priya', email: 'priya@prime.dev' },
      { id: 'user-2', name: 'Arun', email: 'arun@prime.dev' },
    ]);

    await makeService().addUpdate('t1', 'user-1', { content: '@Arun please check, @Priya' });

    expect(mockNotifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['user-2'], type: 'COMMENT_MENTION' }),
    );
  });

  it('notifies mentions on task comments too — they had no wiring either', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'user-2', name: 'Arun', email: 'arun@prime.dev' },
    ]);
    mockPrisma.taskComment.create.mockResolvedValue({ id: 'c1' });

    await makeService().addComment('t1', 'user-1', 'blocked on @Arun');

    expect(mockNotifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['user-2'] }),
    );
  });

  it('only the author or a Project Manager can delete an update', async () => {
    mockPrisma.taskUpdate.findUnique.mockResolvedValue({ id: 'up1', authorId: 'user-9' });
    mockPrisma.taskUpdate.delete.mockResolvedValue({ id: 'up1' });

    await expect(
      makeService().deleteUpdate('up1', 'user-1', 'SALES'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.taskUpdate.delete).not.toHaveBeenCalled();

    await expect(
      makeService().deleteUpdate('up1', 'user-1', 'PROJECT_MANAGER'),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Update photos (2.4)
//
// storagePath is fed straight to the storage signer, so it is an injection surface,
// not just a string field. The guard was copied from DailyLogsService; these are the
// tests that stop it being copied wrongly.
// ---------------------------------------------------------------------------
describe('TasksService — update photos', () => {
  beforeEach(() => {
    mockPrisma.taskUpdate.findUnique.mockResolvedValue({ id: 'up1', taskId: 't1' });
    mockPrisma.taskUpdatePhoto = { create: jest.fn().mockResolvedValue({ id: 'ph1' }) };
  });

  it.each([
    ['an absolute path', '/etc/passwd'],
    ['a traversal', 'task-updates/../../secrets/key.pem'],
    ['an external URL', 'https://evil.example.com/x.jpg'],
    ['a non-http scheme', 'file:///etc/hosts'],
  ])('refuses %s as a storagePath', async (_label, path) => {
    await expect(
      makeService().addUpdatePhoto('up1', { storagePath: path }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.taskUpdatePhoto.create).not.toHaveBeenCalled();
  });

  it('accepts a relative bucket key from our own presigned-upload flow', async () => {
    await makeService().addUpdatePhoto('up1', { storagePath: 'task-updates/abc123.jpg' });
    expect(mockPrisma.taskUpdatePhoto.create).toHaveBeenCalledWith({
      data: { taskUpdateId: 'up1', storagePath: 'task-updates/abc123.jpg', caption: undefined },
    });
  });

  it('refuses an empty storagePath rather than storing a blank key', async () => {
    await expect(
      makeService().addUpdatePhoto('up1', { storagePath: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns signed URLs, because a bucket key is not displayable', async () => {
    // Without signing, every photo renders as a broken image.
    mockPrisma.taskUpdate.findMany.mockResolvedValue([
      { id: 'up1', content: 'x', photos: [{ id: 'ph1', storagePath: 'task-updates/a.jpg' }] },
    ]);

    const [update] = await makeService().getUpdates('t1');

    expect(mockStorage.signedUrl).toHaveBeenCalledWith('task-updates/a.jpg', 3600);
    expect(update.photos[0].url).toBe('https://signed/x.jpg');
  });

  it('one unsignable photo does not take the whole update list down', async () => {
    // Mirrors DailyLogsService.enrichPhotos. A storage blip should degrade one image,
    // not blank the board's entire update history.
    mockStorage.signedUrl.mockRejectedValueOnce(new Error('storage unavailable'));
    mockPrisma.taskUpdate.findMany.mockResolvedValue([
      { id: 'up1', content: 'x', photos: [{ id: 'ph1', storagePath: 'task-updates/a.jpg' }] },
    ]);

    const [update] = await makeService().getUpdates('t1');

    expect(update.photos[0].url).toBe('');
    expect(update.content).toBe('x');
  });
});

describe('TasksService — the kind discriminator is validated', () => {
  // The controller takes `@Body() body: any`, so class-validator never sees this field.
  // A bad value does not fail loudly — it produces a row that matches neither the board
  // nor the tasks page, and the item simply disappears.
  it('refuses an unknown kind on create', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await expect(
      makeService().create({ projectId: 'p1', title: 'x', kind: 'SOMETHING_ELSE' }, 'user-1'),
    ).rejects.toThrow(/Unknown work item kind/);
  });

  it('refuses an unknown kind on update', async () => {
    await expect(
      makeService().update('t1', { kind: 'nonsense' }, 'user-1', 'PROJECT_MANAGER'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('defaults an omitted kind to TASK', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await makeService().create({ projectId: 'p1', title: 'x' }, 'user-1');
    expect(mockPrisma.task.create.mock.calls[0][0].data.kind).toBe('TASK');
  });

  it('accepts both real kinds', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    for (const kind of ['TASK', 'CONSTRUCTION']) {
      await makeService().create({ projectId: 'p1', title: 'x', kind }, 'user-1');
    }
    expect(mockPrisma.task.create.mock.calls.map((c: any) => c[0].data.kind))
      .toEqual(['TASK', 'CONSTRUCTION']);
  });
});
