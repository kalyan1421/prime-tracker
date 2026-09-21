import { BadRequestException } from '@nestjs/common';
import { CalendlyService } from './calendly.service';

const mockPrisma: any = {
  lead: { findFirst: jest.fn(), create: jest.fn() },
  user: { findFirst: jest.fn() },
  project: { findFirst: jest.fn() },
  siteVisit: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  leadActivity: { create: jest.fn(), findFirst: jest.fn() },
};
const mockConfig: any = { get: jest.fn(() => 'whsec_key') };
const make = () => new CalendlyService(mockPrisma, mockConfig);

const booking = (over: Record<string, any> = {}) => ({
  uri: 'https://api.calendly.com/invitees/abc',
  name: 'Rahul Sharma',
  email: 'Rahul@Example.com',
  tracking: { utm_source: 'meta', utm_campaign: 'diwali', utm_medium: 'cpc' },
  scheduled_event: {
    uri: 'https://api.calendly.com/events/e1',
    start_time: '2027-03-01T15:00:00.000Z',
    end_time: '2027-03-01T16:00:00.000Z',
    event_memberships: [{ user_email: 'founder@prime.dev' }],
  },
  ...over,
});

describe('CalendlyService', () => {
  let service: CalendlyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = make();
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'host-1' });
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    mockPrisma.siteVisit.findUnique.mockResolvedValue(null);
    mockPrisma.siteVisit.create.mockResolvedValue({ id: 'v1' });
    mockPrisma.leadActivity.create.mockResolvedValue({});
    mockPrisma.leadActivity.findFirst.mockResolvedValue(null);
    mockPrisma.lead.create.mockResolvedValue({ id: 'l-new', projectId: 'p1', createdBy: 'host-1' });
  });

  describe('invitee.created', () => {
    it('attaches to an EXISTING lead matched on email, rather than duplicating it', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'l-existing', projectId: 'p1', createdBy: 'u1' });
      const res = await service.handleEvent({ event: 'invitee.created', payload: booking() });
      expect(res.status).toBe('lead-matched');
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
      expect(mockPrisma.siteVisit.create.mock.calls[0][0].data.leadId).toBe('l-existing');
    });

    it('matches case-insensitively — inboxes are not case sensitive', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await service.handleEvent({ event: 'invitee.created', payload: booking() });
      expect(mockPrisma.lead.findFirst.mock.calls[0][0].where.email)
        .toEqual({ equals: 'rahul@example.com', mode: 'insensitive' });
    });

    it('creates a lead when nobody matches, carrying the UTM attribution', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      const res = await service.handleEvent({ event: 'invitee.created', payload: booking() });
      expect(res.status).toBe('lead-created');
      const { data } = mockPrisma.lead.create.mock.calls[0][0];
      expect(data).toMatchObject({
        utmSource: 'meta', utmCampaign: 'diwali', utmMedium: 'cpc', status: 'SITE_VISIT',
      });
    });

    it('lands the visit already CONFIRMED — Calendly told the lead it was happening', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'l1', projectId: 'p1', createdBy: 'u1' });
      await service.handleEvent({ event: 'invitee.created', payload: booking() });
      const { data } = mockPrisma.siteVisit.create.mock.calls[0][0];
      expect(data).toMatchObject({ status: 'CONFIRMED', source: 'CALENDLY' });
      expect(data.externalId).toBe('https://api.calendly.com/invitees/abc');
    });

    it('is idempotent — a retried delivery does not create a second visit', async () => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue({ id: 'v-existing' });
      const res = await service.handleEvent({ event: 'invitee.created', payload: booking() });
      expect(res).toEqual({ status: 'duplicate', visitId: 'v-existing' });
      expect(mockPrisma.siteVisit.create).not.toHaveBeenCalled();
    });

    it('records the booking on the lead when the slot CLASHES, rather than losing it', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'l1', projectId: 'p1', createdBy: 'u1' });
      mockPrisma.siteVisit.create.mockRejectedValue({ code: 'P2002' });
      const res = await service.handleEvent({ event: 'invitee.created', payload: booking() });
      expect(res.status).toBe('conflict');
      expect(mockPrisma.leadActivity.create).toHaveBeenCalled();
    });

    it('still creates the lead when no host user matches', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      // resolveHost finds nobody; findOrCreateLead still needs a system user.
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(null)          // resolveHost
        .mockResolvedValue({ id: 'sys-1' });  // system user for createdBy
      const res = await service.handleEvent({ event: 'invitee.created', payload: booking() });
      expect(res.status).toBe('lead-only');
      expect(mockPrisma.siteVisit.create).not.toHaveBeenCalled();
      expect(mockPrisma.leadActivity.create).toHaveBeenCalled();
    });

    it('writes the no-host note only ONCE across redeliveries', async () => {
      // This path creates no visit, so the unique externalId cannot dedupe it — without
      // the marker check a retry appends an identical line to the timeline every time.
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'l1', projectId: 'p1', createdBy: 'u1' });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.leadActivity.findFirst.mockResolvedValue({ id: 'already-noted' });
      const res = await service.handleEvent({ event: 'invitee.created', payload: booking() });
      expect(res.status).toBe('lead-only');
      expect(mockPrisma.leadActivity.create).not.toHaveBeenCalled();
    });

    it('tags the no-host note with the booking id so the check has something to match', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'l1', projectId: 'p1', createdBy: 'u1' });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await service.handleEvent({ event: 'invitee.created', payload: booking() });
      expect(mockPrisma.leadActivity.create.mock.calls[0][0].data.note)
        .toContain('[calendly:https://api.calendly.com/invitees/abc]');
    });

    it('rejects a booking with no start time', async () => {
      await expect(service.handleEvent({
        event: 'invitee.created',
        payload: booking({ scheduled_event: { event_memberships: [{ user_email: 'f@p.dev' }] } }),
      })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('invitee.canceled', () => {
    it('cancels the matching visit', async () => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue({ id: 'v1', status: 'CONFIRMED', leadId: 'l1', requestedById: 'u1' });
      mockPrisma.siteVisit.update.mockResolvedValue({});
      const res = await service.handleEvent({
        event: 'invitee.canceled',
        payload: booking({ cancellation: { reason: 'double booked' } }),
      });
      expect(res.status).toBe('cancelled');
      expect(mockPrisma.siteVisit.update.mock.calls[0][0].data.status).toBe('CANCELLED');
    });

    it('ignores a cancellation for something we never imported', async () => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue(null);
      const res = await service.handleEvent({ event: 'invitee.canceled', payload: booking() });
      expect(res.status).toBe('ignored');
    });
  });

  describe('invitee_no_show.created', () => {
    it('sets completedAt so the missed-visit sweep stops chasing it', async () => {
      mockPrisma.siteVisit.findUnique.mockResolvedValue({ id: 'v1', leadId: 'l1', requestedById: 'u1', completedAt: null });
      mockPrisma.siteVisit.update.mockResolvedValue({});
      const res = await service.handleEvent({
        event: 'invitee_no_show.created',
        payload: { invitee: { uri: 'https://api.calendly.com/invitees/abc' } },
      });
      expect(res.status).toBe('no-show');
      const { data } = mockPrisma.siteVisit.update.mock.calls[0][0];
      expect(data.status).toBe('NO_SHOW');
      expect(data.completedAt).toBeInstanceOf(Date);
    });
  });

  it('acknowledges unknown event types instead of making Calendly retry forever', async () => {
    const res = await service.handleEvent({ event: 'something.new', payload: { uri: 'x' } });
    expect(res.status).toBe('ignored');
  });

  it('rejects a payload with no body', async () => {
    await expect(service.handleEvent({ event: 'invitee.created' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
