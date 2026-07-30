import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DecimalLike,
  addDaysUtc,
  addMonthsUtc,
  round2,
  startOfUtcDay,
} from './lease-rent-period.service';

/**
 * Monthly rent collection ledger.
 *
 * One row per lease per calendar month, generated from the LeaseRentPeriod
 * timeline. This is the "did the tenant actually pay?" table — LeaseRentPeriod
 * says what is CONTRACTED, this says what was BILLED and what came in.
 *
 * Client-confirmed rules (2026-07-29):
 *  1. Invoices are GENERATED, never hand-created. One per month per lease, off
 *     the rent period covering that month.
 *  2. The due day is per-lease (`lease.rentDueDay`, 1-31; null = the 1st) and is
 *     CLAMPED to the last day of short months — a "31st" lease bills 28 Feb (29
 *     in a leap year), it does not roll into March.
 *  3. Partial first/last months bill pro-rata BY DAY COUNT. `isProrated`,
 *     `billedDays` and `monthDays` are stored so the figure can be explained to
 *     a tenant later.
 *  4. Free-rent months still get a row (amountDue 0, status FREE). Deliberate:
 *     the client wants a payment history with no unexplained gaps.
 *  5. `status` is DERIVED, never accepted from a caller. WAIVED is the single
 *     exception — set only by waive().
 *  6. `amountPaid` is a MIRROR: recordPayment SETS it, it is never incremented,
 *     so a double-submitted form cannot inflate it. clearPayment resets it to 0.
 *  7. Generation is IDEMPOTENT and strictly APPEND-ONLY. It only ever
 *     `createMany({ skipDuplicates: true })` against `@@unique([leaseId,
 *     periodMonth])` — it never updates an existing row, so re-running the cron
 *     can never overwrite a payment somebody already recorded. This is the most
 *     important correctness property in the file; do not "fix" it by upserting.
 *
 * ---------------------------------------------------------------------------
 * PRORATION + ROUNDING RULE
 * ---------------------------------------------------------------------------
 *   amountDue = round2(monthlyRent x billedDays / monthDays)
 *
 * `monthDays` is the length of the CALENDAR month (28/29/30/31), not a
 * banker's 30. `billedDays` counts the days of that month that fall inside the
 * term, both endpoints inclusive — a lease starting 15 Mar bills 17/31 of March
 * (15th..31st). There is exactly ONE rounding, half-up to 2dp, applied to the
 * final product; the ratio is never rounded on its own. Cents therefore differ
 * from `monthlyRent / monthDays x billedDays` by at most a cent, and the stored
 * billedDays/monthDays always reproduce the stored amountDue exactly.
 *
 * ---------------------------------------------------------------------------
 * WHICH PERIOD BILLS A MONTH
 * ---------------------------------------------------------------------------
 * A month is billed at a SINGLE rate: the rent period in force on the first
 * BILLED day of that month (latest-start-wins, the same rule as
 * `LeaseRentPeriodService.getEffectivePeriod`, so a MANUAL renegotiation
 * supersedes the scheduled period it lands inside).
 *
 * That is a deliberate consequence of the schema: one `amountDue`, one
 * `billedDays`, one `monthDays` — there is nowhere to record a blended
 * two-rate month, and an invoice a tenant cannot recompute from the numbers
 * printed on it is worse than one that is a few days generous. An escalation
 * that lands mid-month therefore takes effect on the FOLLOWING month's invoice.
 * Escalation boundaries are anchored to leaseStart, so this only bites leases
 * that start mid-month.
 *
 * ---------------------------------------------------------------------------
 * DATES
 * ---------------------------------------------------------------------------
 * All arithmetic is UTC via the helpers in lease-rent-period.service (no DST
 * drift). `periodMonth` is the first day of the billed month at UTC midnight —
 * it is the natural key alongside leaseId, so it must be constructed the same
 * way every time or the unique constraint stops protecting anything.
 *
 * Money is `Prisma.Decimal` end to end. Prisma Decimals stringify, so a naive
 * `a + b` CONCATENATES — every sum below goes through Decimal methods.
 */

// ============================================================================
// Pure helpers — no Prisma client, no DB. This is what the spec hammers.
// ============================================================================

export const INVOICE_STATUSES = ['DUE', 'PARTIAL', 'PAID', 'FREE', 'WAIVED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const MS_PER_DAY = 86_400_000;
const ZERO = new Prisma.Decimal(0);

function dec(v: DecimalLike): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/** First day of the month containing `d`, at UTC midnight. THE periodMonth key. */
export function firstOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Whole days in [start, endExclusive). Both must be UTC midnights. */
function daysBetweenUtc(start: Date, endExclusive: Date): number {
  return Math.round((endExclusive.getTime() - start.getTime()) / MS_PER_DAY);
}

/** Calendar length of the month containing `d` — 28 / 29 / 30 / 31. */
export function daysInMonthUtc(d: Date): number {
  const first = firstOfMonthUtc(d);
  return daysBetweenUtc(first, addMonthsUtc(first, 1));
}

/**
 * The date rent falls due in a given month.
 *
 * `rentDueDay` is null-safe (null => the 1st) and CLAMPED to the length of the
 * month, so a lease with rentDueDay 31 falls due 28 Feb — or 29 Feb in a leap
 * year — instead of overflowing into March.
 *
 * The result is then pulled inside the days actually billed. Without that, a
 * lease starting 15 Mar with rentDueDay 1 would be born overdue, and a lease
 * ending 14 Sep with rentDueDay 25 would fall due after the tenant had gone.
 */
export function resolveDueDate(
  month: Date,
  rentDueDay?: number | null,
  firstBilledDay?: Date | null,
  lastBilledDay?: Date | null,
): Date {
  const first = firstOfMonthUtc(month);
  const monthDays = daysInMonthUtc(first);
  const requested = rentDueDay == null ? 1 : Math.trunc(rentDueDay);
  const day = Math.min(Math.max(requested, 1), monthDays);
  let due = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day));
  if (firstBilledDay && due < startOfUtcDay(firstBilledDay)) due = startOfUtcDay(firstBilledDay);
  if (lastBilledDay && due > startOfUtcDay(lastBilledDay)) due = startOfUtcDay(lastBilledDay);
  return due;
}

/**
 * The ONLY place status is computed (rule 5). WAIVED never comes out of here —
 * it is set by waive() alone and is sticky until clearPayment() lifts it.
 *
 * A zero amountDue means the covering period was free rent, so the row reads
 * FREE rather than a permanently-unpaid DUE.
 */
export function deriveInvoiceStatus(
  amountDue: DecimalLike,
  amountPaid: DecimalLike,
): InvoiceStatus {
  const due = dec(amountDue);
  const paid = dec(amountPaid);
  if (due.lessThanOrEqualTo(0)) return 'FREE';
  if (paid.lessThanOrEqualTo(0)) return 'DUE';
  // >= not > : an EXACT payment is PAID, not PARTIAL.
  if (paid.greaterThanOrEqualTo(due)) return 'PAID';
  return 'PARTIAL';
}

/** A rent period, reduced to the fields the invoice generator actually needs. */
export interface InvoicePeriodInput {
  id?: string | null;
  startDate: Date;
  /** Inclusive last day. Null = runs to lease end. */
  endDate?: Date | null;
  monthlyRent: DecimalLike;
  isFreeRent?: boolean;
}

export interface RentInvoiceScheduleInput {
  /** Inclusive first day of the term. */
  leaseStart: Date;
  /** Inclusive last day of the term. */
  leaseEnd: Date;
  /** 1-31; null = the 1st. Clamped to short months. */
  rentDueDay?: number | null;
  /** The rent timeline. Empty => no invoices at all. */
  periods: InvoicePeriodInput[];
  /** Bill every month up to and INCLUDING the month containing this date. */
  through: Date;
}

export interface ComputedRentInvoice {
  /** First day of the billed month, UTC midnight. */
  periodMonth: Date;
  dueDate: Date;
  amountDue: Prisma.Decimal;
  isProrated: boolean;
  billedDays: number;
  monthDays: number;
  /** True when the covering period was abated — the row exists at amountDue 0. */
  isFreeRent: boolean;
  periodId: string | null;
  /** The full-month rate this was derived from. Not persisted; handy for previews. */
  monthlyRent: Prisma.Decimal;
}

/**
 * Latest-start-wins lookup, mirroring LeaseRentPeriodService.getEffectivePeriod
 * so the invoice and the rent roll can never disagree about the rate on a day.
 */
export function findCoveringPeriod(
  periods: InvoicePeriodInput[],
  day: Date,
): InvoicePeriodInput | null {
  const at = startOfUtcDay(day);
  let best: InvoicePeriodInput | null = null;
  let bestStart = -Infinity;
  for (const p of periods) {
    const start = startOfUtcDay(p.startDate);
    if (start > at) continue;
    if (p.endDate && startOfUtcDay(p.endDate) < at) continue;
    // >= so that, among equal starts, the LAST one listed (highest sequence) wins.
    if (start.getTime() >= bestStart) {
      best = p;
      bestStart = start.getTime();
    }
  }
  return best;
}

/**
 * THE maths. Builds the whole invoice list from plain dates and numbers.
 *
 *   1. Clip the horizon to min(term end, month containing `through`).
 *   2. Walk calendar months from the term's first month.
 *   3. Intersect each month with the term to get billedDays / monthDays.
 *   4. Bill at the rate in force on the first billed day; free periods bill 0.
 */
export function computeRentInvoiceSchedule(
  input: RentInvoiceScheduleInput,
): ComputedRentInvoice[] {
  const periods = [...(input.periods ?? [])].sort(
    (a, b) => startOfUtcDay(a.startDate).getTime() - startOfUtcDay(b.startDate).getTime(),
  );
  if (periods.length === 0) return [];

  const termStart = startOfUtcDay(input.leaseStart);
  const termEnd = resolveTermEnd(termStart, input.leaseEnd, periods);
  if (termEnd < termStart) {
    throw new BadRequestException('leaseEnd must be on or after leaseStart');
  }
  const termEndExclusive = addDaysUtc(termEnd, 1);

  const horizonMonth = firstOfMonthUtc(startOfUtcDay(input.through));
  const lastTermMonth = firstOfMonthUtc(termEnd);
  const stopMonth = horizonMonth < lastTermMonth ? horizonMonth : lastTermMonth;

  const out: ComputedRentInvoice[] = [];
  for (
    let month = firstOfMonthUtc(termStart);
    month <= stopMonth;
    month = addMonthsUtc(month, 1)
  ) {
    const nextMonth = addMonthsUtc(month, 1);
    const monthDays = daysBetweenUtc(month, nextMonth);

    const billStart = month < termStart ? termStart : month;
    const billEndExclusive = nextMonth < termEndExclusive ? nextMonth : termEndExclusive;
    const billedDays = daysBetweenUtc(billStart, billEndExclusive);
    // A term that starts on the last day of a month still bills that one day;
    // only a genuinely empty intersection is skipped.
    if (billedDays <= 0) continue;

    const period = findCoveringPeriod(periods, billStart);
    // No period covering the month means the timeline has a hole. Emitting a
    // guessed invoice would be worse than the gap — skip and let the rent
    // period generator be re-run.
    if (!period) continue;

    const monthlyRent = round2(period.monthlyRent);
    const isFreeRent = period.isFreeRent === true;
    const amountDue = isFreeRent
      ? ZERO
      : // Single rounding, half-up, on the final product (see ROUNDING RULE).
        round2(monthlyRent.mul(billedDays).div(monthDays));

    out.push({
      periodMonth: month,
      dueDate: resolveDueDate(
        month,
        input.rentDueDay,
        billStart,
        addDaysUtc(billEndExclusive, -1),
      ),
      amountDue,
      isProrated: billedDays < monthDays,
      billedDays,
      monthDays,
      isFreeRent,
      periodId: period.id ?? null,
      monthlyRent,
    });
  }
  return out;
}

/**
 * Where the billable term actually stops.
 *
 * Prefer the last period's endDate when every period is bounded: the rent
 * period generator has already resolved the awkward cases (notably a leaseEnd
 * stored exclusive-style as the day AFTER the term, which would otherwise
 * produce a bogus one-day invoice in the following month). Fall back to
 * leaseEnd when any period is open-ended.
 */
function resolveTermEnd(
  termStart: Date,
  leaseEnd: Date,
  periods: InvoicePeriodInput[],
): Date {
  const contractEnd = startOfUtcDay(leaseEnd);
  if (periods.some((p) => !p.endDate)) return contractEnd;
  let last = termStart;
  for (const p of periods) {
    const end = startOfUtcDay(p.endDate as Date);
    if (end > last) last = end;
  }
  return last < contractEnd ? last : contractEnd;
}

/** Pure counterpart of `summaryForLease` — sums a list of persisted rows. */
export function summariseInvoices(
  rows: Array<{ amountDue: DecimalLike; amountPaid: DecimalLike; status: string; dueDate: Date }>,
  asOf: Date = new Date(),
) {
  const at = startOfUtcDay(asOf);
  let billed = ZERO;
  let collected = ZERO;
  let overdueCount = 0;

  for (const row of rows) {
    // A waived month is no longer owed, so it leaves the billed total; anything
    // actually collected against it still counts as money that moved. Same rule
    // as LeaseObligationService.aggregate.
    if (row.status !== 'WAIVED') billed = billed.plus(dec(row.amountDue));
    collected = collected.plus(dec(row.amountPaid));
    // Due TODAY is not yet overdue.
    if (isOverdueRow(row, at)) overdueCount++;
  }

  return {
    invoiceCount: rows.length,
    billed: toNumber(billed),
    collected: toNumber(collected),
    outstanding: toNumber(billed.minus(collected)),
    overdueCount,
  };
}

/** FREE, PAID and WAIVED rows are never overdue — only DUE and PARTIAL can be. */
function isOverdueRow(row: { status: string; dueDate: Date }, at: Date): boolean {
  if (row.status !== 'DUE' && row.status !== 'PARTIAL') return false;
  return startOfUtcDay(row.dueDate) < at;
}

function toNumber(d: Prisma.Decimal): number {
  return Number(d.toFixed(2));
}

// ============================================================================
// Service
// ============================================================================

export interface GenerateInvoicesOptions {
  /** Bill through the month containing this date. Defaults to today. */
  through?: Date;
}

export interface RecordRentPaymentInput {
  /** The TOTAL received for the month. Sets the mirror — never added to it. */
  amountPaid: DecimalLike;
  paidAt?: string | Date | null;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
  recordedById?: string | null;
}

/** Minimal lease shape the generator needs. */
type LeaseForInvoicing = {
  id: string;
  leaseStart: Date;
  leaseEnd: Date;
  monthlyRent: Prisma.Decimal;
  rentDueDay: number | null;
};

@Injectable()
export class LeaseRentInvoiceService {
  constructor(private prisma: PrismaService) {}

  // ─────── Reads ───────

  /** Every invoice on a lease, oldest month first. */
  async findByLease(leaseId: string) {
    return this.prisma.leaseRentInvoice.findMany({
      where: { leaseId },
      orderBy: { periodMonth: 'asc' },
      include: { recordedBy: { select: { id: true, name: true, email: true } } },
    });
  }

  /**
   * Every invoice across ALL leases on a unit, oldest month first.
   *
   * Deliberately not scoped to one lease: a unit that was re-let must read as a
   * single continuous payment timeline, with the old tenant's arrears still
   * visible under the new tenancy.
   */
  async findByUnit(unitId: string) {
    return this.prisma.leaseRentInvoice.findMany({
      where: { lease: { unitId, deletedAt: null } },
      orderBy: [{ periodMonth: 'asc' }, { leaseId: 'asc' }],
      include: {
        lease: {
          select: { id: true, tenantName: true, status: true, leaseStart: true, leaseEnd: true },
        },
      },
    });
  }

  async findById(id: string) {
    const invoice = await this.prisma.leaseRentInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Rent invoice not found');
    return invoice;
  }

  // ─────── Generation ───────

  /**
   * Backfill every month from leaseStart to today (or `through`).
   *
   * APPEND-ONLY: `createMany({ skipDuplicates: true })` on
   * `@@unique([leaseId, periodMonth])`. Existing rows are never touched, so
   * re-running this can neither duplicate a month nor stomp a payment that has
   * already been recorded — including under a concurrent double-call.
   */
  async generateForLease(leaseId: string, opts: GenerateInvoicesOptions = {}) {
    const lease = await this.loadLease(leaseId);
    const periods = await this.loadPeriods(leaseId);
    const computed = computeRentInvoiceSchedule(
      this.toScheduleInput(lease, periods, opts.through ?? new Date()),
    );
    await this.createMissing(leaseId, computed);
    return this.findByLease(leaseId);
  }

  /**
   * Cron entry point: bring every ACTIVE lease's ledger up to `asOf`.
   * Same append-only guarantee as generateForLease.
   */
  async generateDueThrough(asOf: Date = new Date()) {
    const through = startOfUtcDay(asOf);
    const leases = await this.prisma.lease.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      include: { rentPeriods: { orderBy: [{ startDate: 'asc' }, { sequence: 'asc' }] } },
    });

    let invoicesCreated = 0;
    const leaseIds: string[] = [];
    for (const lease of leases) {
      const computed = computeRentInvoiceSchedule(
        this.toScheduleInput(lease, lease.rentPeriods ?? [], through),
      );
      const created = await this.createMissing(lease.id, computed);
      if (created > 0) {
        invoicesCreated += created;
        leaseIds.push(lease.id);
      }
    }
    return { asOf: through, leasesProcessed: leases.length, invoicesCreated, leaseIds };
  }

  // ─────── Collection ───────

  /**
   * Record what was received for a month.
   *
   * `amountPaid` is the TOTAL for the month and REPLACES the stored value — it
   * is never added to it (rule 6), so a double-submitted form or a retried
   * request cannot inflate collections. To correct a mistake, call again with
   * the right total, or clearPayment() to zero it.
   *
   * Overpayment is allowed and lands on PAID: rent genuinely arrives rounded up
   * or bundled with a deposit, and refusing the entry would leave Finance with
   * money in the bank they cannot record anywhere.
   */
  async recordPayment(invoiceId: string, input: RecordRentPaymentInput) {
    const amountPaid = this.toMoney(input.amountPaid, 'Payment amount');
    if (amountPaid.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'Payment amount must be greater than zero — use clearPayment to undo an entry',
      );
    }

    const invoice = await this.findById(invoiceId);
    if (invoice.status === 'WAIVED') {
      throw new BadRequestException(
        'This month is waived; clear it before recording a payment against it',
      );
    }
    const amountDue = new Prisma.Decimal(invoice.amountDue);
    if (amountDue.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'This is a free-rent month — there is nothing to collect against it',
      );
    }

    return this.prisma.leaseRentInvoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid,
        paidAt: this.toDate(input.paidAt) ?? new Date(),
        method: input.method ?? null,
        reference: input.reference ?? null,
        // Undefined leaves the existing note alone; null clears it explicitly.
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        recordedById: input.recordedById ?? null,
        status: deriveInvoiceStatus(amountDue, amountPaid),
      },
    });
  }

  /**
   * Undo a mis-keyed entry. Resets the mirror to 0 and re-derives status from
   * amountDue, so a FREE month goes back to FREE and everything else to DUE.
   * Also lifts a waiver — this is the only un-waive path.
   * `notes` survive: they are the audit trail of what went wrong.
   */
  async clearPayment(invoiceId: string) {
    const invoice = await this.findById(invoiceId);
    return this.prisma.leaseRentInvoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: ZERO,
        paidAt: null,
        method: null,
        reference: null,
        recordedById: null,
        status: deriveInvoiceStatus(new Prisma.Decimal(invoice.amountDue), ZERO),
      },
    });
  }

  /**
   * Forgive a month (goodwill credit, disputed period). The one status a caller
   * sets explicitly. Anything already collected stays on the row — only the
   * status changes — so the money mirror never lies.
   */
  async waive(invoiceId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to waive a rent invoice');
    }
    const invoice = await this.findById(invoiceId);
    if (invoice.status === 'WAIVED') {
      throw new BadRequestException('This invoice is already waived');
    }

    const stamp = `Waived: ${reason.trim()}`;
    return this.prisma.leaseRentInvoice.update({
      where: { id: invoiceId },
      data: {
        status: 'WAIVED',
        notes: invoice.notes ? `${invoice.notes}\n${stamp}` : stamp,
      },
    });
  }

  // ─────── Rollups ───────

  /** Collection position for one lease. Waived months drop out of `billed`. */
  async summaryForLease(leaseId: string, asOf: Date = new Date()) {
    const rows = await this.prisma.leaseRentInvoice.findMany({
      where: { leaseId },
      select: { amountDue: true, amountPaid: true, status: true, dueDate: true },
    });
    return { leaseId, ...summariseInvoices(rows, asOf) };
  }

  /**
   * Every unpaid month whose due date has passed. Drives the RENT_OVERDUE
   * notification, so FREE, PAID and WAIVED rows are excluded at the query level
   * — a free month can never chase a tenant.
   */
  async findOverdue(asOf: Date = new Date()) {
    const at = startOfUtcDay(asOf);
    const rows = await this.prisma.leaseRentInvoice.findMany({
      where: {
        // Due TODAY is not yet overdue.
        dueDate: { lt: at },
        status: { in: ['DUE', 'PARTIAL'] },
        lease: { deletedAt: null },
      },
      orderBy: [{ dueDate: 'asc' }],
      include: {
        lease: {
          select: {
            id: true,
            tenantName: true,
            status: true,
            unitId: true,
            buildingId: true,
            unit: { select: { id: true, unitNumber: true, buildingId: true } },
          },
        },
      },
    });

    return rows.map((row) => {
      const due = new Prisma.Decimal(row.amountDue);
      const paid = new Prisma.Decimal(row.amountPaid);
      return {
        ...row,
        outstanding: toNumber(due.minus(paid)),
        daysOverdue: Math.round(
          (at.getTime() - startOfUtcDay(row.dueDate).getTime()) / MS_PER_DAY,
        ),
      };
    });
  }

  // ─────── Internals ───────

  private async loadLease(leaseId: string): Promise<LeaseForInvoicing> {
    const lease = await this.prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.deletedAt) throw new NotFoundException('Lease not found');
    return lease as LeaseForInvoicing;
  }

  private async loadPeriods(leaseId: string) {
    return this.prisma.leaseRentPeriod.findMany({
      where: { leaseId },
      orderBy: [{ startDate: 'asc' }, { sequence: 'asc' }],
    });
  }

  /**
   * Insert only the months that do not exist yet. Returns how many were added.
   * The `skipDuplicates` flag is load-bearing — see rule 7.
   */
  private async createMissing(
    leaseId: string,
    computed: ComputedRentInvoice[],
  ): Promise<number> {
    if (computed.length === 0) return 0;
    const result = await this.prisma.leaseRentInvoice.createMany({
      data: computed.map((c) => this.toCreateData(leaseId, c)),
      skipDuplicates: true,
    });
    return result?.count ?? 0;
  }

  private toCreateData(
    leaseId: string,
    c: ComputedRentInvoice,
  ): Prisma.LeaseRentInvoiceCreateManyInput {
    return {
      leaseId,
      periodId: c.periodId,
      periodMonth: c.periodMonth,
      dueDate: c.dueDate,
      amountDue: c.amountDue,
      amountPaid: ZERO,
      isProrated: c.isProrated,
      billedDays: c.billedDays,
      monthDays: c.monthDays,
      // Derived at creation like everywhere else: 0 due => FREE, otherwise DUE.
      status: deriveInvoiceStatus(c.amountDue, ZERO),
    };
  }

  /**
   * A lease with no rent periods is a legacy row created before the timeline
   * generator existed. Rather than refusing to bill it, synthesise one flat
   * period from lease.monthlyRent across the whole term. Escalations and free
   * rent are unavailable in that mode — generate the rent periods to get them.
   */
  private toScheduleInput(
    lease: LeaseForInvoicing,
    periods: InvoicePeriodInput[],
    through: Date,
  ): RentInvoiceScheduleInput {
    const effective: InvoicePeriodInput[] =
      periods.length > 0
        ? periods
        : [
            {
              id: null,
              startDate: lease.leaseStart,
              endDate: lease.leaseEnd,
              monthlyRent: lease.monthlyRent,
              isFreeRent: false,
            },
          ];
    return {
      leaseStart: lease.leaseStart,
      leaseEnd: lease.leaseEnd,
      rentDueDay: lease.rentDueDay,
      periods: effective,
      through,
    };
  }

  private toMoney(value: DecimalLike, label: string): Prisma.Decimal {
    let parsed: Prisma.Decimal;
    try {
      parsed = new Prisma.Decimal(value as Prisma.Decimal.Value);
    } catch {
      throw new BadRequestException(`${label} must be a number`);
    }
    if (!parsed.isFinite()) throw new BadRequestException(`${label} must be a number`);
    return round2(parsed);
  }

  private toDate(value?: string | Date | null): Date | null {
    if (value === undefined || value === null) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid date');
    return date;
  }
}
