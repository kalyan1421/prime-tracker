import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lease rent timeline engine.
 *
 * One timeline covers what would naively be three tables: the escalation SCHEDULE,
 * the rent HISTORY and free-rent months. See the schema comment above
 * `model LeaseRentPeriod` for why.
 *
 * Client-confirmed rules (2026-07-29):
 *  1. Escalation COMPOUNDS off the previous period's baseRent, not the original.
 *  2. Escalation touches baseRent ONLY. nnnAmount carries forward untouched and is
 *     re-negotiated by hand — never auto-escalated.
 *  3. Invariant on every row: monthlyRent === baseRent + nnnAmount.
 *  4. Free-rent months sit INSIDE the term. leaseEnd is never extended and the
 *     escalation clock runs from leaseStart, not from the first paying month.
 *  5. Past periods are immutable. Regeneration rewrites only periods that START in
 *     the future — same append-only discipline as BudgetRevision.
 *  6. escalationFreq is an interval in months (12 / 6 / 18). There is no
 *     calendar-anniversary mode.
 *
 * ---------------------------------------------------------------------------
 * ROUNDING RULE
 * ---------------------------------------------------------------------------
 * Money is `Prisma.Decimal` (decimal.js) end to end — no float arithmetic.
 * Every period's baseRent is rounded HALF-UP to 2 decimal places AT THE PERIOD
 * BOUNDARY, and the ROUNDED value is what compounds into the next period.
 *
 * That is deliberate: the tenant is invoiced the rounded number, so the rounded
 * number is the contractual base for next year's escalation. Rounding only at the
 * end (compounding full precision internally) would make the displayed schedule
 * disagree with the sum of what was actually billed, by a cent or two per year.
 *
 * nnnAmount is rounded once on input; monthlyRent is an exact sum of two already
 * rounded 2dp values, so it never needs rounding of its own.
 *
 * ---------------------------------------------------------------------------
 * DATE CONVENTIONS
 * ---------------------------------------------------------------------------
 * All arithmetic is UTC-based (no DST drift). `startDate` is inclusive and
 * `endDate` is the INCLUSIVE last day of the period. Generated periods always
 * carry an explicit endDate; a null endDate (only reachable via addManualPeriod)
 * means "runs to lease end".
 *
 * `leaseEnd` is read as the inclusive last day of the term. A new escalation
 * period only opens if its boundary falls strictly BEFORE leaseEnd, so data that
 * stores leaseEnd exclusive-style (the day after the term) cannot produce a
 * degenerate one-day trailing period.
 */

// ============================================================================
// Pure helpers — no Prisma client, no DB. This is where the maths lives and
// this is what the spec hammers.
// ============================================================================

export type RentPeriodSource = 'INITIAL' | 'AUTO_ESCALATION' | 'MANUAL' | 'FREE_RENT';

export type DecimalLike = Prisma.Decimal | number | string;

export interface RentScheduleInput {
  /** Inclusive first day of the term. */
  leaseStart: Date;
  /** Inclusive last day of the term. Never extended by free rent. */
  leaseEnd: Date;
  /** Rent portion of the FIRST paying period. This is what escalates. */
  baseRent: DecimalLike;
  /** NNN portion. Carried forward unchanged across every escalation. */
  nnnAmount?: DecimalLike | null;
  /** Percent applied to the PREVIOUS period's baseRent, e.g. 5 = +5%. */
  escalationPct?: DecimalLike | null;
  /** Months between escalations (12 / 6 / 18). Interval, not anniversary month. */
  escalationFreq?: number | null;
  /** Abated months. They sit inside the term; leaseEnd is unchanged. */
  freeRentMonths?: number | null;
  /** Defaults to leaseStart when free months exist but no start is given. */
  freeRentStartDate?: Date | null;
}

export interface ComputedRentPeriod {
  sequence: number;
  startDate: Date;
  /** Inclusive last day of the period. */
  endDate: Date;
  baseRent: Prisma.Decimal;
  nnnAmount: Prisma.Decimal;
  monthlyRent: Prisma.Decimal;
  isFreeRent: boolean;
  /** Null on the first period and on free-rent periods — nothing escalated into them. */
  escalationPct: Prisma.Decimal | null;
  source: RentPeriodSource;
}

const MS_PER_DAY = 86_400_000;
const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

function dec(v: DecimalLike): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/** Half-up to 2dp — the single rounding rule used everywhere in this file. */
export function round2(v: DecimalLike): Prisma.Decimal {
  return dec(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Strip time-of-day so period boundaries compare cleanly regardless of input. */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

/**
 * Month arithmetic that clamps instead of overflowing:
 * 2026-01-31 + 1 month = 2026-02-28, not 2026-03-03.
 */
export function addMonthsUtc(d: Date, months: number): Date {
  const day = d.getUTCDate();
  const anchor = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const daysInTargetMonth = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0),
  ).getUTCDate();
  anchor.setUTCDate(Math.min(day, daysInTargetMonth));
  return anchor;
}

/**
 * Length of [startInclusive, endExclusive) in months. Whole months are counted by
 * month-anniversary; any trailing stub is expressed as a fraction of the month it
 * sits in. Generated periods always land on exact month boundaries so this is
 * integral for them — the fractional branch only matters for hand-entered
 * MANUAL periods that start mid-month.
 */
export function monthsBetweenUtc(startInclusive: Date, endExclusive: Date): number {
  if (endExclusive <= startInclusive) return 0;
  let whole = 0;
  while (addMonthsUtc(startInclusive, whole + 1) <= endExclusive) whole++;
  const consumed = addMonthsUtc(startInclusive, whole);
  if (consumed.getTime() === endExclusive.getTime()) return whole;
  const nextBoundary = addMonthsUtc(startInclusive, whole + 1);
  const stubDays = (endExclusive.getTime() - consumed.getTime()) / MS_PER_DAY;
  const monthDays = (nextBoundary.getTime() - consumed.getTime()) / MS_PER_DAY;
  return whole + stubDays / monthDays;
}

/**
 * Throws unless monthlyRent === baseRent + nnnAmount. Called on every write path
 * (generated or manual) so a bad row can never reach the table.
 */
export function assertRentInvariant(row: {
  baseRent: DecimalLike;
  nnnAmount: DecimalLike;
  monthlyRent: DecimalLike;
}): void {
  const base = dec(row.baseRent);
  const nnn = dec(row.nnnAmount);
  const monthly = dec(row.monthlyRent);
  const expected = base.add(nnn);
  if (!monthly.equals(expected)) {
    throw new BadRequestException(
      `Rent period invariant violated: monthlyRent (${monthly.toFixed(2)}) must equal ` +
        `baseRent (${base.toFixed(2)}) + nnnAmount (${nnn.toFixed(2)}) = ${expected.toFixed(2)}. ` +
        `Off by ${monthly.sub(expected).toFixed(2)}.`,
    );
  }
}

interface EscalationSegment {
  start: Date;
  endExclusive: Date;
  baseRent: Prisma.Decimal;
  /** 0 = the initial (un-escalated) segment. */
  index: number;
}

/**
 * THE maths. Builds the full period list from plain dates and numbers.
 *
 * Shape of the algorithm:
 *   1. Lay out escalation segments anchored to leaseStart (rule 6 — fixed interval).
 *   2. Compound baseRent across segment boundaries, rounding at each (rule 1).
 *   3. Carve the free-rent window out of those segments and emit it separately
 *      (rule 4 — the escalation clock is untouched by abatement).
 *   4. Sort by startDate and number sequences 1..N.
 */
export function computeRentSchedule(input: RentScheduleInput): ComputedRentPeriod[] {
  const start = startOfUtcDay(input.leaseStart);
  const end = startOfUtcDay(input.leaseEnd);
  if (!(end > start)) {
    throw new BadRequestException('leaseEnd must be after leaseStart');
  }
  const endExclusive = addDaysUtc(end, 1);

  const initialBase = round2(input.baseRent);
  if (initialBase.isNegative()) {
    throw new BadRequestException('baseRent cannot be negative');
  }
  const nnn = round2(input.nnnAmount ?? 0);
  if (nnn.isNegative()) {
    throw new BadRequestException('nnnAmount cannot be negative');
  }

  const pct = input.escalationPct == null ? null : dec(input.escalationPct);
  const freq = input.escalationFreq ?? null;
  // No pct, a zero pct, or no interval => one flat period for the whole term.
  const escalates = pct !== null && !pct.isZero() && freq !== null && freq > 0;

  // ---- 1 + 2: escalation segments, compounding at each boundary -------------
  const segments: EscalationSegment[] = [];
  if (!escalates) {
    segments.push({ start, endExclusive, baseRent: initialBase, index: 0 });
  } else {
    const factor = new Prisma.Decimal(1).add(pct!.div(HUNDRED));
    let base = initialBase;
    for (let i = 0; ; i++) {
      const segStart = addMonthsUtc(start, i * freq!);
      // A boundary landing on or after the last day never opens a new period —
      // this is what stops an 18-into-36 or 12-into-30 term running past leaseEnd.
      if (i > 0 && segStart >= end) break;
      // Compound off the PREVIOUS period's already-rounded baseRent.
      if (i > 0) base = round2(base.mul(factor));
      const nextStart = addMonthsUtc(start, (i + 1) * freq!);
      const segEnd = nextStart < endExclusive ? nextStart : endExclusive;
      segments.push({ start: segStart, endExclusive: segEnd, baseRent: base, index: i });
      if (segEnd >= endExclusive) break;
    }
  }

  // ---- 3: free-rent window, clipped into the term --------------------------
  let freeStart: Date | null = null;
  let freeEndExclusive: Date | null = null;
  const freeMonths = input.freeRentMonths ?? 0;
  if (freeMonths > 0) {
    const requested = input.freeRentStartDate
      ? startOfUtcDay(input.freeRentStartDate)
      : start;
    const clippedStart = requested < start ? start : requested;
    const naturalEnd = addMonthsUtc(clippedStart, freeMonths);
    const clippedEnd = naturalEnd < endExclusive ? naturalEnd : endExclusive;
    if (clippedStart < endExclusive && clippedEnd > clippedStart) {
      freeStart = clippedStart;
      freeEndExclusive = clippedEnd;
    }
  }

  type Draft = Omit<ComputedRentPeriod, 'sequence'>;
  const drafts: Draft[] = [];

  for (const seg of segments) {
    const payingRanges: Array<[Date, Date]> =
      freeStart && freeEndExclusive
        ? subtractRange(seg.start, seg.endExclusive, freeStart, freeEndExclusive)
        : [[seg.start, seg.endExclusive]];

    for (const [rangeStart, rangeEndExclusive] of payingRanges) {
      if (rangeEndExclusive <= rangeStart) continue;
      drafts.push({
        startDate: rangeStart,
        endDate: addDaysUtc(rangeEndExclusive, -1),
        baseRent: seg.baseRent,
        nnnAmount: nnn,
        monthlyRent: seg.baseRent.add(nnn),
        isFreeRent: false,
        escalationPct: seg.index > 0 ? pct : null,
        source: seg.index > 0 ? 'AUTO_ESCALATION' : 'INITIAL',
      });
    }
  }

  if (freeStart && freeEndExclusive) {
    // One period for the contiguous abatement window. It is not split at
    // escalation boundaries — there is nothing to escalate at rent 0, and the
    // paying segments on either side already carry the correct (unshifted) rents.
    drafts.push({
      startDate: freeStart,
      endDate: addDaysUtc(freeEndExclusive, -1),
      baseRent: ZERO,
      nnnAmount: ZERO,
      monthlyRent: ZERO,
      isFreeRent: true,
      escalationPct: null,
      source: 'FREE_RENT',
    });
  }

  // ---- 4: order + number ---------------------------------------------------
  drafts.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const periods = drafts.map((d, i) => ({ ...d, sequence: i + 1 }));
  periods.forEach(assertRentInvariant);
  return periods;
}

/** [aStart, aEnd) minus [bStart, bEnd) — up to two remaining ranges. */
function subtractRange(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): Array<[Date, Date]> {
  if (bEnd <= aStart || bStart >= aEnd) return [[aStart, aEnd]];
  const out: Array<[Date, Date]> = [];
  if (bStart > aStart) out.push([aStart, bStart < aEnd ? bStart : aEnd]);
  if (bEnd < aEnd) out.push([bEnd > aStart ? bEnd : aStart, aEnd]);
  return out;
}

/**
 * Total contracted rent over the term, free-rent months included as zero.
 * Pure counterpart of `LeaseRentPeriodService.getEffectiveRent`.
 */
export function summariseEffectiveRent(
  periods: Array<{
    startDate: Date;
    endDate: Date | null;
    baseRent: DecimalLike;
    nnnAmount: DecimalLike;
    monthlyRent: DecimalLike;
    isFreeRent: boolean;
  }>,
  leaseEnd: Date,
  termMonths?: number | null,
) {
  const leaseEndExclusive = addDaysUtc(startOfUtcDay(leaseEnd), 1);
  let totalContractedRent = ZERO;
  let totalContractedBase = ZERO;
  let payingMonths = 0;
  let freeMonths = 0;
  let coveredMonths = 0;

  for (const p of periods) {
    const s = startOfUtcDay(p.startDate);
    const e = p.endDate ? addDaysUtc(startOfUtcDay(p.endDate), 1) : leaseEndExclusive;
    const months = monthsBetweenUtc(s, e);
    coveredMonths += months;
    if (p.isFreeRent) {
      freeMonths += months;
      continue;
    }
    payingMonths += months;
    totalContractedRent = totalContractedRent.add(dec(p.monthlyRent).mul(months));
    totalContractedBase = totalContractedBase.add(dec(p.baseRent).mul(months));
  }

  // Prefer the contract's own termMonths; fall back to what the periods cover.
  const term = termMonths && termMonths > 0 ? termMonths : coveredMonths;
  const divisor = term > 0 ? term : 1;

  return {
    termMonths: term,
    payingMonths: Number(payingMonths.toFixed(6)),
    freeRentMonths: Number(freeMonths.toFixed(6)),
    totalContractedRent: round2(totalContractedRent),
    totalContractedBaseRent: round2(totalContractedBase),
    /** Straight-lined rent incl. NNN — the "effective rent" KPI. */
    effectiveMonthlyRent: round2(totalContractedRent.div(divisor)),
    effectiveMonthlyBaseRent: round2(totalContractedBase.div(divisor)),
  };
}

// ============================================================================
// Service
// ============================================================================

export interface GenerateOptions {
  /** Overrides lease.monthlyRent as the first period's rent portion. */
  baseRent?: DecimalLike;
  /** Lease has no NNN column today — pass it here when splitting rent out. */
  nnnAmount?: DecimalLike;
  createdById?: string;
  /**
   * Terms changed after periods already existed: rewrite the FUTURE and keep the
   * past. Without this, generateForLease is a no-op when periods exist.
   */
  force?: boolean;
}

export interface AddManualPeriodInput {
  leaseId: string;
  startDate: Date | string;
  /** Omit for "runs to lease end". */
  endDate?: Date | string | null;
  baseRent: DecimalLike;
  nnnAmount?: DecimalLike;
  /** Optional — derived from baseRent + nnnAmount when omitted, validated when given. */
  monthlyRent?: DecimalLike;
  /** REQUIRED. A manual rent change with no stated reason is not auditable. */
  reason: string;
  createdById?: string;
}

@Injectable()
export class LeaseRentPeriodService {
  constructor(private prisma: PrismaService) {}

  /** All periods for a lease, in timeline order. */
  async findByLease(leaseId: string) {
    return this.prisma.leaseRentPeriod.findMany({
      where: { leaseId },
      orderBy: { sequence: 'asc' },
    });
  }

  /**
   * Build the whole timeline from the lease's terms.
   *
   * Idempotent: re-running on a lease that already has periods returns them
   * untouched. `createMany({ skipDuplicates: true })` leans on
   * `@@unique([leaseId, sequence])` so a concurrent double-call cannot duplicate
   * rows either. Pass `{ force: true }` after a terms change to rewrite the future.
   */
  async generateForLease(leaseId: string, opts: GenerateOptions = {}) {
    const lease = await this.loadLease(leaseId);
    const existing = await this.findByLease(leaseId);

    if (existing.length > 0) {
      if (!opts.force) return existing;
      return this.regenerateFuture(leaseId, opts.createdById, opts);
    }

    const periods = computeRentSchedule(this.toScheduleInput(lease, opts));
    if (periods.length === 0) return [];

    await this.prisma.leaseRentPeriod.createMany({
      data: periods.map((p) => this.toCreateData(leaseId, p, opts.createdById)),
      skipDuplicates: true,
    });
    return this.findByLease(leaseId);
  }

  /**
   * Recompute only the periods that START in the future; everything already
   * running or finished is frozen (rule 5).
   *
   * Frozen rows keep their original endDate even when a new period now starts
   * before it. Overlap is resolved by `getEffectivePeriod`, which takes the
   * LATEST period whose startDate is on or before the date asked about — so the
   * newer terms win without any past row being edited.
   */
  async regenerateFuture(
    leaseId: string,
    userId?: string,
    opts: Omit<GenerateOptions, 'force' | 'createdById'> = {},
  ) {
    const lease = await this.loadLease(leaseId);
    const today = startOfUtcDay(new Date());
    const existing = await this.findByLease(leaseId);

    // "Future" = starts strictly after today. A period that has already begun is
    // in effect and therefore immutable.
    const frozen = existing.filter((p) => startOfUtcDay(p.startDate) <= today);
    const stale = existing.filter((p) => startOfUtcDay(p.startDate) > today);

    const computed = computeRentSchedule(this.toScheduleInput(lease, opts));
    const future = computed.filter((p) => p.startDate > today);

    const maxFrozenSequence = frozen.reduce((m, p) => Math.max(m, p.sequence), 0);

    await this.prisma.$transaction([
      ...(stale.length
        ? [
            this.prisma.leaseRentPeriod.deleteMany({
              where: { id: { in: stale.map((p) => p.id) } },
            }),
          ]
        : []),
      ...(future.length
        ? [
            this.prisma.leaseRentPeriod.createMany({
              data: future.map((p, i) =>
                this.toCreateData(leaseId, { ...p, sequence: maxFrozenSequence + i + 1 }, userId),
              ),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    return this.findByLease(leaseId);
  }

  /**
   * The period in force on `asOf`. Rent-roll calls this.
   *
   * Latest-start-wins: among periods that have started by `asOf`, the one with the
   * most recent startDate is authoritative. That makes a mid-term MANUAL
   * renegotiation supersede the scheduled period it lands inside without having to
   * edit (and therefore violate the immutability of) the earlier row.
   */
  async getEffectivePeriod(leaseId: string, asOf: Date) {
    const at = startOfUtcDay(asOf);
    const periods = await this.prisma.leaseRentPeriod.findMany({
      where: { leaseId, startDate: { lte: addDaysUtc(at, 1) } },
      orderBy: [{ startDate: 'desc' }, { sequence: 'desc' }],
    });
    for (const p of periods) {
      if (startOfUtcDay(p.startDate) > at) continue;
      if (p.endDate === null) return p;
      if (startOfUtcDay(p.endDate) >= at) return p;
    }
    return null;
  }

  /**
   * Mid-term renegotiation. Appended, never an edit of an existing row.
   * `reason` is mandatory — same rule as BudgetRevision.
   */
  async addManualPeriod(input: AddManualPeriodInput) {
    if (!input.reason?.trim()) {
      throw new BadRequestException('A reason is required for a manual rent period');
    }
    const lease = await this.loadLease(input.leaseId);

    const startDate = startOfUtcDay(new Date(input.startDate));
    const endDate = input.endDate ? startOfUtcDay(new Date(input.endDate)) : null;
    const leaseStart = startOfUtcDay(lease.leaseStart);
    const leaseEnd = startOfUtcDay(lease.leaseEnd);

    if (startDate < leaseStart || startDate > leaseEnd) {
      throw new BadRequestException('Manual period must start inside the lease term');
    }
    if (endDate && endDate < startDate) {
      throw new BadRequestException('Manual period endDate cannot precede its startDate');
    }
    if (endDate && endDate > leaseEnd) {
      throw new BadRequestException('Manual period cannot extend past leaseEnd');
    }

    const baseRent = round2(input.baseRent);
    const nnnAmount = round2(input.nnnAmount ?? 0);
    const monthlyRent =
      input.monthlyRent === undefined ? baseRent.add(nnnAmount) : round2(input.monthlyRent);
    assertRentInvariant({ baseRent, nnnAmount, monthlyRent });

    const last = await this.prisma.leaseRentPeriod.findFirst({
      where: { leaseId: input.leaseId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    return this.prisma.leaseRentPeriod.create({
      data: {
        leaseId: input.leaseId,
        sequence: (last?.sequence ?? 0) + 1,
        startDate,
        endDate,
        baseRent,
        nnnAmount,
        monthlyRent,
        isFreeRent: false,
        escalationPct: null,
        source: 'MANUAL',
        reason: input.reason.trim(),
        createdById: input.createdById ?? null,
      },
    });
  }

  /**
   * Effective (straight-lined) rent: total contracted rent over the term divided
   * by term months, with free months counted in the denominator at zero rent.
   * Free rent therefore pulls the number DOWN, which is the point of the KPI.
   */
  async getEffectiveRent(leaseId: string) {
    const lease = await this.loadLease(leaseId);
    const periods = await this.findByLease(leaseId);
    if (periods.length === 0) {
      throw new BadRequestException(
        'Lease has no rent periods — run generateForLease before asking for effective rent',
      );
    }
    return summariseEffectiveRent(periods, lease.leaseEnd, lease.termMonths);
  }

  /**
   * Start of the first non-abated period. Drives the "rent starts on X" notification.
   * Null when the lease has no periods, or is abated end to end.
   */
  async getFirstPayingMonth(leaseId: string): Promise<Date | null> {
    const first = await this.prisma.leaseRentPeriod.findFirst({
      where: { leaseId, isFreeRent: false },
      orderBy: { startDate: 'asc' },
      select: { startDate: true },
    });
    return first?.startDate ?? null;
  }

  // -------------------------------------------------------------------------

  private async loadLease(leaseId: string) {
    const lease = await this.prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.deletedAt) throw new NotFoundException('Lease not found');
    return lease;
  }

  private toScheduleInput(
    lease: {
      leaseStart: Date;
      leaseEnd: Date;
      monthlyRent: Prisma.Decimal;
      escalationPct: Prisma.Decimal | null;
      escalationFreq: number | null;
      freeRentMonths: number | null;
      freeRentStartDate: Date | null;
    },
    opts: Pick<GenerateOptions, 'baseRent' | 'nnnAmount'>,
  ): RentScheduleInput {
    // Lease has no NNN column today, so lease.monthlyRent IS the base rent unless
    // the caller splits it explicitly. If a split is supplied, baseRent defaults to
    // monthlyRent - nnnAmount so the headline figure stays the contractual total.
    const nnnAmount = opts.nnnAmount === undefined ? ZERO : round2(opts.nnnAmount);
    const baseRent =
      opts.baseRent !== undefined
        ? round2(opts.baseRent)
        : round2(dec(lease.monthlyRent).sub(nnnAmount));
    return {
      leaseStart: lease.leaseStart,
      leaseEnd: lease.leaseEnd,
      baseRent,
      nnnAmount,
      escalationPct: lease.escalationPct,
      escalationFreq: lease.escalationFreq,
      freeRentMonths: lease.freeRentMonths,
      freeRentStartDate: lease.freeRentStartDate,
    };
  }

  private toCreateData(
    leaseId: string,
    p: ComputedRentPeriod,
    createdById?: string,
  ): Prisma.LeaseRentPeriodCreateManyInput {
    assertRentInvariant(p);
    return {
      leaseId,
      sequence: p.sequence,
      startDate: p.startDate,
      endDate: p.endDate,
      baseRent: p.baseRent,
      nnnAmount: p.nnnAmount,
      monthlyRent: p.monthlyRent,
      isFreeRent: p.isFreeRent,
      escalationPct: p.escalationPct,
      source: p.source,
      createdById: createdById ?? null,
    };
  }
}
