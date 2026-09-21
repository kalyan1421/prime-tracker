import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadSource, LeadActivityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Calendly import.
 *
 * IMPORT-ONLY (client, 2026-09-22): the tracker remains the scheduler and the source of
 * truth for availability. Calendly bookings flow IN so that a viewing arranged outside the
 * app still appears on the lead's timeline and on the calendar — they do not flow out, and
 * Calendly is never asked when somebody is free.
 *
 * That direction is what makes this safe. An imported visit lands already CONFIRMED and
 * therefore occupies its slot against the partial unique index on (hostId, startsAt), so
 * the tracker will not go on to offer the same hour to somebody else.
 */
@Injectable()
export class CalendlyService {
  private readonly logger = new Logger(CalendlyService.name);

  constructor(private prisma: PrismaService, private config: ConfigService) {}

  get signingKey(): string | undefined {
    return this.config.get<string>('CALENDLY_WEBHOOK_SIGNING_KEY');
  }

  isConfigured(): boolean {
    return !!this.signingKey;
  }

  /**
   * Turn one webhook delivery into tracker records.
   *
   * Returns a verdict rather than throwing on the ordinary "nothing to do" outcomes:
   * a webhook endpoint that 500s makes the provider retry forever, so only a genuinely
   * malformed payload is an error.
   */
  async handleEvent(payload: any): Promise<{ status: string; detail?: string; visitId?: string }> {
    const event: string = payload?.event ?? '';
    const invitee = payload?.payload;
    if (!invitee) throw new BadRequestException('Missing payload');

    switch (event) {
      case 'invitee.created':
        return this.onBooked(invitee);
      case 'invitee.canceled':
        return this.onCanceled(invitee);
      case 'invitee_no_show.created':
        return this.onNoShow(invitee);
      default:
        // Unknown events are acknowledged, not rejected — Calendly adds event types over
        // time and a 4xx would have it retry something we will never understand.
        return { status: 'ignored', detail: `unhandled event ${event || '(none)'}` };
    }
  }

  /** Calendly's UTM fields, mapped onto the columns Lead already has for attribution. */
  private utmFrom(invitee: any) {
    const t = invitee?.tracking ?? {};
    return {
      utmSource: t.utm_source ?? null,
      utmMedium: t.utm_medium ?? null,
      utmCampaign: t.utm_campaign ?? null,
      utmContent: t.utm_content ?? null,
    };
  }

  /**
   * Match on email, create when new (client, 2026-09-22).
   *
   * Email is the only identifier both systems reliably share. Matching avoids a duplicate
   * lead for somebody already being worked; creating means a booking from a stranger still
   * lands somewhere rather than being dropped.
   */
  private async findOrCreateLead(invitee: any, projectId: string) {
    const email: string | undefined = invitee?.email?.trim()?.toLowerCase();
    const name: string = invitee?.name?.trim() || 'Calendly booking';

    if (email) {
      const existing = await this.prisma.lead.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, project: { deletedAt: null } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return { lead: existing, created: false };
    }

    const systemUser = await this.prisma.user.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!systemUser) throw new BadRequestException('No active user to attribute the import to');

    const lead = await this.prisma.lead.create({
      data: {
        projectId,
        name,
        email: email ?? null,
        phone: invitee?.text_reminder_number ?? null,
        // WEBSITE rather than a new enum value: Calendly is the booking surface, not the
        // origin. The real origin rides in on the utm_* fields below.
        source: LeadSource.WEBSITE,
        status: 'SITE_VISIT',
        notes: 'Created from a Calendly booking.',
        createdBy: systemUser.id,
        ...this.utmFrom(invitee),
      },
    });
    return { lead, created: true };
  }

  /** Which of our users hosted it, by the organiser's email. */
  private async resolveHost(invitee: any): Promise<string | null> {
    const emails: string[] = (invitee?.scheduled_event?.event_memberships ?? [])
      .map((m: any) => m?.user_email)
      .filter(Boolean);
    if (emails.length === 0) return null;
    const user = await this.prisma.user.findFirst({
      where: { email: { in: emails, mode: 'insensitive' }, isActive: true },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async onBooked(invitee: any) {
    const externalId: string | undefined = invitee?.uri;
    if (!externalId) throw new BadRequestException('Invitee has no uri');

    // Idempotency FIRST: providers retry, and a retry must not produce a second visit.
    const already = await this.prisma.siteVisit.findUnique({ where: { externalId } });
    if (already) return { status: 'duplicate', visitId: already.id };

    const ev = invitee?.scheduled_event ?? {};
    const startsAt = ev.start_time ? new Date(ev.start_time) : null;
    const endsAt = ev.end_time ? new Date(ev.end_time) : null;
    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Booking has no usable start time');
    }

    const hostId = await this.resolveHost(invitee);
    if (!hostId) {
      // Recorded, not thrown: the booking is real and the lead should still exist, but a
      // visit needs a host we can name. Surfaced as a lead activity so somebody sees it.
      this.logger.warn(`Calendly booking ${externalId} has no matching host user`);
    }

    const project = await this.prisma.project.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!project) throw new BadRequestException('No project to attach the booking to');

    const { lead, created } = await this.findOrCreateLead(invitee, project.id);

    // No host, no visit — but the lead and a timeline note still land, so the booking is
    // never silently lost.
    //
    // This path creates no SiteVisit, so the unique externalId cannot dedupe it. The note
    // carries the booking id instead and is written once: a redelivery would otherwise add
    // an identical line to the timeline every time.
    if (!hostId) {
      await this.noteOnLeadOnce(lead.id, lead.createdBy, externalId,
        `Calendly booking received for ${startsAt.toISOString()} but no matching host user was found. Link it manually.`);
      return { status: 'lead-only', detail: 'no matching host', visitId: undefined };
    }

    try {
      const visit = await this.prisma.siteVisit.create({
        data: {
          leadId: lead.id,
          projectId: lead.projectId,
          unitId: lead.unitId,
          buildingId: lead.unitId ? null : lead.buildingId,
          hostId,
          startsAt,
          endsAt: endsAt ?? new Date(startsAt.getTime() + 60 * 60_000),
          // Already agreed with the lead by Calendly — the Founder's confirm gate would be
          // asking permission for something already promised.
          status: 'CONFIRMED',
          source: 'CALENDLY',
          externalId,
          externalUrl: ev.uri ?? null,
          requestedById: lead.createdBy,
          requestNote: invitee?.name ? `Booked via Calendly by ${invitee.name}` : 'Booked via Calendly',
        },
      });
      await this.noteOnLead(lead.id, lead.createdBy,
        `Site visit booked via Calendly for ${startsAt.toISOString()}.`);
      return { status: created ? 'lead-created' : 'lead-matched', visitId: visit.id };
    } catch (e: any) {
      // The slot is already held by an internal booking. Import-only means the tracker
      // wins; the booking is recorded on the lead so a human can resolve the clash.
      if (e?.code === 'P2002') {
        await this.noteOnLead(lead.id, lead.createdBy,
          `Calendly booking for ${startsAt.toISOString()} CLASHES with an existing visit for that host. Resolve manually.`);
        return { status: 'conflict', detail: 'slot already held in the tracker' };
      }
      throw e;
    }
  }

  private async onCanceled(invitee: any) {
    const externalId: string | undefined = invitee?.uri;
    if (!externalId) throw new BadRequestException('Invitee has no uri');
    const visit = await this.prisma.siteVisit.findUnique({ where: { externalId } });
    if (!visit) return { status: 'ignored', detail: 'no matching visit' };
    if (visit.status === 'CANCELLED') return { status: 'duplicate', visitId: visit.id };

    await this.prisma.siteVisit.update({
      where: { id: visit.id },
      data: {
        status: 'CANCELLED',
        decisionNote: invitee?.cancellation?.reason
          ? `Cancelled in Calendly: ${invitee.cancellation.reason}`
          : 'Cancelled in Calendly',
        decidedAt: new Date(),
      },
    });
    await this.noteOnLead(visit.leadId, visit.requestedById, 'Calendly booking was cancelled.');
    return { status: 'cancelled', visitId: visit.id };
  }

  private async onNoShow(invitee: any) {
    const externalId: string | undefined = invitee?.invitee?.uri ?? invitee?.uri;
    if (!externalId) throw new BadRequestException('No invitee uri on the no-show payload');
    const visit = await this.prisma.siteVisit.findUnique({ where: { externalId } });
    if (!visit) return { status: 'ignored', detail: 'no matching visit' };
    if (visit.completedAt) return { status: 'duplicate', visitId: visit.id };

    await this.prisma.siteVisit.update({
      where: { id: visit.id },
      // completedAt is what stops the daily missed-visit sweep chasing it — a recorded
      // no-show is resolved, not outstanding.
      data: { status: 'NO_SHOW', completedAt: new Date(), outcomeNote: 'Marked a no-show in Calendly' },
    });
    await this.noteOnLead(visit.leadId, visit.requestedById, 'Lead did not attend the Calendly booking.');
    return { status: 'no-show', visitId: visit.id };
  }

  /**
   * Write a note at most once for a given external booking.
   *
   * Used on the paths that create no SiteVisit and therefore have no unique externalId to
   * collide on. The booking id is appended to the note so the check has something stable
   * to match, and so a human can trace the line back to Calendly.
   */
  private async noteOnLeadOnce(leadId: string, userId: string, externalId: string, note: string) {
    const marker = `[calendly:${externalId}]`;
    const existing = await this.prisma.leadActivity.findFirst({
      where: { leadId, note: { contains: marker } },
      select: { id: true },
    });
    if (existing) return;
    await this.noteOnLead(leadId, userId, `${note} ${marker}`);
  }

  /** The lead timeline is where reps read a lead's history, so imports must land there too. */
  private async noteOnLead(leadId: string, userId: string, note: string) {
    try {
      await this.prisma.leadActivity.create({
        data: { leadId, createdBy: userId, type: LeadActivityType.SITE_VISIT, note },
      });
    } catch (err) {
      this.logger.warn(`Could not write Calendly note to lead ${leadId}: ${err}`);
    }
  }
}
