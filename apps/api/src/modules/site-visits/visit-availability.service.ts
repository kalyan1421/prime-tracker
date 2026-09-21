import {
  Injectable, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  zonedWallClockToUtc, calendarDayOfWeek, parseCalendarDate, eachCalendarDate, formatInZone,
} from './zoned-time';

/** Hard cap on how many days one /slots call may expand. */
const MAX_RANGE_DAYS = 120;

export interface SlotDto {
  startsAt: string;
  endsAt: string;
  timezone: string;
  label: string;
}

/**
 * Why the picker is empty.
 *
 * An empty array alone forced the UI to GUESS, and it guessed wrong: it told people every
 * slot was "taken, blocked, or inside the notice period" even when the real answer was
 * that the host had never published availability at all. Counting what each stage removed
 * costs nothing during the walk and turns a dead end into an explanation.
 */
export interface SlotDiagnostics {
  /** False = this host has no availability rules whatsoever. The commonest real cause. */
  hasAvailability: boolean;
  /** Slots the OPEN windows produced in range, before anything was subtracted. */
  generated: number;
  removedBlocked: number;
  removedNotice: number;
  removedTaken: number;
  minNoticeHours: number;
}

/**
 * Per-day outcome, so the booking calendar can colour each square with the REASON rather
 * than just showing it empty. A day the host blocked and a day that is fully booked look
 * identical without this, and they mean very different things to whoever is booking.
 */
export interface DayStatus {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  generated: number;
  open: number;
  blocked: number;
  taken: number;
  notice: number;
}

export interface SlotsResult {
  slots: SlotDto[];
  diagnostics: SlotDiagnostics;
  days: DayStatus[];
}

@Injectable()
export class VisitAvailabilityService {
  constructor(private prisma: PrismaService) {}

  /**
   * Scheduling policy lives on OrgSettings so an admin can change the notice period
   * without a deploy (client, 2026-09-21). Falls back to the schema defaults when no
   * settings row exists yet, so a fresh install still schedules sensibly.
   */
  async policy() {
    const row = await this.prisma.orgSettings.findFirst();
    return {
      minNoticeHours: row?.siteVisitMinNoticeHours ?? 6,
      slotMinutes: row?.siteVisitSlotMinutes ?? 60,
      dayStartMin: row?.siteVisitDayStartMin ?? 540,
      dayEndMin: row?.siteVisitDayEndMin ?? 1080,
      missedGraceHours: row?.siteVisitMissedGraceHours ?? 2,
    };
  }

  list(hostId?: string) {
    return this.prisma.visitAvailability.findMany({
      where: hostId ? { hostId } : {},
      include: { host: { select: { id: true, name: true } } },
      orderBy: [{ dayOfWeek: 'asc' }, { date: 'asc' }, { startMin: 'asc' }],
    });
  }

  private validate(data: {
    kind?: string; dayOfWeek?: number | null; dayOfMonth?: number | null;
    date?: string | null; endDate?: string | null;
    startMin: number; endMin: number; slotMinutes?: number;
  }) {
    const hasDow = data.dayOfWeek !== undefined && data.dayOfWeek !== null;
    const hasDom = data.dayOfMonth !== undefined && data.dayOfMonth !== null;
    const hasDate = !!data.date;
    // EXACTLY one: a rule that is two kinds at once has no single meaning, and one that is
    // none never matches a day.
    const kinds = [hasDow, hasDom, hasDate].filter(Boolean).length;
    if (kinds !== 1) {
      throw new BadRequestException(
        'Provide exactly one of dayOfWeek (weekly), dayOfMonth (monthly) or date (one-off)',
      );
    }
    if (hasDow && (data.dayOfWeek! < 0 || data.dayOfWeek! > 6)) {
      throw new BadRequestException('dayOfWeek must be 0 (Sunday) to 6 (Saturday)');
    }
    if (hasDom && (data.dayOfMonth! < 1 || data.dayOfMonth! > 31)) {
      throw new BadRequestException('dayOfMonth must be 1 to 31');
    }
    if (hasDate && !parseCalendarDate(data.date!)) {
      throw new BadRequestException('date must be a calendar date (YYYY-MM-DD)');
    }
    // endDate turns a one-off into an inclusive RANGE. It is meaningless on a weekly or
    // monthly rule — those already repeat — so it is rejected there rather than ignored.
    if (data.endDate) {
      if (!hasDate) {
        throw new BadRequestException('endDate needs a start date — set `date` as well');
      }
      if (!parseCalendarDate(data.endDate)) {
        throw new BadRequestException('endDate must be a calendar date (YYYY-MM-DD)');
      }
      if (new Date(data.endDate) < new Date(data.date!)) {
        throw new BadRequestException('endDate cannot fall before the start date');
      }
    }
    if (data.startMin < 0 || data.endMin > 24 * 60) {
      throw new BadRequestException('Times must fall within a single day');
    }
    if (data.endMin <= data.startMin) {
      throw new BadRequestException('The window must end after it starts');
    }
    if (data.slotMinutes !== undefined && data.slotMinutes < 5) {
      throw new BadRequestException('Slot length must be at least 5 minutes');
    }
  }

  /**
   * Who may touch whose calendar.
   *
   * Everyone with availability:manage publishes their OWN hours — that is what makes any
   * role bookable. Only leadership may publish or edit somebody ELSE'S, because a calendar
   * is a commitment of that person's time and editing it silently on their behalf is not
   * something a peer should be able to do.
   */
  private assertMayManage(hostId: string, actor?: { userId: string; roles?: string[] }) {
    if (!actor) return;
    if (actor.userId === hostId) return;
    const leadership = ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'];
    if ((actor.roles ?? []).some((r) => leadership.includes(r))) return;
    throw new ForbiddenException('You can only publish availability for yourself');
  }

  async create(data: any, createdBy: string, actor?: { userId: string; roles?: string[] }) {
    this.assertMayManage(data.hostId, actor);
    this.validate(data);
    return this.prisma.visitAvailability.create({
      data: {
        hostId: data.hostId,
        kind: data.kind ?? 'OPEN',
        dayOfWeek: data.dayOfWeek ?? null,
        dayOfMonth: data.dayOfMonth ?? null,
        date: data.date ? new Date(data.date) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        startMin: data.startMin,
        endMin: data.endMin,
        slotMinutes: data.slotMinutes ?? (await this.policy()).slotMinutes,
        timezone: data.timezone ?? 'America/Chicago',
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
        note: data.note ?? null,
        createdBy,
      },
    });
  }

  /**
   * Create several rules at once — "every weekday", "every day", a whole month.
   *
   * ONE transaction rather than N requests from the browser: this app's throttler caps a
   * client at ~10 writes/second and silently truncates a parallel per-item loop, so a
   * seven-day publish would land as four rules with no error shown. All-or-nothing also
   * means a half-published week is not a state anyone can reach.
   */
  async createMany(
    rules: any[],
    createdBy: string,
    actor?: { userId: string; roles?: string[] },
  ) {
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new BadRequestException('Provide at least one availability rule');
    }
    if (rules.length > 31) {
      throw new BadRequestException('Too many rules in one request (max 31)');
    }
    const defaults = await this.policy();
    // Validate EVERY rule before writing any of them, so a bad one at position 5 does not
    // leave the first four applied.
    for (const r of rules) {
      this.assertMayManage(r.hostId, actor);
      this.validate(r);
    }
    return this.prisma.$transaction(
      rules.map((r) => this.prisma.visitAvailability.create({
        data: {
          hostId: r.hostId,
          kind: r.kind ?? 'OPEN',
          dayOfWeek: r.dayOfWeek ?? null,
          dayOfMonth: r.dayOfMonth ?? null,
          date: r.date ? new Date(r.date) : null,
          endDate: r.endDate ? new Date(r.endDate) : null,
          startMin: r.startMin,
          endMin: r.endMin,
          slotMinutes: r.slotMinutes ?? defaults.slotMinutes,
          timezone: r.timezone ?? 'America/Chicago',
          effectiveFrom: r.effectiveFrom ? new Date(r.effectiveFrom) : null,
          effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
          note: r.note ?? null,
          createdBy,
        },
      })),
    );
  }

  async update(id: string, data: any, actor?: { userId: string; roles?: string[] }) {
    const existing = await this.prisma.visitAvailability.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Availability rule not found');
    this.assertMayManage(existing.hostId, actor);
    const merged = {
      kind: data.kind ?? existing.kind,
      dayOfWeek: data.dayOfWeek !== undefined ? data.dayOfWeek : existing.dayOfWeek,
      dayOfMonth: data.dayOfMonth !== undefined ? data.dayOfMonth : existing.dayOfMonth,
      date: data.date !== undefined ? data.date : (existing.date ? existing.date.toISOString().slice(0, 10) : null),
      endDate: data.endDate !== undefined ? data.endDate : (existing.endDate ? existing.endDate.toISOString().slice(0, 10) : null),
      startMin: data.startMin ?? existing.startMin,
      endMin: data.endMin ?? existing.endMin,
      slotMinutes: data.slotMinutes ?? existing.slotMinutes,
    };
    this.validate(merged);
    return this.prisma.visitAvailability.update({
      where: { id },
      data: {
        kind: merged.kind,
        dayOfWeek: merged.dayOfWeek,
        dayOfMonth: merged.dayOfMonth,
        date: merged.date ? new Date(merged.date) : null,
        endDate: merged.endDate ? new Date(merged.endDate) : null,
        startMin: merged.startMin,
        endMin: merged.endMin,
        slotMinutes: merged.slotMinutes,
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        ...(data.note !== undefined ? { note: data.note } : {}),
        ...(data.effectiveFrom !== undefined ? { effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null } : {}),
        ...(data.effectiveTo !== undefined ? { effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null } : {}),
      },
    });
  }

  /**
   * Deleting a rule must not silently strand bookings made against it, so the caller is
   * told what it affects. The visits themselves survive: they are already-agreed
   * commitments, and the rule that produced them is only a generator.
   */
  async impactOfDelete(id: string) {
    const rule = await this.prisma.visitAvailability.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Availability rule not found');
    const affected = await this.prisma.siteVisit.findMany({
      where: { hostId: rule.hostId, status: { in: ['REQUESTED', 'CONFIRMED'] }, startsAt: { gte: new Date() } },
      select: { id: true, startsAt: true, timezone: true, lead: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
    });
    return {
      rule,
      affectedCount: affected.length,
      affected: affected.map((v) => ({
        id: v.id,
        when: formatInZone(v.startsAt, v.timezone),
        leadName: v.lead?.name ?? 'Unnamed lead',
      })),
    };
  }

  async remove(id: string, actor?: { userId: string; roles?: string[] }) {
    const { rule } = await this.impactOfDelete(id);
    this.assertMayManage(rule.hostId, actor);
    return this.prisma.visitAvailability.delete({ where: { id } });
  }

  /**
   * Bookable slots between two calendar dates.
   *
   * COMPUTED, never stored. A materialised slot table would need reconciling on every rule
   * change, every booking and every cancellation, and any missed path leaves the picker
   * showing times that cannot be booked.
   *
   * Order matters: expand OPEN windows, subtract BLOCKED, subtract slots already held,
   * then drop anything inside the notice period.
   */
  async slots(params: { hostId: string; from: string; to: string }): Promise<SlotsResult> {
    const from = parseCalendarDate(params.from ?? '');
    const to = parseCalendarDate(params.to ?? '');
    if (!from || !to) throw new BadRequestException('from and to must be calendar dates (YYYY-MM-DD)');
    if (!params.hostId) throw new BadRequestException('hostId is required');

    const dates = eachCalendarDate(from, to, MAX_RANGE_DAYS);
    if (dates.length === 0) throw new BadRequestException('`to` must not precede `from`');

    const [rules, policy] = await Promise.all([
      this.prisma.visitAvailability.findMany({ where: { hostId: params.hostId } }),
      this.policy(),
    ]);
    const diagnostics: SlotDiagnostics = {
      hasAvailability: rules.length > 0,
      generated: 0,
      removedBlocked: 0,
      removedNotice: 0,
      removedTaken: 0,
      minNoticeHours: policy.minNoticeHours,
    };
    if (rules.length === 0) return { slots: [], diagnostics, days: [] };

    const rangeStart = zonedWallClockToUtc(from.year, from.month, from.day, 0, rules[0].timezone);
    const rangeEnd = zonedWallClockToUtc(to.year, to.month, to.day, 24 * 60, rules[0].timezone);

    // A REQUESTED booking holds the slot just as a CONFIRMED one does — see the partial
    // unique index in the migration for why pending must block.
    const held = await this.prisma.siteVisit.findMany({
      where: {
        hostId: params.hostId,
        status: { in: ['REQUESTED', 'CONFIRMED'] },
        startsAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { startsAt: true },
    });
    const heldSet = new Set(held.map((h) => h.startsAt.getTime()));

    const earliest = Date.now() + policy.minNoticeHours * 3_600_000;
    const out: SlotDto[] = [];
    const days: DayStatus[] = [];

    for (const d of dates) {
      const dow = calendarDayOfWeek(d.year, d.month, d.day);
      const dayMs = Date.UTC(d.year, d.month - 1, d.day);
      const key = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      const today: DayStatus = { date: key, generated: 0, open: 0, blocked: 0, taken: 0, notice: 0 };
      days.push(today);

      const applies = (r: typeof rules[number]) => {
        if (r.effectiveFrom && dayMs < r.effectiveFrom.getTime()) return false;
        if (r.effectiveTo && dayMs > r.effectiveTo.getTime()) return false;
        if (r.date) {
          // Inclusive range when endDate is set; a single day otherwise.
          return r.endDate
            ? dayMs >= r.date.getTime() && dayMs <= r.endDate.getTime()
            : r.date.getTime() === dayMs;
        }
        // Monthly: a month that has no such day (31 February) simply does not match, which
        // is why this compares the real calendar day rather than clamping.
        if (r.dayOfMonth != null) return r.dayOfMonth === d.day;
        return r.dayOfWeek === dow;
      };

      const dayRules = rules.filter(applies);
      const blocked = dayRules.filter((r) => r.kind === 'BLOCKED');
      const open = dayRules.filter((r) => r.kind === 'OPEN');

      for (const rule of open) {
        const step = rule.slotMinutes || policy.slotMinutes;
        for (let m = rule.startMin; m + step <= rule.endMin; m += step) {
          const slotEnd = m + step;
          diagnostics.generated += 1;
          today.generated += 1;
          // BLOCKED beats OPEN: any overlap at all removes the slot, because a partly
          // blocked hour is not an hour the host is free.
          if (blocked.some((b) => m < b.endMin && slotEnd > b.startMin)) {
            diagnostics.removedBlocked += 1;
            today.blocked += 1;
            continue;
          }

          const startsAt = zonedWallClockToUtc(d.year, d.month, d.day, m, rule.timezone);
          if (startsAt.getTime() < earliest) {
            diagnostics.removedNotice += 1;
            today.notice += 1;
            continue;
          }
          if (heldSet.has(startsAt.getTime())) {
            diagnostics.removedTaken += 1;
            today.taken += 1;
            continue;
          }

          today.open += 1;
          const endsAt = zonedWallClockToUtc(d.year, d.month, d.day, slotEnd, rule.timezone);
          out.push({
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            timezone: rule.timezone,
            label: formatInZone(startsAt, rule.timezone),
          });
        }
      }
    }

    // Two OPEN rules can overlap (a weekly window plus a one-off extension), which would
    // otherwise offer the same instant twice.
    const seen = new Set<string>();
    const slots = out
      .filter((s) => (seen.has(s.startsAt) ? false : (seen.add(s.startsAt), true)))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    // Two OPEN rules can both cover an instant, so `open` is recounted from the deduped
    // slot list rather than trusted from the walk — otherwise a day with overlapping
    // windows advertises more free slots than the picker will actually offer.
    const openByDate = new Map<string, number>();
    for (const sl of slots) {
      const k = new Intl.DateTimeFormat('en-CA', {
        timeZone: sl.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(sl.startsAt));
      openByDate.set(k, (openByDate.get(k) ?? 0) + 1);
    }
    for (const d of days) d.open = openByDate.get(d.date) ?? 0;

    return { slots, diagnostics, days };
  }
}
