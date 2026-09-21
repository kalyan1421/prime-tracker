import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma, LeadActivityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VisitAvailabilityService } from './visit-availability.service';
import { formatInZone } from './zoned-time';

/** Statuses that still occupy a slot. Must match the partial unique index in the migration. */
const ACTIVE = ['REQUESTED', 'CONFIRMED'];

/**
 * Lead statuses at or past SITE_VISIT, which auto-advance must never overwrite.
 * Resolved from the live lead_status catalogue rather than hardcoded — an admin adding a
 * stage should not silently break the guard. This list is only the fallback ordering.
 */
const FALLBACK_STATUS_ORDER = [
  'NEW', 'POTENTIAL', 'CONTACTED', 'QUALIFIED', 'SITE_VISIT',
  'PROPOSAL_SENT', 'NEGOTIATING', 'CONVERTED', 'LOST', 'DEAD',
];
/** Terminal statuses never advance, wherever they sort. */
const TERMINAL = new Set(['CONVERTED', 'LOST', 'DEAD']);

const VISIT_INCLUDE = {
  lead: { select: { id: true, name: true, phone: true, email: true, status: true, projectId: true } },
  project: { select: { id: true, name: true } },
  unit: { select: { id: true, unitNumber: true } },
  building: { select: { id: true, name: true } },
  host: { select: { id: true, name: true, avatarUrl: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.SiteVisitInclude;

@Injectable()
export class SiteVisitsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private availability: VisitAvailabilityService,
  ) {}

  private label(v: { startsAt: Date; timezone: string }) {
    return formatInZone(v.startsAt, v.timezone);
  }

  private propertyLabel(v: { unit?: { unitNumber: string } | null; building?: { name: string } | null }) {
    if (v.unit) return `Unit ${v.unit.unitNumber}`;
    if (v.building) return v.building.name;
    return null;
  }

  async findAll(params: {
    status?: string; hostId?: string; leadId?: string; requestedById?: string;
    from?: string; to?: string;
  } = {}) {
    const where: Prisma.SiteVisitWhereInput = { project: { deletedAt: null } };
    if (params.status) where.status = params.status;
    if (params.hostId) where.hostId = params.hostId;
    if (params.leadId) where.leadId = params.leadId;
    if (params.requestedById) where.requestedById = params.requestedById;
    if (params.from || params.to) {
      where.startsAt = {
        ...(params.from ? { gte: new Date(params.from) } : {}),
        ...(params.to ? { lte: new Date(params.to) } : {}),
      };
    }
    return this.prisma.siteVisit.findMany({
      where, include: VISIT_INCLUDE, orderBy: { startsAt: 'asc' },
    });
  }

  async findById(id: string) {
    const visit = await this.prisma.siteVisit.findUnique({ where: { id }, include: VISIT_INCLUDE });
    if (!visit) throw new NotFoundException('Site visit not found');
    return visit;
  }

  /**
   * The attention queue behind the dashboard card.
   *
   * Leadership gets everything awaiting a decision. Everyone else gets their OWN
   * outstanding work — pending requests, confirmed visits still to come, and rejected or
   * missed ones that need rebooking. A rejected request that vanishes from the asker's
   * view is the failure this card exists to prevent.
   */
  async attention(viewer: { userId: string; canApprove: boolean }) {
    const now = new Date();
    if (viewer.canApprove) {
      const pending = await this.prisma.siteVisit.findMany({
        where: { status: 'REQUESTED', project: { deletedAt: null } },
        include: VISIT_INCLUDE, orderBy: { startsAt: 'asc' },
      });
      return { role: 'approver' as const, pending, mine: [] as typeof pending };
    }
    const mine = await this.prisma.siteVisit.findMany({
      where: {
        requestedById: viewer.userId,
        project: { deletedAt: null },
        OR: [
          { status: { in: ACTIVE }, startsAt: { gte: now } },
          { status: 'REJECTED' },
          { status: 'CONFIRMED', startsAt: { lt: now }, completedAt: null },
        ],
      },
      include: VISIT_INCLUDE, orderBy: { startsAt: 'asc' },
    });
    return { role: 'requester' as const, pending: [] as typeof mine, mine };
  }

  /**
   * Book an open slot. The slot must still be open at the moment of writing, which is
   * checked twice on purpose: once here for a clear message, and once by the partial
   * unique index for the race the check cannot close.
   */
  async create(data: {
    leadId: string; hostId: string; startsAt: string; endsAt?: string;
    unitId?: string | null; buildingId?: string | null; requestNote?: string | null;
  }, requestedById: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: data.leadId },
      select: { id: true, name: true, projectId: true, unitId: true, buildingId: true, status: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    if (data.unitId && data.buildingId) {
      throw new BadRequestException('A visit can target either a unit or a building, not both');
    }

    const startsAt = new Date(data.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt must be a valid date-time');

    const policy = await this.availability.policy();
    const earliest = Date.now() + policy.minNoticeHours * 3_600_000;
    if (startsAt.getTime() < earliest) {
      throw new BadRequestException(
        `Site visits need at least ${policy.minNoticeHours} hours' notice`,
      );
    }

    const endsAt = data.endsAt
      ? new Date(data.endsAt)
      : new Date(startsAt.getTime() + policy.slotMinutes * 60_000);
    if (endsAt <= startsAt) throw new BadRequestException('The visit must end after it starts');

    // Default the property to whatever the lead is already attached to, so the common
    // case needs no extra input and cannot disagree with the lead.
    const unitId = data.unitId ?? (data.buildingId ? null : lead.unitId);
    const buildingId = data.buildingId ?? (data.unitId ? null : (unitId ? null : lead.buildingId));

    try {
      const created = await this.prisma.siteVisit.create({
        data: {
          leadId: lead.id,
          projectId: lead.projectId,
          unitId: unitId ?? null,
          buildingId: buildingId ?? null,
          hostId: data.hostId,
          startsAt,
          endsAt,
          status: 'REQUESTED',
          requestedById,
          requestNote: data.requestNote ?? null,
        },
        include: VISIT_INCLUDE,
      });

      const requester = await this.prisma.user.findUnique({
        where: { id: requestedById }, select: { name: true },
      });
      await this.notifications.notifySiteVisitRequested({
        visitId: created.id,
        projectId: created.projectId,
        leadName: created.lead?.name ?? 'Unnamed lead',
        propertyLabel: this.propertyLabel(created),
        whenLabel: this.label(created),
        requestedByName: requester?.name ?? null,
        note: created.requestNote,
        link: `/leads?lead=${created.leadId}&visit=${created.id}`,
      });
      return created;
    } catch (e: any) {
      // P2002 on the partial unique index = somebody took this slot between the check
      // above and this write. A generic 500 here would read as "the app is broken"; it is
      // an ordinary race with an obvious next step.
      if (e?.code === 'P2002') {
        throw new ConflictException('That slot was just taken — pick another time');
      }
      throw e;
    }
  }

  /**
   * Confirm or reject. Both are decisions, so they share a path: the difference is one
   * status, whether the slot returns to the pool, and whether the lead advances.
   */
  async decide(id: string, confirmed: boolean, decidedById: string, decisionNote?: string | null) {
    const visit = await this.findById(id);
    if (visit.status !== 'REQUESTED') {
      throw new BadRequestException(`This visit is already ${visit.status.toLowerCase()}`);
    }
    if (!confirmed && !decisionNote?.trim()) {
      // Same rule as BudgetRevision and the history-deletion gate: a decision that blocks
      // somebody's work without a stated reason is not auditable.
      throw new BadRequestException('Give a reason when rejecting a site visit');
    }

    const updated = await this.prisma.siteVisit.update({
      where: { id },
      data: {
        status: confirmed ? 'CONFIRMED' : 'REJECTED',
        decidedById,
        decidedAt: new Date(),
        decisionNote: decisionNote?.trim() || null,
      },
      include: VISIT_INCLUDE,
    });

    if (confirmed) await this.maybeAdvanceLead(updated.leadId, decidedById);

    const decider = await this.prisma.user.findUnique({
      where: { id: decidedById }, select: { name: true },
    });
    await this.notifications.notifySiteVisitDecided({
      requestedById: updated.requestedById,
      confirmed,
      leadName: updated.lead?.name ?? 'Unnamed lead',
      propertyLabel: this.propertyLabel(updated),
      whenLabel: this.label(updated),
      decidedByName: decider?.name ?? null,
      decisionNote: updated.decisionNote,
      link: `/leads?lead=${updated.leadId}&visit=${updated.id}`,
    });
    return updated;
  }

  /**
   * Auto-advance to SITE_VISIT on confirmation — DIRECTIONAL (client, 2026-09-21).
   *
   * The client asked for auto-advance while naming its risk: it "overwrites a status the
   * rep may have deliberately set". Both halves hold if the move is only ever forwards.
   * A lead sitting at NEGOTIATING does not go back to SITE_VISIT because someone booked a
   * second viewing, and a LOST lead is not quietly revived.
   *
   * Order comes from the live lead_status catalogue, so adding a stage keeps this correct.
   */
  private async maybeAdvanceLead(leadId: string, actorId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { status: true } });
    if (!lead) return;
    if (lead.status === 'SITE_VISIT' || TERMINAL.has(lead.status)) return;

    const options = await this.prisma.customOption.findMany({
      where: { category: 'lead_status', isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { value: true },
    });
    const order = options.length > 0 ? options.map((o) => o.value) : FALLBACK_STATUS_ORDER;

    const targetIdx = order.indexOf('SITE_VISIT');
    const currentIdx = order.indexOf(lead.status);
    // Unknown current status, or SITE_VISIT missing from the catalogue: do nothing rather
    // than guess. Silence is safer than moving a lead on a status we cannot place.
    if (targetIdx < 0 || currentIdx < 0) return;
    if (currentIdx >= targetIdx) return;

    await this.prisma.$transaction([
      this.prisma.lead.update({ where: { id: leadId }, data: { status: 'SITE_VISIT' } }),
      // The timeline must say WHY it moved, otherwise the status appears to change itself.
      this.prisma.leadActivity.create({
        data: {
          leadId,
          type: LeadActivityType.STATUS_CHANGE,
          note: `Status moved ${lead.status} → SITE_VISIT when the site visit was confirmed.`,
          createdBy: actorId,
        },
      }),
    ]);
  }

  /**
   * Move a visit. The original goes terminal at RESCHEDULED and a NEW row points back at
   * it, so the lead's history shows the attempt as well as the replacement. Restating the
   * original in place would erase the fact that the first date was ever agreed.
   */
  async reschedule(id: string, data: { startsAt: string; endsAt?: string; reason?: string | null }, actorId: string) {
    const original = await this.findById(id);
    if (['RESCHEDULED', 'COMPLETED', 'CANCELLED'].includes(original.status)) {
      throw new BadRequestException(`A ${original.status.toLowerCase()} visit cannot be rescheduled`);
    }

    const startsAt = new Date(data.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt must be a valid date-time');
    const policy = await this.availability.policy();
    if (startsAt.getTime() < Date.now() + policy.minNoticeHours * 3_600_000) {
      throw new BadRequestException(`Site visits need at least ${policy.minNoticeHours} hours' notice`);
    }
    const endsAt = data.endsAt
      ? new Date(data.endsAt)
      : new Date(startsAt.getTime() + policy.slotMinutes * 60_000);

    let replacement;
    try {
      replacement = await this.prisma.$transaction(async (tx) => {
        await tx.siteVisit.update({
          where: { id },
          data: { status: 'RESCHEDULED', rescheduleReason: data.reason?.trim() || null },
        });
        return tx.siteVisit.create({
          data: {
            leadId: original.leadId,
            projectId: original.projectId,
            unitId: original.unitId,
            buildingId: original.buildingId,
            hostId: original.hostId,
            startsAt,
            endsAt,
            timezone: original.timezone,
            status: 'REQUESTED',
            requestedById: actorId,
            requestNote: original.requestNote,
            rescheduledFromId: original.id,
          },
          include: VISIT_INCLUDE,
        });
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('That slot was just taken — pick another time');
      throw e;
    }

    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    await this.notifications.notifySiteVisitRescheduled({
      // Host and requester both, deduped by send(). Either of them may be the one who did
      // not initiate the move, and both need to know the date changed.
      userIds: [original.hostId, original.requestedById, actorId],
      leadName: original.lead?.name ?? 'Unnamed lead',
      fromLabel: this.label(original),
      toLabel: formatInZone(startsAt, original.timezone),
      movedByName: actor?.name ?? null,
      reason: data.reason,
      link: `/leads?lead=${replacement.leadId}&visit=${replacement.id}`,
    });
    return replacement;
  }

  async cancel(id: string, reason: string | null | undefined, actorId: string) {
    const visit = await this.findById(id);
    if (!ACTIVE.includes(visit.status)) {
      throw new BadRequestException(`A ${visit.status.toLowerCase()} visit cannot be cancelled`);
    }
    return this.prisma.siteVisit.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        decisionNote: reason?.trim() || visit.decisionNote,
        decidedById: actorId,
        decidedAt: new Date(),
      },
      include: VISIT_INCLUDE,
    });
  }

  /** Record what happened. COMPLETED or NO_SHOW — both close the visit and stop the missed sweep. */
  async recordOutcome(id: string, data: { result: string; note?: string | null }, actorId: string) {
    const visit = await this.findById(id);
    if (visit.status !== 'CONFIRMED') {
      throw new BadRequestException('Only a confirmed visit can have an outcome recorded');
    }
    if (!['COMPLETED', 'NO_SHOW'].includes(data.result)) {
      throw new BadRequestException('Outcome must be COMPLETED or NO_SHOW');
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.siteVisit.update({
        where: { id },
        data: { status: data.result, completedAt: new Date(), outcomeNote: data.note?.trim() || null },
        include: VISIT_INCLUDE,
      }),
      // The visit belongs on the lead's own timeline too — the activity log is where reps
      // read a lead's history, and a visit that only exists in a separate table is invisible there.
      this.prisma.leadActivity.create({
        data: {
          leadId: visit.leadId,
          type: LeadActivityType.SITE_VISIT,
          note: data.result === 'COMPLETED'
            ? `Site visit completed.${data.note ? ` ${data.note}` : ''}`
            : `Lead did not attend the site visit.${data.note ? ` ${data.note}` : ''}`,
          createdBy: actorId,
        },
      }),
    ]);
    return updated;
  }
}
