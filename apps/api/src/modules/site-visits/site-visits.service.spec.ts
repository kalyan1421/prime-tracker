import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SiteVisitsService } from './site-visits.service';

const mockPrisma: any = {
  lead: { findUnique: jest.fn(), update: jest.fn() },
  user: { findUnique: jest.fn() },
  siteVisit: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  customOption: { findMany: jest.fn() },
  leadActivity: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockNotifications: any = {
  notifySiteVisitRequested: jest.fn(),
  notifySiteVisitDecided: jest.fn(),
  notifySiteVisitRescheduled: jest.fn(),
};

const POLICY = { minNoticeHours: 6, slotMinutes: 60, dayStartMin: 540, dayEndMin: 1080, missedGraceHours: 2 };
const mockAvailability: any = { policy: jest.fn().mockResolvedValue(POLICY) };

const make = () => new SiteVisitsService(mockPrisma, mockNotifications, mockAvailability);

/** A time comfortably outside the 6h notice window. */
const wellAhead = () => new Date(Date.now() + 48 * 3_600_000).toISOString();

function visit(over: Record<string, any> = {}) {
  return {
    id: 'v1', leadId: 'l1', projectId: 'p1', hostId: 'h1', requestedById: 'r1',
    startsAt: new Date('2026-10-01T15:00:00Z'), endsAt: new Date('2026-10-01T16:00:00Z'),
    timezone: 'America/Chicago', status: 'REQUESTED', unitId: null, buildingId: null,
    decisionNote: null, requestNote: null, completedAt: null,
    lead: { id: 'l1', name: 'Rahul' }, unit: null, building: null,
    ...over,
  };
}

describe('SiteVisitsService', () => {
  let service: SiteVisitsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = make();
    mockAvailability.policy.mockResolvedValue(POLICY);
    mockPrisma.user.findUnique.mockResolvedValue({ name: 'Priya' });
    mockPrisma.$transaction.mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg));
  });

  describe('create — the notice period and the slot race', () => {
    beforeEach(() => {
      mockPrisma.lead.findUnique.mockResolvedValue({
        id: 'l1', name: 'Rahul', projectId: 'p1', unitId: 'u1', buildingId: null, status: 'NEW',
      });
      mockPrisma.siteVisit.create.mockResolvedValue(visit());
    });

    it('refuses a slot inside the configured notice period', async () => {
      const inTwoHours = new Date(Date.now() + 2 * 3_600_000).toISOString();
      await expect(service.create({ leadId: 'l1', hostId: 'h1', startsAt: inTwoHours }, 'r1'))
        .rejects.toThrow(/6 hours/);
    });

    it('honours a notice period an admin has changed, without a deploy', async () => {
      mockAvailability.policy.mockResolvedValue({ ...POLICY, minNoticeHours: 0 });
      const soon = new Date(Date.now() + 10 * 60_000).toISOString();
      await expect(service.create({ leadId: 'l1', hostId: 'h1', startsAt: soon }, 'r1')).resolves.toBeDefined();
    });

    it('has NO upper horizon — a slot months out is bookable', async () => {
      const farOut = new Date(Date.now() + 240 * 86_400_000).toISOString();
      await expect(service.create({ leadId: 'l1', hostId: 'h1', startsAt: farOut }, 'r1')).resolves.toBeDefined();
    });

    it('translates the unique-index race into a 409 with a usable message', async () => {
      mockPrisma.siteVisit.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.create({ leadId: 'l1', hostId: 'h1', startsAt: wellAhead() }, 'r1'))
        .rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects targeting a unit and a building at once', async () => {
      await expect(service.create(
        { leadId: 'l1', hostId: 'h1', startsAt: wellAhead(), unitId: 'u1', buildingId: 'b1' }, 'r1',
      )).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults the property to whatever the lead is already attached to', async () => {
      await service.create({ leadId: 'l1', hostId: 'h1', startsAt: wellAhead() }, 'r1');
      expect(mockPrisma.siteVisit.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ unitId: 'u1', buildingId: null }) }));
    });

    it('throws NotFound for a missing lead', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(null);
      await expect(service.create({ leadId: 'nope', hostId: 'h1', startsAt: wellAhead() }, 'r1'))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('notifies leadership that a decision is waiting', async () => {
      await service.create({ leadId: 'l1', hostId: 'h1', startsAt: wellAhead() }, 'r1');
      expect(mockNotifications.notifySiteVisitRequested).toHaveBeenCalled();
    });
  });

  describe('decide', () => {
    beforeEach(() => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue(visit());
      mockPrisma.siteVisit.update.mockResolvedValue(visit({ status: 'CONFIRMED' }));
      mockPrisma.lead.findUnique.mockResolvedValue({ status: 'CONTACTED' });
      mockPrisma.customOption.findMany.mockResolvedValue([]);
    });

    it('requires a reason when rejecting', async () => {
      await expect(service.decide('v1', false, 'f1', '  ')).rejects.toThrow(/reason/i);
    });

    it('allows confirming without one', async () => {
      await expect(service.decide('v1', true, 'f1')).resolves.toBeDefined();
    });

    it('refuses to decide a visit that is already decided', async () => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue(visit({ status: 'CONFIRMED' }));
      await expect(service.decide('v1', true, 'f1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('tells the requester, not the whole company', async () => {
      await service.decide('v1', true, 'f1');
      expect(mockNotifications.notifySiteVisitDecided).toHaveBeenCalledWith(
        expect.objectContaining({ requestedById: 'r1', confirmed: true }));
    });
  });

  // The client asked for auto-advance while naming its risk ("overwrites a status the rep
  // may have deliberately set"). These lock in the resolution: forwards only.
  describe('auto-advance on confirm — directional', () => {
    const arrange = (leadStatus: string) => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue(visit());
      mockPrisma.siteVisit.update.mockResolvedValue(visit({ status: 'CONFIRMED' }));
      mockPrisma.lead.findUnique.mockResolvedValue({ status: leadStatus });
      mockPrisma.customOption.findMany.mockResolvedValue([]);
    };
    const advanced = () => mockPrisma.lead.update.mock.calls.length > 0;

    it.each(['NEW', 'POTENTIAL', 'CONTACTED', 'QUALIFIED'])('advances from %s', async (st) => {
      arrange(st);
      await service.decide('v1', true, 'f1');
      expect(advanced()).toBe(true);
    });

    it.each(['PROPOSAL_SENT', 'NEGOTIATING'])('never moves %s backwards', async (st) => {
      arrange(st);
      await service.decide('v1', true, 'f1');
      expect(advanced()).toBe(false);
    });

    it.each(['CONVERTED', 'LOST', 'DEAD'])('never revives a %s lead', async (st) => {
      arrange(st);
      await service.decide('v1', true, 'f1');
      expect(advanced()).toBe(false);
    });

    it('does nothing on a status missing from the catalogue rather than guessing', async () => {
      arrange('SOMETHING_CUSTOM');
      mockPrisma.customOption.findMany.mockResolvedValue(
        [{ value: 'NEW' }, { value: 'SITE_VISIT' }, { value: 'CONVERTED' }]);
      await service.decide('v1', true, 'f1');
      expect(advanced()).toBe(false);
    });

    it('follows the live catalogue order, not the fallback', async () => {
      // An admin who puts SITE_VISIT first makes every other status downstream of it.
      arrange('NEW');
      mockPrisma.customOption.findMany.mockResolvedValue(
        [{ value: 'SITE_VISIT' }, { value: 'NEW' }]);
      await service.decide('v1', true, 'f1');
      expect(advanced()).toBe(false);
    });

    it('records WHY the status moved', async () => {
      arrange('NEW');
      await service.decide('v1', true, 'f1');
      expect(mockPrisma.leadActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'STATUS_CHANGE', createdBy: 'f1' }),
        }));
    });

    it('does not advance on rejection', async () => {
      arrange('NEW');
      mockPrisma.siteVisit.update.mockResolvedValue(visit({ status: 'REJECTED' }));
      await service.decide('v1', false, 'f1', 'not available');
      expect(advanced()).toBe(false);
    });
  });

  describe('reschedule — history is appended, never restated', () => {
    beforeEach(() => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue(visit({ status: 'CONFIRMED' }));
      mockPrisma.siteVisit.update.mockResolvedValue(visit({ status: 'RESCHEDULED' }));
      mockPrisma.siteVisit.create.mockResolvedValue(visit({ id: 'v2', rescheduledFromId: 'v1' }));
    });

    it('closes the original and links the replacement back to it', async () => {
      await service.reschedule('v1', { startsAt: wellAhead(), reason: 'host away' }, 'r1');
      expect(mockPrisma.siteVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'v1' }, data: expect.objectContaining({ status: 'RESCHEDULED' }) }));
      expect(mockPrisma.siteVisit.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ rescheduledFromId: 'v1', status: 'REQUESTED' }) }));
    });

    it('needs confirming again — the replacement is REQUESTED, not CONFIRMED', async () => {
      await service.reschedule('v1', { startsAt: wellAhead() }, 'r1');
      const { data } = mockPrisma.siteVisit.create.mock.calls[0][0];
      expect(data.status).toBe('REQUESTED');
    });

    it.each(['RESCHEDULED', 'COMPLETED', 'CANCELLED'])('refuses to reschedule a %s visit', async (st) => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue(visit({ status: st }));
      await expect(service.reschedule('v1', { startsAt: wellAhead() }, 'r1'))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('applies the notice period to the new time too', async () => {
      const soon = new Date(Date.now() + 60_000).toISOString();
      await expect(service.reschedule('v1', { startsAt: soon }, 'r1')).rejects.toThrow(/6 hours/);
    });

    it('tells both the host and the original requester', async () => {
      await service.reschedule('v1', { startsAt: wellAhead() }, 'r9');
      const { userIds } = mockNotifications.notifySiteVisitRescheduled.mock.calls[0][0];
      expect(userIds).toEqual(expect.arrayContaining(['h1', 'r1', 'r9']));
    });
  });

  describe('recordOutcome', () => {
    beforeEach(() => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue(visit({ status: 'CONFIRMED' }));
      mockPrisma.siteVisit.update.mockResolvedValue(visit({ status: 'COMPLETED' }));
    });

    it('writes the visit onto the lead timeline, where reps actually read history', async () => {
      await service.recordOutcome('v1', { result: 'COMPLETED', note: 'liked the corner unit' }, 'r1');
      expect(mockPrisma.leadActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'SITE_VISIT', leadId: 'l1' }) }));
    });

    it('rejects an outcome that is neither completed nor a no-show', async () => {
      await expect(service.recordOutcome('v1', { result: 'MAYBE' } as any, 'r1'))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('only applies to a confirmed visit', async () => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue(visit({ status: 'REQUESTED' }));
      await expect(service.recordOutcome('v1', { result: 'COMPLETED' }, 'r1'))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('attention queue', () => {
    it('gives approvers everything awaiting a decision', async () => {
      mockPrisma.siteVisit.findMany.mockResolvedValue([visit()]);
      const res = await service.attention({ userId: 'f1', canApprove: true });
      expect(res.role).toBe('approver');
      expect(mockPrisma.siteVisit.findMany.mock.calls[0][0].where.status).toBe('REQUESTED');
    });

    it('keeps REJECTED visits in the asker’s queue so they do not silently vanish', async () => {
      mockPrisma.siteVisit.findMany.mockResolvedValue([]);
      await service.attention({ userId: 'r1', canApprove: false });
      const { where } = mockPrisma.siteVisit.findMany.mock.calls[0][0];
      expect(where.requestedById).toBe('r1');
      expect(where.OR).toEqual(expect.arrayContaining([{ status: 'REJECTED' }]));
    });
  });
});


// ---------------------------------------------------------------------------
// Notification deep links.
//
// Every site-visit notification points at the leads page. They previously carried only
// `?visit=<id>`, which LeadsPage did not read — so the attention card, the confirm/reject
// alerts and the mention flow all landed on a bare list with nothing selected. The link
// must carry the LEAD id, because that is what the page selects by.
// ---------------------------------------------------------------------------
describe('SiteVisitsService — notification deep links', () => {
  let service: SiteVisitsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = make();
    mockAvailability.policy.mockResolvedValue(POLICY);
    mockPrisma.user.findUnique.mockResolvedValue({ name: 'Priya' });
    mockPrisma.$transaction.mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg));
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: 'l1', name: 'Rahul', projectId: 'p1', unitId: null, buildingId: null, status: 'NEW',
    });
    mockPrisma.customOption.findMany.mockResolvedValue([]);
  });

  const linkOf = (mock: jest.Mock) => mock.mock.calls[0][0].link as string;

  it('carries the lead id when a visit is requested', async () => {
    mockPrisma.siteVisit.create.mockResolvedValue(visit());
    await service.create({ leadId: 'l1', hostId: 'h1', startsAt: wellAhead() }, 'r1');
    expect(linkOf(mockNotifications.notifySiteVisitRequested)).toContain('lead=l1');
  });

  it('carries the lead id on a decision', async () => {
    mockPrisma.siteVisit.findUnique.mockResolvedValue(visit());
    mockPrisma.siteVisit.update.mockResolvedValue(visit({ status: 'CONFIRMED' }));
    await service.decide('v1', true, 'f1');
    expect(linkOf(mockNotifications.notifySiteVisitDecided)).toContain('lead=l1');
  });

  it('carries the lead id on a reschedule', async () => {
    mockPrisma.siteVisit.findUnique.mockResolvedValue(visit({ status: 'CONFIRMED' }));
    mockPrisma.siteVisit.update.mockResolvedValue(visit({ status: 'RESCHEDULED' }));
    mockPrisma.siteVisit.create.mockResolvedValue(visit({ id: 'v2', rescheduledFromId: 'v1' }));
    await service.reschedule('v1', { startsAt: wellAhead() }, 'r1');
    expect(linkOf(mockNotifications.notifySiteVisitRescheduled)).toContain('lead=l1');
  });
});
