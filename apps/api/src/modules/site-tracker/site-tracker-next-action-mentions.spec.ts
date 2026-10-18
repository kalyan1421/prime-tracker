/**
 * Site Tracker, after weeks 1–2 (client, 2026-10-16):
 *   - a typed "Next action" per row (the monday column was AI-written; AI was cut in August)
 *   - ST-10: @mentions in site updates notify the person named
 */
import { DailyLogsService } from '../daily-logs/daily-logs.service';
import { UnitsService } from '../units/units.service';
import { SiteTrackerService } from './site-tracker.service';

const flush = () => new Promise((r) => setImmediate(r));

const ROSTER = [
  { id: 'victor', name: 'Victor R', email: 'victor@prime.dev' },
  { id: 'ana', name: 'Ana P', email: 'ana@prime.dev' },
  { id: 'kevin', name: 'Kevin P', email: 'kevin@prime.dev' },
];

describe('UnitsService.updateSiteTracker — Next action', () => {
  const prisma: any = {
    unit: { findUnique: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    customOption: { findFirst: jest.fn() },
  };
  const svc = () => {
    const s = new UnitsService(
      prisma, {} as any, {} as any, { record: jest.fn() } as any,
      { getSystemDefaults: () => ({}) } as any, {} as any,
    );
    jest.spyOn(s, 'findById').mockResolvedValue({ id: 'u1' } as any);
    return s;
  };
  const unitIs = (u: any) => prisma.unit.findUnique.mockResolvedValue({
    id: 'u1', deletedAt: null, trackedWithId: null, blockerStatus: null, blockerReason: null, siteNextAction: null, ...u,
  });
  const written = () => prisma.unit.update.mock.calls[0]?.[0]?.data;

  beforeEach(() => jest.clearAllMocks());

  it('stores the text trimmed, stamped with who and when', async () => {
    unitIs({});
    await svc().updateSiteTracker('u1', { siteNextAction: '  Book the framing inspection  ' }, 'victor');
    expect(written()).toMatchObject({ siteNextAction: 'Book the framing inspection', siteNextActionById: 'victor' });
    expect(written().siteNextActionAt).toBeInstanceOf(Date);
  });

  it('clearing it clears who and when too', async () => {
    unitIs({ siteNextAction: 'Book the framing inspection' });
    await svc().updateSiteTracker('u1', { siteNextAction: '   ' }, 'victor');
    expect(written()).toEqual({ siteNextAction: null, siteNextActionAt: null, siteNextActionById: null });
  });

  it('re-saving the same text keeps the original stamp — the age is the point', async () => {
    unitIs({ siteNextAction: 'Book the framing inspection' });
    await svc().updateSiteTracker('u1', { siteNextAction: 'Book the framing inspection' }, 'ana');
    expect(prisma.unit.update).not.toHaveBeenCalled();
  });

  it('refuses it on a member of a job, like every other tracker field', async () => {
    prisma.unit.findUnique.mockImplementation(({ where }: any) => (
      where.id === 'u807'
        ? { id: 'u807', deletedAt: null, trackedWithId: 'u805', siteNextAction: null }
        : { unitNumber: '805' }
    ));
    await expect(svc().updateSiteTracker('u807', { siteNextAction: 'x' }, 'victor')).rejects.toThrow(/Unit 805/);
  });
});

describe('SiteTrackerService.grid — Next action on the row', () => {
  const prisma: any = { unit: { findMany: jest.fn() } };
  const access: any = { isScoped: () => false };
  const viewer = { userId: 'ana', role: 'PROJECT_MANAGER', permissions: ['siteTracker:view'] };
  const row = (over: any = {}) => ({
    id: 'u103', unitNumber: '103', status: 'UNDER_CONSTRUCTION', createdAt: new Date(),
    blockerStatus: null, blockerReason: null, blockerSince: null, sitePriority: 'HIGH', templateVersion: null,
    siteNextAction: null, siteNextActionAt: null, siteNextActionBy: null,
    building: { id: 'b1', name: 'Building 1', project: { id: 'p1', name: 'Centro Plaza' } },
    template: null, siteAssignees: [], constructionStages: [], trackedUnits: [], siteWatchers: [],
    ...over,
  });

  it('carries the text, when and by whom — and null when there is none', async () => {
    const at = new Date('2026-10-14T10:00:00Z');
    prisma.unit.findMany.mockResolvedValue([
      row({ siteNextAction: 'Install rooftop unit Monday', siteNextActionAt: at, siteNextActionBy: { id: 'victor', name: 'Victor R' } }),
      row({ id: 'u104', unitNumber: '104' }),
    ]);
    const out: any = await new SiteTrackerService(prisma, access).grid({}, viewer);
    const byId = Object.fromEntries(out.rows.map((r: any) => [r.id, r]));
    expect(byId.u103.nextAction).toEqual({ text: 'Install rooftop unit Monday', at, by: { id: 'victor', name: 'Victor R' } });
    expect(byId.u104.nextAction).toBeNull();
  });

  it('search finds a row by its next action', async () => {
    prisma.unit.findMany.mockResolvedValue([
      row({ siteNextAction: 'Call the fire marshal' }),
      row({ id: 'u104', unitNumber: '104' }),
    ]);
    const out: any = await new SiteTrackerService(prisma, access).grid({ search: 'fire marshal' }, viewer);
    expect(out.rows.map((r: any) => r.id)).toEqual(['u103']);
  });
});

describe('DailyLogsService — @mentions (ST-10)', () => {
  const prisma: any = {
    dailyLog: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    unit: { findUnique: jest.fn() },
    unitConstructionStage: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const notifications: any = {
    notifySiteUpdatePosted: jest.fn().mockResolvedValue(undefined),
    notifySiteUpdateMention: jest.fn().mockResolvedValue(undefined),
  };
  const storage: any = { signedUrl: jest.fn().mockResolvedValue('') };
  const svc = () => new DailyLogsService(prisma, storage, notifications);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ name: 'Victor R' });
    prisma.user.findMany.mockResolvedValue(ROSTER);
    prisma.unit.findUnique.mockResolvedValue({
      id: 'u1', unitNumber: '103', trackedWithId: null, deletedAt: null, buildingId: 'b1',
      trackedUnits: [], building: { projectId: 'p1', project: { id: 'p1', name: 'Centro Plaza' } },
    });
  });

  const post = async (notes: string) => {
    prisma.dailyLog.create.mockResolvedValue({ id: 'l1', unitId: 'u1', authorId: 'victor', notes });
    await svc().create({ projectId: 'p1', unitId: 'u1', notes, authorId: 'victor' } as any);
    await flush();
  };

  it('tells the person named, and leaves them out of the general "posted on" alert', async () => {
    await post('@Ana P can you book the framing inspection?');
    expect(notifications.notifySiteUpdateMention).toHaveBeenCalledWith(expect.objectContaining({
      mentionedUserIds: ['ana'], unitLabel: 'Unit 103', actorId: 'victor', actorName: 'Victor R',
    }));
    expect(notifications.notifySiteUpdatePosted).toHaveBeenCalledWith(expect.objectContaining({ skipUserIds: ['ana'] }));
  });

  it('never notifies you about mentioning yourself', async () => {
    await post('Note to @Victor R: order the trim');
    expect(notifications.notifySiteUpdateMention).not.toHaveBeenCalled();
    expect(notifications.notifySiteUpdatePosted).toHaveBeenCalledWith(expect.objectContaining({ skipUserIds: [] }));
  });

  it('skips the roster lookup entirely when there is no "@"', async () => {
    await post('Flooring 50% done');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(notifications.notifySiteUpdateMention).not.toHaveBeenCalled();
  });

  it('an edit tells only the people it newly names', async () => {
    prisma.dailyLog.findUnique.mockResolvedValue({
      id: 'l1', unitId: 'u1', authorId: 'victor', notes: '@Ana P framing is ready', photos: [],
    });
    prisma.dailyLog.update.mockResolvedValue({
      id: 'l1', unitId: 'u1', authorId: 'victor', notes: '@Ana P framing is ready, @Kevin P please sign off',
    });
    await svc().update('l1', { notes: '@Ana P framing is ready, @Kevin P please sign off' } as any);
    await flush();
    expect(notifications.notifySiteUpdateMention).toHaveBeenCalledTimes(1);
    expect(notifications.notifySiteUpdateMention.mock.calls[0][0].mentionedUserIds).toEqual(['kevin']);
  });

  it('an edit that changes nothing about who is named sends nothing', async () => {
    prisma.dailyLog.findUnique.mockResolvedValue({ id: 'l1', unitId: 'u1', authorId: 'victor', notes: '@Ana P ready', photos: [] });
    prisma.dailyLog.update.mockResolvedValue({ id: 'l1', unitId: 'u1', authorId: 'victor', notes: '@Ana P ready now' });
    await svc().update('l1', { notes: '@Ana P ready now' } as any);
    await flush();
    expect(notifications.notifySiteUpdateMention).not.toHaveBeenCalled();
  });
});

describe('DailyLogsService — clientRef (an update re-sent after a dropped signal)', () => {
  const prisma: any = {
    dailyLog: { findUnique: jest.fn(), create: jest.fn() },
    unit: { findUnique: jest.fn() },
    unitConstructionStage: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const notifications: any = {
    notifySiteUpdatePosted: jest.fn().mockResolvedValue(undefined),
    notifySiteUpdateMention: jest.fn().mockResolvedValue(undefined),
  };
  const svc = () => new DailyLogsService(prisma, { signedUrl: jest.fn() } as any, notifications);
  const body = { projectId: 'p1', unitId: 'u1', notes: 'Framing done', authorId: 'victor', clientRef: 'ph-123' } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ name: 'Victor R' });
    prisma.unit.findUnique.mockResolvedValue({
      id: 'u1', unitNumber: '103', trackedWithId: null, deletedAt: null, buildingId: 'b1',
      trackedUnits: [], building: { projectId: 'p1', project: { id: 'p1', name: 'Centro Plaza' } },
    });
  });

  it('returns the post that already landed, writes nothing and notifies nobody', async () => {
    prisma.dailyLog.findUnique.mockResolvedValue({ id: 'l1', unitId: 'u1', authorId: 'victor', notes: 'Framing done' });
    const out = await svc().create(body);
    await flush();
    expect(out).toMatchObject({ id: 'l1' });
    expect(prisma.dailyLog.findUnique).toHaveBeenCalledWith({ where: { authorId_clientRef: { authorId: 'victor', clientRef: 'ph-123' } } });
    expect(prisma.dailyLog.create).not.toHaveBeenCalled();
    expect(notifications.notifySiteUpdatePosted).not.toHaveBeenCalled();
  });

  it('stores the ref on a first send', async () => {
    prisma.dailyLog.findUnique.mockResolvedValue(null);
    prisma.dailyLog.create.mockResolvedValue({ id: 'l2', unitId: 'u1', authorId: 'victor', notes: 'Framing done' });
    await svc().create(body);
    expect(prisma.dailyLog.create.mock.calls[0][0].data.clientRef).toBe('ph-123');
  });

  it('two copies racing: the loser gets the winner\'s post back, not an error', async () => {
    prisma.dailyLog.findUnique
      .mockResolvedValueOnce(null) // the pre-check, before the other copy landed
      .mockResolvedValueOnce({ id: 'l3', unitId: 'u1', authorId: 'victor', notes: 'Framing done' });
    prisma.dailyLog.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(svc().create(body)).resolves.toMatchObject({ id: 'l3' });
  });

  it('a post with no ref behaves exactly as before', async () => {
    prisma.dailyLog.create.mockResolvedValue({ id: 'l4', unitId: 'u1', authorId: 'victor', notes: 'x' });
    await svc().create({ ...body, clientRef: undefined });
    expect(prisma.dailyLog.findUnique).not.toHaveBeenCalled();
    expect(prisma.dailyLog.create.mock.calls[0][0].data.clientRef).toBeNull();
  });
});
