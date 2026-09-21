import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeadsService } from './leads.service';

const mockPrisma: any = {
  lead: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  leadActivity: { create: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  leadComment: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  user: { findMany: jest.fn() },
  unit: { findUnique: jest.fn() },
  leadUnitInterest: { upsert: jest.fn(), delete: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
};

const mockNotifications: any = {
  notifyLeadCommentMention: jest.fn(),
};

function makeService() {
  // ProjectAccessService stub: no scoping in unit tests (undefined = unrestricted).
  return new LeadsService(
    mockPrisma as any,
    { listProjectScope: async () => undefined } as any,
    mockNotifications as any,
  );
}

describe('LeadsService — multi-unit interest / waitlist', () => {
  let service: LeadsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  describe('addInterest', () => {
    it('requires a unitId', async () => {
      await expect(service.addInterest('l1', '')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the lead is missing', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(null);
      mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1' });
      await expect(service.addInterest('l1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the unit is missing', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
      mockPrisma.unit.findUnique.mockResolvedValue(null);
      await expect(service.addInterest('l1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('upserts the interest (idempotent on lead+unit)', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
      mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1' });
      mockPrisma.leadUnitInterest.upsert.mockResolvedValue({ id: 'i1', leadId: 'l1', unitId: 'u1' });
      await service.addInterest('l1', 'u1', 'wants ground floor');
      expect(mockPrisma.leadUnitInterest.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { leadId_unitId: { leadId: 'l1', unitId: 'u1' } },
          create: expect.objectContaining({ leadId: 'l1', unitId: 'u1', note: 'wants ground floor' }),
        }),
      );
    });
  });

  describe('unitWaitlist', () => {
    it('requires a unitId', async () => {
      await expect(service.unitWaitlist('')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns interested leads in waitlist order with positions', async () => {
      mockPrisma.leadUnitInterest.findMany.mockResolvedValue([
        { id: 'i1', note: null, createdAt: new Date('2026-05-01'), lead: { id: 'l1', name: 'Early Bird' } },
        { id: 'i2', note: 'backup', createdAt: new Date('2026-05-10'), lead: { id: 'l2', name: 'Later' } },
      ]);
      const res = await service.unitWaitlist('u1');
      expect(res).toHaveLength(2);
      expect(res[0]).toMatchObject({ position: 1, lead: { name: 'Early Bird' } });
      expect(res[1]).toMatchObject({ position: 2, note: 'backup' });
      expect(mockPrisma.leadUnitInterest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { unitId: 'u1', unit: { deletedAt: null } }, orderBy: { createdAt: 'asc' } }),
      );
    });
  });

  describe('removeInterest', () => {
    it('deletes by join-row id when it exists', async () => {
      mockPrisma.leadUnitInterest.findUnique.mockResolvedValue({ id: 'i1' });
      mockPrisma.leadUnitInterest.delete.mockResolvedValue({ id: 'i1' });
      await service.removeInterest('i1');
      expect(mockPrisma.leadUnitInterest.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
    });

    it('throws NotFound when the interest does not exist', async () => {
      mockPrisma.leadUnitInterest.findUnique.mockResolvedValue(null);
      await expect(service.removeInterest('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.leadUnitInterest.delete).not.toHaveBeenCalled();
    });
  });
});


// ---------------------------------------------------------------------------
// findAll filters.
//
// These exist because `source` was a PHANTOM filter: the web hook's param type accepted
// it, the controller never forwarded it, and the service never read it — so filtering by
// source silently returned EVERY lead. A filter that quietly widens its result set is
// worse than a missing one, because the UI looks like it worked. The last test in this
// block is the general guard against that shape of bug recurring on any filter.
// ---------------------------------------------------------------------------
describe('LeadsService.findAll — filters', () => {
  let service: LeadsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lead.findMany.mockResolvedValue([]);
  });

  const whereOf = () => mockPrisma.lead.findMany.mock.calls[0][0].where;

  it('narrows by source', async () => {
    await service.findAll({ source: 'LOOPNET' });
    expect(whereOf().source).toBe('LOOPNET');
  });

  it('rejects an unknown source instead of returning everything', async () => {
    await expect(service.findAll({ source: 'NOT_A_SOURCE' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.lead.findMany).not.toHaveBeenCalled();
  });

  it('narrows by via', async () => {
    await service.findAll({ via: 'FAVORITED' });
    expect(whereOf().via).toBe('FAVORITED');
  });

  it('treats followUpBefore as an inclusive upper bound and excludes undated leads', async () => {
    await service.findAll({ followUpBefore: '2026-09-30' });
    expect(whereOf().followUpDate).toEqual({ not: null, lte: new Date('2026-09-30') });
  });

  it('rejects an unparseable followUpBefore', async () => {
    await expect(service.findAll({ followUpBefore: 'soon' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies campaignId — the filter the UI could not reach', async () => {
    await service.findAll({ campaignId: 'c1' });
    expect(whereOf().campaignId).toBe('c1');
  });

  it('adds no narrowing key when a filter is absent', async () => {
    await service.findAll({});
    const where = whereOf();
    for (const key of ['source', 'via', 'followUpDate', 'campaignId', 'status', 'brokerId']) {
      expect(where[key]).toBeUndefined();
    }
  });
});


// ---------------------------------------------------------------------------
// Call tracking.
//
// Built on LeadActivity rather than a new table — it already records type/note/author,
// and a second store for calls would immediately disagree with the timeline. The one
// thing it lacked was WHEN IT HAPPENED as distinct from when it was typed.
// ---------------------------------------------------------------------------
describe('LeadsService — activities and call history', () => {
  let service: LeadsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lead.findUnique.mockResolvedValue({ id: 'l1', name: 'Rahul' });
    mockPrisma.lead.update.mockResolvedValue({});
    mockPrisma.leadActivity.create.mockResolvedValue({ id: 'a1' });
  });

  describe('addActivity — back-dating', () => {
    it('omits occurredAt entirely when none is given, so the column default applies', async () => {
      await service.addActivity('l1', 'u1', 'CALL' as any, 'rang them');
      const { data } = mockPrisma.leadActivity.create.mock.calls[0][0];
      expect(data).not.toHaveProperty('occurredAt');
    });

    it('records a call against the day it actually happened', async () => {
      await service.addActivity('l1', 'u1', 'CALL' as any, 'rang them', '2026-09-15T12:00:00.000Z');
      const { data } = mockPrisma.leadActivity.create.mock.calls[0][0];
      expect(data.occurredAt).toEqual(new Date('2026-09-15T12:00:00.000Z'));
    });

    it('refuses a future date — a call cannot have happened tomorrow', async () => {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      await expect(service.addActivity('l1', 'u1', 'CALL' as any, 'x', tomorrow))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.leadActivity.create).not.toHaveBeenCalled();
    });

    it('rejects an unparseable date rather than storing Invalid Date', async () => {
      await expect(service.addActivity('l1', 'u1', 'CALL' as any, 'x', 'last tuesday'))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getActivities', () => {
    it('orders by when it HAPPENED, so a back-dated call sorts into the past', async () => {
      mockPrisma.leadActivity.findMany.mockResolvedValue([]);
      await service.getActivities('l1');
      const { orderBy } = mockPrisma.leadActivity.findMany.mock.calls[0][0];
      expect(orderBy[0]).toEqual({ occurredAt: 'desc' });
    });
  });

  describe('getCalls', () => {
    const act = (type: string, occurredAt: string, note = 'n') => ({
      id: `${type}-${occurredAt}`, type, note,
      occurredAt: new Date(occurredAt), createdByUser: { name: 'Priya' },
    });

    it('counts only calls, but dates every activity for the calendar', async () => {
      mockPrisma.leadActivity.findMany.mockResolvedValue([
        act('CALL', '2026-09-18T12:00:00Z', 'asked for the floor plan'),
        act('EMAIL', '2026-09-18T13:00:00Z'),
        act('CALL', '2026-09-12T12:00:00Z'),
      ]);
      const res = await service.getCalls('l1');
      expect(res.callCount).toBe(2);
      // toMatchObject, not toEqual: byDate also carries `items` for the calendar hover,
      // and pinning the exact shape here made adding that a test failure rather than a
      // decision.
      expect(res.byDate['2026-09-18']).toMatchObject({ calls: 1, total: 2 });
      expect(res.byDate['2026-09-12']).toMatchObject({ calls: 1, total: 1 });
    });

    it('carries each day\u2019s type and note, so hovering a date says WHAT happened', async () => {
      mockPrisma.leadActivity.findMany.mockResolvedValue([
        act('CALL', '2026-09-18T12:00:00Z', 'asked for the floor plan'),
        act('EMAIL', '2026-09-18T13:00:00Z', 'sent the brochure'),
      ]);
      const res = await service.getCalls('l1');
      expect(res.byDate['2026-09-18'].items).toEqual([
        { type: 'CALL', note: 'asked for the floor plan', by: 'Priya' },
        { type: 'EMAIL', note: 'sent the brochure', by: 'Priya' },
      ]);
    });

    it('returns the most recent call with its note', async () => {
      mockPrisma.leadActivity.findMany.mockResolvedValue([
        act('CALL', '2026-09-18T12:00:00Z', 'asked for the floor plan'),
        act('CALL', '2026-09-12T12:00:00Z', 'older'),
      ]);
      const res = await service.getCalls('l1');
      expect(res.lastCall?.note).toBe('asked for the floor plan');
      expect(res.lastCall?.by).toBe('Priya');
    });

    it('reports no calls rather than throwing when there are none', async () => {
      mockPrisma.leadActivity.findMany.mockResolvedValue([act('NOTE', '2026-09-18T12:00:00Z')]);
      const res = await service.getCalls('l1');
      expect(res.callCount).toBe(0);
      expect(res.lastCall).toBeNull();
    });
  });

  describe('withCallSummary (via findAll)', () => {
    it('uses two aggregate queries, not one per lead', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }]);
      mockPrisma.leadActivity.groupBy.mockResolvedValue([{ leadId: 'l1', _count: { _all: 4 } }]);
      mockPrisma.leadActivity.findMany.mockResolvedValue([
        { leadId: 'l1', occurredAt: new Date('2026-09-18T12:00:00Z'), note: 'latest' },
      ]);
      const res: any[] = await service.findAll({});
      expect(mockPrisma.leadActivity.groupBy).toHaveBeenCalledTimes(1);
      expect(mockPrisma.leadActivity.findMany).toHaveBeenCalledTimes(1);
      expect(res.find((l) => l.id === 'l1').callCount).toBe(4);
      expect(res.find((l) => l.id === 'l1').lastCall.note).toBe('latest');
    });

    it('reports zero for leads that were never called, not undefined', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([{ id: 'l2' }]);
      mockPrisma.leadActivity.groupBy.mockResolvedValue([]);
      mockPrisma.leadActivity.findMany.mockResolvedValue([]);
      const res: any[] = await service.findAll({});
      expect(res[0].callCount).toBe(0);
      expect(res[0].lastCall).toBeNull();
    });

    it('skips the aggregate queries entirely on an empty list', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([]);
      await service.findAll({});
      expect(mockPrisma.leadActivity.groupBy).not.toHaveBeenCalled();
    });

    it('takes the latest call per lead via a distinct read', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([{ id: 'l1' }]);
      mockPrisma.leadActivity.groupBy.mockResolvedValue([{ leadId: 'l1', _count: { _all: 2 } }]);
      mockPrisma.leadActivity.findMany.mockResolvedValue([]);
      await service.findAll({});
      const args = mockPrisma.leadActivity.findMany.mock.calls[0][0];
      // leadId must lead the ordering or Postgres cannot use DISTINCT ON.
      expect(args.distinct).toEqual(['leadId']);
      expect(args.orderBy[0]).toEqual({ leadId: 'asc' });
      expect(args.orderBy[1]).toEqual({ occurredAt: 'desc' });
    });
  });
});


// ---------------------------------------------------------------------------
// Lead discussion thread (R14).
//
// Conversation ABOUT a lead, separate from the activity log which records what was DONE
// to it. Mentions reuse the shared resolveMentions() parser — these assert the wiring,
// not the parsing (mentions.spec.ts already covers that).
// ---------------------------------------------------------------------------
describe('LeadsService — discussion thread', () => {
  let service: LeadsService;

  const ROSTER = [
    { id: 'u-sarah', name: 'Sarah Chen', email: 'sarah@prime.dev' },
    { id: 'u-raj', name: 'Raj Patel', email: 'raj@prime.dev' },
    { id: 'author', name: 'Priya', email: 'priya@prime.dev' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.lead.findUnique.mockResolvedValue({ id: 'l1', name: 'Rahul' });
    mockPrisma.leadComment.create.mockResolvedValue({ id: 'c1' });
    mockPrisma.user.findMany.mockResolvedValue(ROSTER);
  });

  describe('addComment', () => {
    it('rejects an empty body', async () => {
      await expect(service.addComment('l1', 'author', '   '))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.leadComment.create).not.toHaveBeenCalled();
    });

    it('trims before storing', async () => {
      await service.addComment('l1', 'author', '  needs a callback  ');
      expect(mockPrisma.leadComment.create.mock.calls[0][0].data.content).toBe('needs a callback');
    });

    it('notifies everyone named in the body', async () => {
      await service.addComment('l1', 'author', '@Sarah Chen and @Raj Patel can one of you call?');
      expect(mockNotifications.notifyLeadCommentMention).toHaveBeenCalledWith(
        expect.objectContaining({ mentionedUserIds: ['u-sarah', 'u-raj'], leadName: 'Rahul' }));
    });

    it('stays silent when nobody is mentioned', async () => {
      await service.addComment('l1', 'author', 'no mentions here');
      expect(mockNotifications.notifyLeadCommentMention).not.toHaveBeenCalled();
    });

    it('still posts when the notification blows up — the comment is the user’s work', async () => {
      mockNotifications.notifyLeadCommentMention.mockRejectedValueOnce(new Error('smtp down'));
      await expect(service.addComment('l1', 'author', '@Sarah Chen look')).resolves.toBeDefined();
      expect(mockPrisma.leadComment.create).toHaveBeenCalled();
    });

    it('offers only active users as mention candidates', async () => {
      await service.addComment('l1', 'author', '@Sarah Chen');
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }));
    });
  });

  describe('updateComment / deleteComment — author only', () => {
    beforeEach(() => {
      mockPrisma.leadComment.findUnique.mockResolvedValue({ id: 'c1', authorId: 'author' });
      mockPrisma.leadComment.update.mockResolvedValue({ id: 'c1' });
      mockPrisma.leadComment.delete.mockResolvedValue({ id: 'c1' });
    });

    it('lets the author edit, and stamps editedAt', async () => {
      await service.updateComment('c1', 'author', 'revised');
      const { data } = mockPrisma.leadComment.update.mock.calls[0][0];
      expect(data.content).toBe('revised');
      expect(data.editedAt).toBeInstanceOf(Date);
    });

    it('refuses to let someone else rewrite your words', async () => {
      await expect(service.updateComment('c1', 'someone-else', 'sneaky'))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.leadComment.update).not.toHaveBeenCalled();
    });

    it('refuses to let someone else delete your words', async () => {
      await expect(service.deleteComment('c1', 'someone-else'))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.leadComment.delete).not.toHaveBeenCalled();
    });

    it('404s on a missing comment rather than silently succeeding', async () => {
      mockPrisma.leadComment.findUnique.mockResolvedValue(null);
      await expect(service.deleteComment('nope', 'author')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects editing to an empty body', async () => {
      await expect(service.updateComment('c1', 'author', '  '))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getComments', () => {
    it('reads oldest first — a conversation is read top to bottom', async () => {
      mockPrisma.leadComment.findMany.mockResolvedValue([]);
      await service.getComments('l1');
      expect(mockPrisma.leadComment.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
    });
  });
});
