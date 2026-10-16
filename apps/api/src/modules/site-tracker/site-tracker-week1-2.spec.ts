/**
 * Site Tracker weeks 1–2 (client meeting 2026-10-13, decisions 2026-10-16):
 *   - delete protection: you may delete what you created; anything else needs siteTracker:manage
 *   - notifications: owners + watchers + project PMs + Founders, never the actor
 *   - one job across several units ("Units 805, 807 …")
 *   - watching, and the derived row timeline
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { assertMayDelete } from './site-delete-rule';
import { siteUnitLabel, compareUnitNumbers } from './site-unit-context';
import { SiteTrackerService } from './site-tracker.service';
import { DailyLogsService } from '../daily-logs/daily-logs.service';
import { UnitsService } from '../units/units.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConstructionChecklistService } from '../construction-checklist/construction-checklist.service';

const flush = () => new Promise((r) => setImmediate(r));

describe('assertMayDelete — "owner, founder, super admin"', () => {
  const pm = { userId: 'pm1', permissions: ['dailylog:edit', 'checklist:edit'] };
  const founder = { userId: 'f1', permissions: ['siteTracker:manage'] };

  it('lets you delete what you created', () => {
    expect(() => assertMayDelete(pm, 'pm1', 'update')).not.toThrow();
  });
  it('refuses someone else\'s without siteTracker:manage', () => {
    expect(() => assertMayDelete(pm, 'victor', 'update')).toThrow(ForbiddenException);
  });
  it('lets a holder of siteTracker:manage delete anybody\'s', () => {
    expect(() => assertMayDelete(founder, 'victor', 'update')).not.toThrow();
  });
  it('treats an unknown creator (legacy rows) as somebody else\'s', () => {
    expect(() => assertMayDelete(pm, null, 'stage')).toThrow(ForbiddenException);
    expect(() => assertMayDelete(founder, null, 'stage')).not.toThrow();
  });
});

describe('siteUnitLabel', () => {
  it('names a single unit the way the row does', () => {
    expect(siteUnitLabel('103')).toBe('Unit 103');
  });
  it('lists a job\'s units in numeric order', () => {
    expect(siteUnitLabel('805', ['1003', '807'])).toBe('Units 805, 807, 1003');
    expect(['1003', '805', '807'].sort(compareUnitNumbers)).toEqual(['805', '807', '1003']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DailyLogsService — delete rule and notifications', () => {
  const prisma: any = {
    dailyLog: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    dailyLogPhoto: { findUnique: jest.fn(), delete: jest.fn() },
    unit: { findUnique: jest.fn() },
    unitConstructionStage: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const notifications: any = { notifySiteUpdatePosted: jest.fn().mockResolvedValue(undefined) };
  const storage: any = { signedUrl: jest.fn().mockResolvedValue('') };
  const svc = () => new DailyLogsService(prisma, storage, notifications);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ name: 'Victor R' });
  });

  it('refuses to delete another person\'s update for a PM', async () => {
    prisma.dailyLog.findUnique.mockResolvedValue({ id: 'l1', authorId: 'victor', photos: [] });
    await expect(svc().remove('l1', { userId: 'pm1', permissions: ['dailylog:edit'] }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.dailyLog.delete).not.toHaveBeenCalled();
  });

  it('lets the author delete their own update', async () => {
    prisma.dailyLog.findUnique.mockResolvedValue({ id: 'l1', authorId: 'victor', photos: [] });
    await svc().remove('l1', { userId: 'victor', permissions: ['dailylog:edit'] });
    expect(prisma.dailyLog.delete).toHaveBeenCalledWith({ where: { id: 'l1' } });
  });

  it('judges a photo by the author of the update it hangs off', async () => {
    prisma.dailyLogPhoto.findUnique.mockResolvedValue({ id: 'ph1', dailyLog: { authorId: 'victor' } });
    await expect(svc().removePhoto('ph1', { userId: 'pm1', permissions: [] }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await svc().removePhoto('ph1', { userId: 'f1', permissions: ['siteTracker:manage'] });
    expect(prisma.dailyLogPhoto.delete).toHaveBeenCalledTimes(1);
  });

  it('notifies on a unit-level post, routed to the job\'s lead and labelled like the row', async () => {
    // Unit 807 is a member of the 805 job: the post is filed on 807, the alert speaks for the row.
    prisma.unit.findUnique.mockImplementation(({ where, select }: any) => {
      if (select?.trackedWithId) return { id: where.id, trackedWithId: where.id === 'u807' ? 'u805' : null, deletedAt: null };
      if (select?.building && select?.deletedAt) {
        return { deletedAt: null, buildingId: 'b8', building: { projectId: 'p1' } };
      }
      return {
        id: 'u805', unitNumber: '805', trackedUnits: [{ unitNumber: '807' }],
        building: { project: { id: 'p1', name: 'Centro Plaza' } },
      };
    });
    prisma.dailyLog.create.mockResolvedValue({ id: 'l9', unitId: 'u807', authorId: 'victor', notes: 'Flooring 50% done' });

    await svc().create({ projectId: 'p1', unitId: 'u807', notes: 'Flooring 50% done', authorId: 'victor' } as any);
    await flush();

    expect(notifications.notifySiteUpdatePosted).toHaveBeenCalledWith(expect.objectContaining({
      unitId: 'u805', unitLabel: 'Units 805, 807', projectId: 'p1', actorId: 'victor',
      actorName: 'Victor R', parentAuthorId: null,
    }));
  });

  it('does not notify for a site-wide log with no unit', async () => {
    prisma.dailyLog.create.mockResolvedValue({ id: 'l1', unitId: null, authorId: 'victor', notes: 'Rain day' });
    await svc().create({ projectId: 'p1', notes: 'Rain day', authorId: 'victor' } as any);
    await flush();
    expect(notifications.notifySiteUpdatePosted).not.toHaveBeenCalled();
  });

  it('a saved post survives a failing notification', async () => {
    notifications.notifySiteUpdatePosted.mockRejectedValueOnce(new Error('smtp down'));
    prisma.unit.findUnique.mockResolvedValue({
      id: 'u1', unitNumber: '103', trackedWithId: null, deletedAt: null, buildingId: 'b1',
      trackedUnits: [], building: { projectId: 'p1', project: { id: 'p1', name: 'P' } },
    });
    prisma.dailyLog.create.mockResolvedValue({ id: 'l1', unitId: 'u1', authorId: 'victor', notes: 'x' });
    await expect(svc().create({ projectId: 'p1', unitId: 'u1', notes: 'x', authorId: 'victor' } as any))
      .resolves.toMatchObject({ id: 'l1' });
    await flush();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('NotificationsService.siteRecipients — owners, watchers, PMs, Founders', () => {
  const prisma: any = {
    unitAssignee: { findMany: jest.fn() },
    unitWatcher: { findMany: jest.fn() },
    projectMember: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const config: any = { get: (_k: string, d?: any) => d };
  const svc = () => new NotificationsService(prisma, config, undefined as any);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.unitAssignee.findMany.mockResolvedValue([{ userId: 'victor' }, { userId: 'andrew' }]);
    prisma.unitWatcher.findMany.mockResolvedValue([{ userId: 'ana' }]);
    prisma.projectMember.findMany.mockResolvedValue([{ userId: 'kevin' }, { userId: 'ravi-sales' }]);
    prisma.user.findMany.mockImplementation(({ where }: any) => {
      // First call: Founders. Second: the PMs among the project members.
      if (JSON.stringify(where).includes('FOUNDER')) return [{ id: 'mallik' }];
      return [{ id: 'kevin' }];
    });
  });

  it('is the union of all four groups, minus whoever acted', async () => {
    const ids = await svc().siteRecipients({ unitId: 'u1', projectId: 'p1', actorId: 'victor' });
    expect(ids.sort()).toEqual(['ana', 'andrew', 'kevin', 'mallik']);
  });

  it('restricts PMs to members of the project', async () => {
    await svc().siteRecipients({ unitId: 'u1', projectId: 'p1' });
    const pmQuery = prisma.user.findMany.mock.calls.find((c: any) => !JSON.stringify(c[0].where).includes('FOUNDER'))[0];
    expect(pmQuery.where.id).toEqual({ in: ['kevin', 'ravi-sales'] });
  });

  it('reaches every PM when nobody is staffed on the project yet', async () => {
    prisma.projectMember.findMany.mockResolvedValue([]);
    await svc().siteRecipients({ unitId: 'u1', projectId: 'p1' });
    const pmQuery = prisma.user.findMany.mock.calls.find((c: any) => !JSON.stringify(c[0].where).includes('FOUNDER'))[0];
    expect(pmQuery.where.id).toBeUndefined();
  });

  it('does not add Executives or Super Admins (they were not asked for)', async () => {
    await svc().siteRecipients({ unitId: 'u1', projectId: 'p1' });
    const all = JSON.stringify(prisma.user.findMany.mock.calls);
    expect(all).not.toContain('EXECUTIVE');
    expect(all).not.toContain('SUPER_ADMIN');
  });

  it('adds the original poster on a reply', async () => {
    const ids = await svc().siteRecipients({ unitId: 'u1', projectId: 'p1', actorId: 'kevin', extra: ['ryan'] });
    expect(ids).toContain('ryan');
    expect(ids).not.toContain('kevin');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('UnitsService — owners, blockers, jobs and watching', () => {
  const prisma: any = {
    unit: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    unitAssignee: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    unitWatcher: { upsert: jest.fn(), deleteMany: jest.fn() },
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    customOption: { findFirst: jest.fn() },
    $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  const notifications: any = {
    notifySiteUnitAssigned: jest.fn().mockResolvedValue(undefined),
    notifySiteBlockerFlagged: jest.fn().mockResolvedValue(undefined),
  };
  const svc = () => {
    const s = new UnitsService(
      prisma, {} as any, {} as any, { record: jest.fn() } as any,
      { getSystemDefaults: () => ({}) } as any, notifications,
    );
    jest.spyOn(s, 'findById').mockResolvedValue({ id: 'u1' } as any);
    return s;
  };
  /** findUnique: the unit under test, then the lead lookup loadSiteUnitContext makes. */
  const unitIs = (u: any) => prisma.unit.findUnique.mockImplementation(({ select }: any) => (
    select?.trackedUnits && select?.building
      ? { id: u.id, unitNumber: u.unitNumber ?? '103', trackedUnits: [], building: { project: { id: 'p1', name: 'Centro Plaza' } } }
      : { id: 'u1', deletedAt: null, trackedWithId: null, blockerStatus: null, blockerReason: null, ...u }
  ));

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ name: 'Kevin P' });
  });

  it('notifies only the owners ADDED by a full-set replacement', async () => {
    unitIs({ id: 'u1' });
    prisma.unitAssignee.findMany.mockResolvedValueOnce([{ userId: 'victor' }]).mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([{ id: 'victor' }, { id: 'andrew' }]);
    await svc().setAssignees('u1', ['victor', 'andrew'], 'kevin');
    await flush();
    expect(notifications.notifySiteUnitAssigned).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['andrew'], unitLabel: 'Unit 103', actorId: 'kevin',
    }));
  });

  it('sends nothing when the owner list did not grow', async () => {
    unitIs({ id: 'u1' });
    prisma.unitAssignee.findMany.mockResolvedValueOnce([{ userId: 'victor' }]).mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([{ id: 'victor' }]);
    await svc().setAssignees('u1', ['victor'], 'kevin');
    await flush();
    expect(notifications.notifySiteUnitAssigned).not.toHaveBeenCalled();
  });

  it('alerts on the flip TO blocked, not on editing the reason of a unit already blocked', async () => {
    unitIs({ id: 'u1', blockerStatus: null });
    await svc().updateSiteTracker('u1', { blockerStatus: 'YES', blockerReason: 'Waiting on electrician' }, 'kevin');
    await flush();
    expect(notifications.notifySiteBlockerFlagged).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'Waiting on electrician', actorName: 'Kevin P',
    }));

    jest.clearAllMocks();
    unitIs({ id: 'u1', blockerStatus: 'YES', blockerReason: 'Waiting on electrician' });
    await svc().updateSiteTracker('u1', { blockerStatus: 'YES', blockerReason: 'Electrician Monday' }, 'kevin');
    await flush();
    expect(notifications.notifySiteBlockerFlagged).not.toHaveBeenCalled();
  });

  it('refuses tracker writes on a member of a job and says which row to use', async () => {
    prisma.unit.findUnique.mockImplementation(({ where }: any) => (
      where.id === 'u807'
        ? { id: 'u807', deletedAt: null, trackedWithId: 'u805', blockerStatus: null, blockerReason: null }
        : { unitNumber: '805' }
    ));
    await expect(svc().updateSiteTracker('u807', { sitePriority: 'HIGH' }))
      .rejects.toThrow(/part of Unit 805's job/);
    await expect(svc().setAssignees('u807', ['victor'])).rejects.toBeInstanceOf(ConflictException);
  });

  describe('setSiteGroup', () => {
    const lead = { id: 'u805', unitNumber: '805', buildingId: 'b8', deletedAt: null, trackedWithId: null, trackedUnits: [] };
    const member = (id: string, over: any = {}) => ({
      id, unitNumber: id.slice(1), buildingId: 'b8', deletedAt: null, trackedWithId: null,
      blockerStatus: null, sitePriority: null,
      _count: { constructionStages: 0, siteAssignees: 0, trackedUnits: 0 }, ...over,
    });
    beforeEach(() => { prisma.unit.findUnique.mockResolvedValue(lead); });

    it('groups untracked units in the same building and returns the row label', async () => {
      prisma.unit.findMany
        .mockResolvedValueOnce([member('u807'), member('u809')])
        .mockResolvedValueOnce([{ id: 'u809', unitNumber: '809' }, { id: 'u807', unitNumber: '807' }]);
      const out = await svc().setSiteGroup('u805', ['u807', 'u809', 'u805']);
      expect(prisma.unit.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['u807', 'u809'] } }, data: { trackedWithId: 'u805' },
      });
      expect(out.label).toBe('Units 805, 807, 809');
    });

    it('refuses a unit in another building', async () => {
      prisma.unit.findMany.mockResolvedValueOnce([member('u901', { buildingId: 'b9' })]);
      await expect(svc().setSiteGroup('u805', ['u901'])).rejects.toThrow(/Unit 901 is in a different building/);
    });

    it('refuses a unit that is on the tracker in its own right — its checklist would vanish', async () => {
      prisma.unit.findMany.mockResolvedValueOnce([
        member('u807', { _count: { constructionStages: 22, siteAssignees: 0, trackedUnits: 0 } }),
      ]);
      await expect(svc().setSiteGroup('u805', ['u807'])).rejects.toThrow(/on the tracker in its own right/);
      expect(prisma.unit.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a unit already in another job, or one that leads its own', async () => {
      prisma.unit.findMany.mockResolvedValueOnce([
        member('u807', { trackedWithId: 'u999' }),
        member('u809', { _count: { constructionStages: 0, siteAssignees: 0, trackedUnits: 2 } }),
      ]);
      await expect(svc().setSiteGroup('u805', ['u807', 'u809']))
        .rejects.toThrow(/807 is already part of another job.*809 leads a job of its own/);
    });

    it('[] releases every member', async () => {
      prisma.unit.findMany.mockResolvedValueOnce([]);
      await svc().setSiteGroup('u805', []);
      expect(prisma.unit.updateMany).toHaveBeenCalledWith({
        where: { trackedWithId: 'u805', id: { notIn: [] } }, data: { trackedWithId: null },
      });
    });
  });

  it('watching a member of a job watches the job', async () => {
    prisma.unit.findUnique.mockResolvedValue({ deletedAt: null, trackedWithId: 'u805' });
    const out = await svc().watch('u807', 'ana');
    expect(prisma.unitWatcher.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { unitId_userId: { unitId: 'u805', userId: 'ana' } },
    }));
    expect(out).toEqual({ unitId: 'u805', watching: true });
  });

  it('taking a member off the tracker only takes it out of its job', async () => {
    prisma.unit.findUnique.mockResolvedValue({ id: 'u807', deletedAt: null, trackedWithId: 'u805' });
    const out = await svc().untrackFromSiteTracker('u807');
    expect(prisma.unit.update).toHaveBeenCalledWith({ where: { id: 'u807' }, data: { trackedWithId: null } });
    expect(out).toMatchObject({ leftJob: true, stagesDeleted: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ConstructionChecklistService — stage delete rule and job members', () => {
  const prisma: any = {
    unit: { findUnique: jest.fn() },
    unitConstructionStage: { findUnique: jest.fn(), delete: jest.fn(), findMany: jest.fn() },
    unitConstructionStagePhoto: { findUnique: jest.fn(), delete: jest.fn() },
  };
  const svc = () => new ConstructionChecklistService(prisma, {} as any, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('lets the person who added a stage remove it, and nobody else short of a Founder', async () => {
    prisma.unitConstructionStage.findUnique.mockResolvedValue({ id: 's1', createdById: 'kevin' });
    await expect(svc().deleteStage('s1', { userId: 'victor', permissions: ['checklist:edit'] }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await svc().deleteStage('s1', { userId: 'kevin', permissions: ['checklist:edit'] });
    await svc().deleteStage('s1', { userId: 'mallik', permissions: ['siteTracker:manage'] });
    expect(prisma.unitConstructionStage.delete).toHaveBeenCalledTimes(2);
  });

  it('stage photos follow their uploader', async () => {
    prisma.unitConstructionStagePhoto.findUnique.mockResolvedValue({ id: 'p1', uploadedById: 'victor' });
    await expect(svc().removeStagePhoto('p1', { userId: 'kevin', permissions: [] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to add stages to a member of a job — its checklist lives on the lead', async () => {
    prisma.unit.findUnique.mockImplementation(({ select }: any) => (
      select?.trackedWith ? { trackedWith: { unitNumber: '805' } } : { id: 'u807', deletedAt: null }
    ));
    await expect(svc().addUnitStages('u807', ['Framing'])).rejects.toThrow(/Unit 805's job/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SiteTrackerService.grid — jobs, watching and timeline', () => {
  const prisma: any = { unit: { findMany: jest.fn() } };
  const access: any = { isScoped: () => false };
  const viewer = { userId: 'ana', role: 'PROJECT_MANAGER', permissions: ['siteTracker:view'] };
  const row = (over: any = {}) => ({
    id: 'u805', unitNumber: '805', status: 'UNDER_CONSTRUCTION', createdAt: new Date(),
    blockerStatus: null, blockerReason: null, blockerSince: null, sitePriority: 'HIGH', templateVersion: null,
    building: { id: 'b8', name: 'Building 8', project: { id: 'p1', name: 'Centro Plaza' } },
    template: null, siteAssignees: [], constructionStages: [], trackedUnits: [], siteWatchers: [],
    ...over,
  });
  const where = () => prisma.unit.findMany.mock.calls[0][0].where;

  beforeEach(() => jest.clearAllMocks());

  it('never lists a member as a row of its own, in any mode', async () => {
    for (const filters of [{}, { includeUntracked: true }, { untrackedOnly: true }]) {
      prisma.unit.findMany.mockClear().mockResolvedValue([]);
      await new SiteTrackerService(prisma, access).grid(filters, viewer);
      expect(where().trackedWithId).toBeNull();
    }
  });

  it('keeps a job lead off the Track-a-unit list', async () => {
    prisma.unit.findMany.mockResolvedValue([]);
    await new SiteTrackerService(prisma, access).grid({ untrackedOnly: true }, viewer);
    expect(where().trackedUnits).toEqual({ none: { deletedAt: null } });
  });

  it('labels a job row with all its units, numerically, and lets search find a member', async () => {
    prisma.unit.findMany.mockResolvedValue([row({
      trackedUnits: [{ id: 'u815', unitNumber: '815', status: 'SOLD' }, { id: 'u807', unitNumber: '807', status: 'SOLD' }],
    })]);
    const out = await new SiteTrackerService(prisma, access).grid({ search: '815' }, viewer);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].label).toBe('Units 805, 807, 815');
    expect(out.rows[0].groupUnits.map((g: any) => g.unitNumber)).toEqual(['807', '815']);
  });

  it('says whether the viewer is watching, and how many are', async () => {
    prisma.unit.findMany.mockResolvedValue([row({ siteWatchers: [{ userId: 'ana' }, { userId: 'kevin' }] })]);
    const out = await new SiteTrackerService(prisma, access).grid({}, viewer);
    expect(out.rows[0]).toMatchObject({ watching: true, watcherCount: 2 });
  });

  it('derives the row timeline from the earliest stage start and latest stage end', async () => {
    prisma.unit.findMany.mockResolvedValue([row({
      constructionStages: [
        { id: 'a', label: 'Rough Plumbing', status: 'DONE', sortOrder: 1, startsOn: new Date('2026-08-19'), endsOn: new Date('2026-08-21') },
        { id: 'b', label: 'Framing', status: 'IN_PROGRESS', sortOrder: 2, startsOn: new Date('2026-08-24'), endsOn: null },
        { id: 'c', label: 'Final', status: 'NOT_STARTED', sortOrder: 3, startsOn: null, endsOn: null },
      ],
    })]);
    const out = await new SiteTrackerService(prisma, access).grid({}, viewer);
    expect(out.rows[0].timeline).toEqual({ start: '2026-08-19T00:00:00.000Z', end: '2026-08-24T00:00:00.000Z' });
  });

  it('has no timeline when no stage carries a date', async () => {
    prisma.unit.findMany.mockResolvedValue([row()]);
    const out = await new SiteTrackerService(prisma, access).grid({}, viewer);
    expect(out.rows[0].timeline).toBeNull();
  });
});

describe('ConstructionChecklistService.updateStage — inline rename', () => {
  const prisma: any = {
    unitConstructionStage: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    customOption: { findMany: jest.fn() },
  };
  const svc = () => new ConstructionChecklistService(prisma, {} as any, {} as any);
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.unitConstructionStage.findUnique.mockResolvedValue({ id: 's1', unitId: 'u1', label: 'Framng' });
    prisma.customOption.findMany.mockResolvedValue([{ value: 'FRAMING', label: 'Framing' }]);
  });

  it('renames and re-links to the catalogue entry the new name matches', async () => {
    prisma.unitConstructionStage.findFirst.mockResolvedValue(null);
    await svc().updateStage('s1', { label: '  Framing ' });
    expect(prisma.unitConstructionStage.update.mock.calls[0][0].data).toMatchObject({ label: 'Framing', stageValue: 'FRAMING' });
  });

  it('a name the catalogue does not know becomes a one-off', async () => {
    prisma.unitConstructionStage.findFirst.mockResolvedValue(null);
    await svc().updateStage('s1', { label: 'Walk-in cooler' });
    expect(prisma.unitConstructionStage.update.mock.calls[0][0].data).toMatchObject({ label: 'Walk-in cooler', stageValue: null });
  });

  it('refuses a second stage with the same name on the unit', async () => {
    prisma.unitConstructionStage.findFirst.mockResolvedValue({ id: 's2' });
    await expect(svc().updateStage('s1', { label: 'Framing' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an empty name', async () => {
    await expect(svc().updateStage('s1', { label: '   ' })).rejects.toThrow(/needs a name/);
  });
});
