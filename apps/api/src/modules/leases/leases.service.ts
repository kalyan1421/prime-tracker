import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NOT_ON_SOLD_UNIT } from './lease-filters';
import { Prisma } from '@prisma/client';
import {
  LeaseRentPeriodService, startOfUtcDay, addMonthsUtc, monthsBetweenUtc,
} from './lease-rent-period.service';
import { EventBus } from '../../common/events/event-bus.service';
import { LeaseObligationService } from './lease-obligation.service';
import { LeaseRentInvoiceService } from './lease-rent-invoice.service';
import { AuditService } from '../../common/utils/audit.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';

/**
 * Why a tenancy ended. The first six end it for good; the last four say the tenancy
 * CONTINUES somewhere — under a new lease (RENEWED), on another unit (RELOCATED), with
 * a new party (ASSIGNED), or because the tenant bought the place (TENANT_BOUGHT).
 */
export const TERMINATION_REASONS = [
  'EXPIRED',
  'NON_RENEWAL',
  'EARLY_TERMINATION',
  'EVICTION',
  'MUTUAL',
  'LANDLORD_TERMINATED',
  'RENEWED',
  'RELOCATED',
  'ASSIGNED',
  'TENANT_BOUGHT',
] as const;
export type TerminationReason = (typeof TERMINATION_REASONS)[number];

/** What happens to the security deposit. See LeasesService.settleDeposit. */
export const DEPOSIT_DISPOSITIONS = ['REFUND', 'FORFEIT', 'TRANSFER', 'DECIDE_LATER'] as const;
export type DepositDisposition = (typeof DEPOSIT_DISPOSITIONS)[number];

/** Why the lease changed hands without ending. */
export const ASSIGNMENT_REASONS = [
  'BUSINESS_SALE',
  'NOVATION',
  'ENTITY_RESTRUCTURE',
  'OTHER',
] as const;
export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];

export interface AssignTenantInput {
  /** When the assignment takes legal effect — not when it was typed in. */
  effectiveDate: string | Date;
  toTenantName: string;
  toTenantLegalName?: string | null;
  toTenantContact?: string | null;
  toTenantEmail?: string | null;
  toTenantPhone?: string | null;
  reason?: AssignmentReason;
  note?: string;
  /** The executed assignment agreement in the doc vault. */
  documentId?: string;
}

/**
 * A past tenancy, entered by hand (H2).
 *
 * Everything here already happened. That is what makes it different from `create`: the
 * unit's CURRENT status must not move, the ledger is written complete rather than
 * accruing, and the occupancy events are backdated.
 */
export interface BackfillTenancyInput {
  unitId: string;
  tenantName: string;
  tenantLegalName?: string;
  tenantBrand?: string;
  leaseStart: string | Date;
  leaseEnd: string | Date;
  /** When they actually left. Must be in the past — that is what makes this history. */
  terminationDate: string | Date;
  terminationReason?: TerminationReason;
  monthlyRent: number;
  rentStartDate?: string | Date;
  securityDeposit?: number;
  rentDueDay?: number;
  notes?: string;
  /**
   * Months where collection differed from "paid in full", as { 'YYYY-MM': amount }.
   *
   * Client confirmed 2026-08-13 that per-month collection history IS known, so this is
   * real data rather than reconstruction. Anything omitted defaults to PAID IN FULL —
   * the 2026-08-12 decision, so a historical ledger never shows up as overdue AR.
   */
  collections?: Record<string, number>;
}

export interface EndTenancyInput {
  /** The date the tenant actually left — not the contracted expiry. */
  terminationDate: string | Date;
  terminationReason: TerminationReason;
  terminationNote?: string;
  /** The lease that continues this tenancy: a renewal or a relocation. */
  successorLeaseId?: string;
  depositDisposition?: DepositDisposition;
  depositNote?: string;
}

/**
 * Which rent period covers `at`, given periods sorted newest-start-first.
 *
 * Mirrors LeaseRentPeriodService.getEffectivePeriod exactly: the newest period
 * whose start is on or before `at` and which hasn't ended wins. That is what
 * lets a mid-term MANUAL renegotiation supersede an earlier row without the
 * earlier row's endDate ever being edited (past periods are immutable).
 */
function pickPeriodCovering<T extends { startDate: Date; endDate: Date | null }>(
  periodsNewestFirst: T[],
  at: Date,
): T | null {
  const day = startOfUtcDay(at);
  for (const p of periodsNewestFirst) {
    if (startOfUtcDay(p.startDate) > day) continue;
    if (p.endDate !== null && startOfUtcDay(p.endDate) < day) continue;
    return p;
  }
  return null;
}

/**
 * Fields whose change invalidates the generated rent schedule. Editing any of
 * these re-derives the FUTURE periods (past ones stay frozen).
 */
/**
 * Lease fields whose change is worth putting on the unit's timeline, with the label to
 * show and how to render the value.
 *
 * A whitelist rather than "diff everything": the audit interceptor already logs the raw
 * request body, and that body contains every field the form posts on every save — which
 * is why it cannot answer "what changed". This list is the set a reader of a unit's
 * history would care about, and the diff is computed against the stored row so an
 * unchanged field that was merely re-submitted does not appear.
 */
const TRACKED_LEASE_FIELDS: Array<{ field: string; label: string; type: 'money' | 'date' | 'pct' | 'text' }> = [
  { field: 'monthlyRent', label: 'Monthly rent', type: 'money' },
  { field: 'rentPerSqft', label: 'Base rent /sqft', type: 'money' },
  { field: 'nnnPerSqft', label: 'NNN /sqft', type: 'money' },
  { field: 'nnnTotalAmount', label: 'NNN total', type: 'money' },
  { field: 'securityDeposit', label: 'Security deposit', type: 'money' },
  { field: 'tiAllowance', label: 'TI allowance', type: 'money' },
  { field: 'leaseStart', label: 'Lease start', type: 'date' },
  { field: 'rentStartDate', label: 'Rent start', type: 'date' },
  { field: 'leaseEnd', label: 'Rent end', type: 'date' },
  { field: 'termMonths', label: 'Term (months)', type: 'text' },
  { field: 'escalationPct', label: 'Escalation', type: 'pct' },
  { field: 'escalationFreq', label: 'Escalation interval', type: 'text' },
  { field: 'freeRentMonths', label: 'Free months', type: 'text' },
  { field: 'freeRentStartDate', label: 'Free rent starts', type: 'date' },
  { field: 'rentDueDay', label: 'Rent due day', type: 'text' },
  { field: 'status', label: 'Status', type: 'text' },
  { field: 'tenantName', label: 'Tenant', type: 'text' },
  { field: 'tenantLegalName', label: 'Tenant legal name', type: 'text' },
  { field: 'tenantBrand', label: 'Brand', type: 'text' },
  { field: 'tenantContact', label: 'Contact', type: 'text' },
  { field: 'tenantEmail', label: 'Email', type: 'text' },
  { field: 'tenantPhone', label: 'Phone', type: 'text' },
  { field: 'brokerCommissionPct', label: 'Commission %', type: 'pct' },
  { field: 'brokerCommissionBasis', label: 'Commission basis', type: 'text' },
  { field: 'notes', label: 'Notes', type: 'text' },
];

const SCHEDULE_INPUT_FIELDS = [
  'monthlyRent', 'escalationPct', 'escalationFreq',
  'freeRentMonths', 'freeRentStartDate', 'leaseStart', 'leaseEnd',
  // rentStartDate is the schedule's ORIGIN — omitting it here would leave a stale
  // schedule behind after an edit that changed exactly what it derives from.
  // (nnnMonthly used to sit here too; NNN no longer touches the rent timeline.)
  'rentStartDate',
] as const;

@Injectable()
export class LeasesService {
  private readonly logger = new Logger(LeasesService.name);

  constructor(
    private prisma: PrismaService,
    private rentPeriods: LeaseRentPeriodService,
    private bus: EventBus,
    private obligations: LeaseObligationService,
    private audit: AuditService,
    private invoices: LeaseRentInvoiceService,
    private statusEvents: UnitStatusEventService,
  ) {}

  /**
   * End a tenancy: the one action behind turnover, renewal and relocation.
   *
   * Everything here used to be done by hand in four places — flip the status, remember
   * the unit, remember the invoices, remember the deposit — and the unit was the step
   * people skipped, which left it LEASED with `availableSince` unset and therefore
   * invisible to the vacancy report and the stale-unit feed. That is the R8 bug being
   * re-created one lease at a time, so the unit write is not optional here.
   *
   * One transaction. A lease marked terminated whose schedule still runs, or whose unit
   * still reads LEASED, is worse than a refusal.
   */
  async endTenancy(id: string, input: EndTenancyInput, userId?: string) {
    const result = await this.prisma.$transaction((tx) =>
      this.endTenancyWithin(tx, id, input, userId),
    );

    // Outside the transaction on purpose: a notification must never go out for a
    // termination that then rolls back.
    const projectId = await this.resolveProjectId(result.lease);
    if (projectId) {
      this.bus.emit({
        type: 'lease.terminated',
        leaseId: id,
        projectId,
        tenantName: result.lease.tenantName,
        reason: input.terminationReason,
      } as any);
    }
    await this.auditTenancyEnd(id, input, result, userId);
    return result;
  }

  /**
   * The same operation, on a transaction the CALLER owns.
   *
   * Exists because closing a sale must end the tenancy in the sale's own transaction —
   * a unit that reads SOLD while its lease is still running is the exact inconsistency
   * both operations exist to prevent, and it cannot be fixed by doing them in sequence.
   *
   * Deliberately emits NOTHING: no bus event, no audit row. The caller's transaction may
   * still roll back after this returns, and a notification for a sale that did not
   * happen is worse than a late one. The caller emits after it commits.
   */
  async endTenancyWithin(
    tx: Prisma.TransactionClient,
    id: string,
    input: EndTenancyInput,
    userId?: string,
  ) {
    const before = await tx.lease.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundException('Lease not found');
    if (before.terminationDate) {
      throw new BadRequestException(
        `This tenancy already ended on ${before.terminationDate.toISOString().slice(0, 10)}. ` +
        'Edit the move-out date on the lease instead of ending it again.',
      );
    }

    const terminationDate = startOfUtcDay(new Date(input.terminationDate));
    if (Number.isNaN(terminationDate.getTime())) {
      throw new BadRequestException('A valid move-out date is required');
    }
    if (terminationDate < startOfUtcDay(before.leaseStart)) {
      throw new BadRequestException('Move-out date cannot be before the lease start date');
    }
    if (!input.terminationReason) {
      throw new BadRequestException('A reason is required to end a tenancy');
    }

    // Hard stop: money already collected for months after the move-out. Either the date
    // is wrong or a refund is owed, and neither is something an automated void should
    // decide. Name the months so whoever hit this can act on it.
    const paid = await this.invoices.paidAfter(id, terminationDate);
    if (paid.length > 0) {
      const months = paid.map((p) => p.periodMonth.toISOString().slice(0, 7)).join(', ');
      throw new BadRequestException(
        `Rent has already been collected for ${months}, after the move-out date of ` +
        `${terminationDate.toISOString().slice(0, 10)}. Correct the move-out date, or ` +
        'clear those payments first if they were recorded in error.',
      );
    }

    const successor = await this.loadSuccessor(input.successorLeaseId, id, before.unitId);

    // EXPIRED vs TERMINATED is derived, not asked for. Someone who runs to the end of
    // their term did not "terminate" anything, and making the caller choose invites the
    // two to disagree with the dates.
    const status = terminationDate >= startOfUtcDay(before.leaseEnd) ? 'EXPIRED' : 'TERMINATED';

    // Whether the unit becomes vacant is derived from the successor, not asked for:
    //   - successor on the SAME unit  → renewal, occupancy is continuous, no vacancy
    //   - successor on a DIFFERENT unit → relocation, THIS unit is released
    //   - no successor                → turnover, released
    const continuesOnSameUnit = !!successor && successor.unitId === before.unitId;
    const releaseUnit = !continuesOnSameUnit;

    const result = await (async () => {
      const lease = await tx.lease.update({
        where: { id },
        data: {
          terminationDate,
          terminationReason: input.terminationReason,
          terminationNote: input.terminationNote?.trim() || null,
          successorLeaseId: successor?.id ?? null,
          status,
        },
      });

      const schedule = await this.rentPeriods.capAtTermination(id, terminationDate, tx);
      const voided = await this.invoices.voidAfter(
        id,
        terminationDate,
        `Tenancy ended ${terminationDate.toISOString().slice(0, 10)}`,
        tx,
      );

      const deposit = await this.settleDeposit(tx, id, input, successor?.id, terminationDate);

      let unitEventId: string | null = null;
      if (before.unitId && releaseUnit) {
        const unit = await tx.unit.findUnique({
          where: { id: before.unitId },
          select: { status: true },
        });
        // A SOLD unit is not released by a lease ending — the tenant buying the unit is
        // exactly the TENANT_BOUGHT case, and flipping it back to AVAILABLE would undo
        // the sale. Leave the status and still log the lease ending against it.
        const releasable = unit && unit.status !== 'SOLD';
        if (releasable) {
          await tx.unit.update({
            where: { id: before.unitId },
            // availableSince is the time-on-market clock. Setting it here is the whole
            // point: it is what the vacancy report and stale-unit feed age from.
            data: { status: 'AVAILABLE', availableSince: terminationDate },
          });
        }
        // `record`, not `recordIfChanged`, even though from and to are often the same
        // status. Nothing currently flips a unit to LEASED when its lease activates, so
        // a released unit is frequently AVAILABLE → AVAILABLE — and that event is still
        // the one that matters: currentVacancyStartByUnit takes the LATEST event landing
        // on AVAILABLE, so this is what restarts the time-on-market clock at the move-out
        // date. Suppressing it would date the vacancy from whenever the unit was created.
        const event = await this.statusEvents.record(
          {
            unitId: before.unitId,
            fromStatus: unit?.status ?? null,
            toStatus: releasable ? 'AVAILABLE' : (unit?.status ?? 'AVAILABLE'),
            effectiveAt: terminationDate,
            source: 'LEASE_ENDED',
            leaseId: id,
            reason: this.tenancyEndReason(input, successor),
            recordedById: userId,
          },
          tx,
        );
        unitEventId = event.id;
      }

      // Relocation: the tenancy continues, but on a different unit. That unit's own
      // occupancy is driven by ITS lease activation, not from here — writing it would
      // be this method reaching into a lease it was not asked about.
      return { lease, schedule, voided, deposit, unitEventId };
    })();

    return {
      lease: result.lease,
      unitReleased: releaseUnit && !!before.unitId,
      invoicesVoided: result.voided,
      periodsDeleted: result.schedule.deleted,
      periodsTruncated: result.schedule.truncated,
      deposit: result.deposit,
    };
  }

  /** Audit trail for a completed tenancy end. Non-fatal — same rule as AuditService. */
  private async auditTenancyEnd(
    id: string,
    input: EndTenancyInput,
    result: {
      invoicesVoided: number;
      periodsDeleted: number;
      lease: { successorLeaseId?: string | null };
    },
    userId?: string,
  ) {
    await this.audit.log({
      userId,
      action: 'LEASE_TENANCY_ENDED',
      entity: 'Lease',
      entityId: id,
      newValues: {
        terminationDate: input.terminationDate,
        terminationReason: input.terminationReason,
        successorLeaseId: result.lease.successorLeaseId ?? null,
        invoicesVoided: result.invoicesVoided,
        periodsDeleted: result.periodsDeleted,
        depositDisposition: input.depositDisposition ?? 'DECIDE_LATER',
      },
    });
  }

  /**
   * Assign the lease to a new tenant. The fourth transition, and the only one where
   * the lease DOCUMENT survives — the business is sold, or the tenant restructures its
   * entity, and a new party steps into the existing contract.
   *
   * What this deliberately does NOT do is as important as what it does: no new lease,
   * no schedule change, no invoice change, no obligation change, no unit status change.
   * An assignment does not interrupt occupancy or billing, and a version of this that
   * "helpfully" regenerated anything would break the one guarantee it exists to give.
   *
   * The assignment row is what makes it safe. Editing `Lease.tenantName` in place is a
   * silent rewrite of history: last year's invoices would read as billed to a party
   * that did not exist yet. The row keeps the outgoing name, so "who was the tenant on
   * date X" stays answerable.
   */
  async assignTenant(id: string, input: AssignTenantInput, userId?: string) {
    const lease = await this.prisma.lease.findUnique({ where: { id } });
    if (!lease || lease.deletedAt) throw new NotFoundException('Lease not found');

    const toTenantName = input.toTenantName?.trim();
    if (!toTenantName) throw new BadRequestException('The new tenant name is required');

    const effectiveDate = startOfUtcDay(new Date(input.effectiveDate));
    if (Number.isNaN(effectiveDate.getTime())) {
      throw new BadRequestException('A valid effective date is required');
    }
    if (effectiveDate < startOfUtcDay(lease.leaseStart)) {
      throw new BadRequestException(
        'The assignment cannot take effect before the lease started',
      );
    }
    // Assigning a contract that has already ended is not a transfer of anything. If the
    // tenancy ended and a new party is taking the space, that is a NEW lease.
    if (lease.terminationDate && effectiveDate > startOfUtcDay(lease.terminationDate)) {
      throw new BadRequestException(
        `This tenancy ended on ${lease.terminationDate.toISOString().slice(0, 10)}. ` +
        'A party taking the space after that needs a new lease, not an assignment.',
      );
    }

    // Assignments are a chronological chain — each one's "from" is the previous one's
    // "to". Accepting one dated before the last would break that, and with it the
    // ability to answer who the tenant was on any given date.
    const latest = await this.prisma.leaseTenantAssignment.findFirst({
      where: { leaseId: id },
      orderBy: { effectiveDate: 'desc' },
      select: { effectiveDate: true, toTenantName: true },
    });
    if (latest && effectiveDate < startOfUtcDay(latest.effectiveDate)) {
      throw new BadRequestException(
        `This lease was already assigned to ${latest.toTenantName} on ` +
        `${latest.effectiveDate.toISOString().slice(0, 10)}. Record assignments in order.`,
      );
    }

    if (toTenantName === lease.tenantName) {
      throw new BadRequestException(
        `${toTenantName} is already the tenant on this lease — nothing to assign`,
      );
    }

    const assignment = await this.prisma.$transaction(async (tx) => {
      const row = await tx.leaseTenantAssignment.create({
        data: {
          leaseId: id,
          effectiveDate,
          // Snapshot of the outgoing party. The lease row is about to be overwritten
          // with the incoming one, so this is the only place the old name survives.
          fromTenantName: lease.tenantName,
          fromTenantLegalName: lease.tenantLegalName,
          toTenantName,
          toTenantLegalName: input.toTenantLegalName?.trim() || null,
          toTenantContact: input.toTenantContact?.trim() || null,
          toTenantEmail: input.toTenantEmail?.trim() || null,
          toTenantPhone: input.toTenantPhone?.trim() || null,
          reason: input.reason ?? null,
          note: input.note?.trim() || null,
          documentId: input.documentId ?? null,
          recordedById: userId ?? null,
        },
      });

      await tx.lease.update({
        where: { id },
        data: {
          tenantName: toTenantName,
          // Only overwrite the contact fields the caller actually supplied. An
          // assignment often changes the legal entity while the same people stay in
          // the shop, and blanking their phone number because a form omitted it would
          // lose data nobody asked to lose.
          ...(input.toTenantLegalName !== undefined
            ? { tenantLegalName: input.toTenantLegalName?.trim() || null }
            : {}),
          ...(input.toTenantContact !== undefined
            ? { tenantContact: input.toTenantContact?.trim() || null }
            : {}),
          ...(input.toTenantEmail !== undefined
            ? { tenantEmail: input.toTenantEmail?.trim() || null }
            : {}),
          ...(input.toTenantPhone !== undefined
            ? { tenantPhone: input.toTenantPhone?.trim() || null }
            : {}),
        },
      });

      return row;
    });

    await this.audit.log({
      userId,
      action: 'LEASE_TENANT_ASSIGNED',
      entity: 'Lease',
      entityId: id,
      oldValues: { tenantName: lease.tenantName, tenantLegalName: lease.tenantLegalName },
      newValues: {
        tenantName: toTenantName,
        tenantLegalName: input.toTenantLegalName ?? null,
        effectiveDate,
        reason: input.reason ?? null,
      },
    });

    return assignment;
  }

  /**
   * Enter a tenancy that has already ended (H2 backfill).
   *
   * Composes the ordinary create path rather than duplicating it, so a backfilled lease
   * is a normal lease in every respect — same overlap constraint, same schedule
   * generator, same ledger. Only three things differ, and each is deliberate:
   *
   *  1. The unit's CURRENT status is untouched. syncUnitFromLease only fires for
   *     ACTIVE/DRAFT, and this writes EXPIRED/TERMINATED, so that falls out for free —
   *     but it is the property that matters most: entering 2019's tenant must not
   *     change who the system thinks is in the unit today.
   *  2. The ledger is written COMPLETE and defaults to PAID, so a historical tenancy
   *     never appears as overdue AR (client decision 2026-08-12).
   *  3. Occupancy events are BACKDATED and flagged isHistorical, so the timeline sorts
   *     them by when they happened rather than when they were typed.
   */
  async backfillTenancy(input: BackfillTenancyInput, userId?: string) {
    const leaseStart = startOfUtcDay(new Date(input.leaseStart));
    const leaseEnd = startOfUtcDay(new Date(input.leaseEnd));
    const terminationDate = startOfUtcDay(new Date(input.terminationDate));
    const today = startOfUtcDay(new Date());

    if ([leaseStart, leaseEnd, terminationDate].some((d) => Number.isNaN(d.getTime()))) {
      throw new BadRequestException('Lease start, end and move-out dates must all be valid');
    }
    // The whole point is that this is history. A tenancy that has not ended yet is a
    // live lease and must go through the ordinary flow, where it will drive the unit's
    // status and accrue rent as time passes.
    if (terminationDate > today) {
      throw new BadRequestException(
        'This tenancy has not ended yet. Add it as a normal lease instead — backfill is for '
        + 'tenancies that are already over.',
      );
    }
    if (terminationDate < leaseStart) {
      throw new BadRequestException('The move-out date cannot be before the lease started');
    }

    const unit = await this.prisma.unit.findUnique({
      where: { id: input.unitId },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!unit || unit.deletedAt) throw new NotFoundException('Unit not found');

    // EXPIRED if they ran to term, TERMINATED if they left early — derived exactly as
    // endTenancy derives it, so a backfilled record is indistinguishable from one the
    // system recorded live.
    const status = terminationDate >= leaseEnd ? 'EXPIRED' : 'TERMINATED';

    const lease = await this.create(
      {
        unitId: input.unitId,
        tenantName: input.tenantName,
        tenantLegalName: input.tenantLegalName ?? null,
        tenantBrand: input.tenantBrand ?? null,
        monthlyRent: input.monthlyRent,
        leaseStart,
        leaseEnd,
        rentStartDate: input.rentStartDate ? startOfUtcDay(new Date(input.rentStartDate)) : null,
        rentDueDay: input.rentDueDay ?? null,
        securityDeposit: input.securityDeposit ?? null,
        notes: input.notes ?? null,
        terminationDate,
        terminationReason: input.terminationReason ?? 'EXPIRED',
        status,
        // Marks it as entered after the fact — which is what puts its deletion behind
        // Founder approval (R27).
        isHistorical: true,
      } as any,
      userId,
    );

    // The ledger, complete. generateForLease caps at terminationDate (capAtEnd), so this
    // bills exactly the months they were there and not one more.
    await this.invoices.generateForLease(lease.id, { through: terminationDate });
    const settled = await this.settleHistoricalLedger(lease.id, input.collections);

    // Two events, backdated: in at the start, out at the move-out. isHistorical marks
    // them as entered after the fact so the timeline can say so rather than implying
    // the system watched it happen.
    await this.statusEvents.record({
      unitId: input.unitId,
      fromStatus: null,
      toStatus: 'LEASED',
      effectiveAt: leaseStart,
      source: 'BACKFILL',
      leaseId: lease.id,
      isHistorical: true,
      recordedById: userId,
      reason: `Historical tenancy entered by hand — ${input.tenantName}`,
    });
    await this.statusEvents.record({
      unitId: input.unitId,
      fromStatus: 'LEASED',
      toStatus: 'AVAILABLE',
      effectiveAt: terminationDate,
      source: 'BACKFILL',
      leaseId: lease.id,
      isHistorical: true,
      recordedById: userId,
      reason: `Historical tenancy ended — ${input.tenantName}`,
    });

    await this.audit.log({
      userId,
      action: 'LEASE_HISTORY_BACKFILLED',
      entity: 'Lease',
      entityId: lease.id,
      newValues: { unitId: input.unitId, leaseStart, leaseEnd, terminationDate, ...settled },
    });

    return { lease, ...settled };
  }

  /**
   * Mark a backfilled ledger as collected.
   *
   * Default is PAID IN FULL (client decision 2026-08-12): a tenancy from 2019 showing as
   * overdue AR would put historical debt into today's collection reports. `collections`
   * overrides individual months where the team knows it differed — which they do
   * (confirmed 2026-08-13), so this is recorded fact, not an assumption.
   */
  private async settleHistoricalLedger(leaseId: string, collections?: Record<string, number>) {
    const invoices = await this.prisma.leaseRentInvoice.findMany({
      where: { leaseId },
      select: { id: true, periodMonth: true, amountDue: true, status: true },
    });

    let paidInFull = 0;
    let partial = 0;
    for (const inv of invoices) {
      // FREE months are already settled by definition — nothing was owed.
      if (inv.status === 'FREE') continue;
      const key = inv.periodMonth.toISOString().slice(0, 7);
      const override = collections?.[key];
      const amountPaid = override === undefined ? new Prisma.Decimal(inv.amountDue) : new Prisma.Decimal(override);

      await this.prisma.leaseRentInvoice.update({
        where: { id: inv.id },
        data: {
          amountPaid,
          paidAt: inv.periodMonth,
          status: amountPaid.greaterThanOrEqualTo(inv.amountDue)
            ? 'PAID'
            : amountPaid.greaterThan(0) ? 'PARTIAL' : 'DUE',
          notes: 'Historical — entered during backfill',
        },
      });
      if (override === undefined) paidInFull++; else partial++;
    }
    return { invoicesSettled: invoices.length, paidInFull, withCollectionOverride: partial };
  }

  /** The assignment chain for a lease, oldest first. Drives the unit timeline. */
  async findAssignments(leaseId: string) {
    return this.prisma.leaseTenantAssignment.findMany({
      where: { leaseId },
      orderBy: { effectiveDate: 'asc' },
      include: { recordedBy: { select: { id: true, name: true, email: true } } },
    });
  }

  /**
   * Drive the UNIT's status from the lease that now sits on it.
   *
   * Until this existed, nothing ever set a unit's status from a lease — activation did
   * not touch the unit, and ending one did not either until endTenancy shipped. The
   * result, measured on 2026-08-13: of 113 units that either claimed to be tenanted or
   * actually held a live lease, only 12 agreed with themselves. `Unit.status` was a
   * hand-maintained field duplicating what the lease already knew, and hand maintenance
   * loses at that scale.
   *
   * Deliberately narrow:
   *
   *  - ACTIVE → LEASED. DRAFT → LEASE_PENDING (client-confirmed 2026-08-13: a draft
   *    means signed-but-not-started, so the unit is committed even though nobody has
   *    moved in). This reverses the conservative default first shipped, which left a
   *    draft alone in case it was speculative.
   *  - A SOLD unit is never overwritten. Prime does not own it; a lease on it is a
   *    data-integrity question (there are 8), not a licence to un-sell it.
   *  - Already LEASED or OCCUPIED is a no-op. OCCUPIED is more specific than LEASED —
   *    downgrading it would lose information a human entered on purpose.
   *
   * Runs inside the caller's transaction: a lease that activated without moving its
   * unit is exactly the inconsistency this is here to stop creating.
   */
  private async syncUnitFromLease(
    tx: Prisma.TransactionClient,
    lease: { id: string; unitId: string | null; status: string; leaseStart: Date; terminationDate?: Date | null },
    userId?: string,
  ) {
    if (!lease.unitId) return null;                    // building-level lease
    if (lease.terminationDate) return null;            // ended — endTenancy owns that side

    const target =
      lease.status === 'ACTIVE' ? 'LEASED'
      : lease.status === 'DRAFT' ? 'LEASE_PENDING'
      : null;
    if (!target) return null;

    const unit = await tx.unit.findUnique({
      where: { id: lease.unitId },
      select: { status: true },
    });
    if (!unit) return null;
    if (unit.status === 'SOLD') return null;
    // Never move BACKWARDS. A draft must not pull an already-occupied unit down to
    // LEASE_PENDING — the tenant in it is more certain than the paperwork.
    if (unit.status === 'LEASED' || unit.status === 'OCCUPIED') return null;
    if (target === 'LEASE_PENDING' && unit.status === 'LEASE_PENDING') return null;

    await tx.unit.update({
      where: { id: lease.unitId },
      // availableSince is cleared because the unit is no longer on the market. Leaving
      // it set would keep ageing a unit that is committed or occupied.
      data: { status: target, availableSince: null },
    });

    return this.statusEvents.record(
      {
        unitId: lease.unitId,
        fromStatus: unit.status as any,
        toStatus: target as any,
        // Dated by the LEASE, not by now(): a lease entered three weeks late did not
        // start occupying the unit on the day someone typed it in.
        effectiveAt: lease.leaseStart,
        source: 'LEASE_ACTIVATED',
        leaseId: lease.id,
        reason: target === 'LEASED'
          ? 'Lease activated on this unit'
          : 'Lease signed on this unit — tenant not yet moved in',
        recordedById: userId,
      },
      tx,
    );
  }

  /**
   * Validate the successor link. Rejects the two ways it can be nonsense: pointing at
   * itself, and pointing at a lease another tenancy already claims (the DB @unique
   * catches the second, but an opaque driver error is a poor way to learn it).
   */
  private async loadSuccessor(
    successorLeaseId: string | undefined,
    selfId: string,
    unitId: string | null,
  ) {
    if (!successorLeaseId) return null;
    if (successorLeaseId === selfId) {
      throw new BadRequestException('A lease cannot succeed itself');
    }
    const successor = await this.prisma.lease.findUnique({
      where: { id: successorLeaseId },
      select: { id: true, unitId: true, tenantName: true, leaseStart: true, predecessorLease: { select: { id: true } } },
    });
    if (!successor) throw new BadRequestException('The successor lease does not exist');
    if (successor.predecessorLease && successor.predecessorLease.id !== selfId) {
      throw new BadRequestException(
        'That lease is already recorded as the continuation of another tenancy',
      );
    }
    return successor;
  }

  /** Human-readable reason stamped on the unit's occupancy log. */
  private tenancyEndReason(
    input: EndTenancyInput,
    successor: { unitId: string | null } | null,
  ): string {
    const base = `Tenancy ended (${input.terminationReason})`;
    if (!successor) return base;
    return `${base} — tenancy continues under a ${
      successor.unitId ? 'new lease' : 'building-level lease'
    }`;
  }

  /**
   * Record what happens to the security deposit.
   *
   * Deliberately conservative: this records a DECISION, it does not move money. The
   * obligation's collection status (PENDING / PARTIAL / SETTLED) describes what was
   * COLLECTED, and overloading it to also mean "refunded" would corrupt the deposit
   * report. Finance still records the actual refund as a payment.
   *
   * TRANSFER is the one exception, because there the held balance genuinely changes
   * hands: it is carried onto the successor's deposit obligation, and leaving it would
   * strand real money on a lease that has ended.
   */
  private async settleDeposit(
    tx: Prisma.TransactionClient,
    leaseId: string,
    input: EndTenancyInput,
    successorId: string | undefined,
    terminationDate: Date,
  ) {
    const disposition = input.depositDisposition ?? 'DECIDE_LATER';
    const obligation = await tx.leaseObligation.findFirst({
      where: { leaseId, kind: 'SECURITY_DEPOSIT' },
      orderBy: { createdAt: 'asc' },
    });
    if (!obligation) return { disposition, applied: false, reason: 'no deposit on this lease' };
    if (disposition === 'DECIDE_LATER') {
      return { disposition, applied: false, reason: 'left open for Finance' };
    }

    const held = new Prisma.Decimal(obligation.paidAmount);
    const on = terminationDate.toISOString().slice(0, 10);
    const stamp = `${disposition} on ${on}${input.depositNote ? ` — ${input.depositNote.trim()}` : ''}`;
    const notes = obligation.notes ? `${obligation.notes}\n${stamp}` : stamp;

    if (disposition === 'TRANSFER') {
      if (!successorId) {
        throw new BadRequestException(
          'Transferring the deposit needs a successor lease to transfer it to',
        );
      }
      if (held.lte(0)) {
        // Nothing was ever collected, so there is nothing to carry. Say so rather than
        // creating a zero obligation on the successor that looks like a real one.
        return { disposition, applied: false, reason: 'no deposit was collected' };
      }
      const target = await tx.leaseObligation.findFirst({
        where: { leaseId: successorId, kind: 'SECURITY_DEPOSIT' },
        orderBy: { createdAt: 'asc' },
      });
      if (target) {
        await tx.leaseObligation.update({
          where: { id: target.id },
          data: {
            paidAmount: new Prisma.Decimal(target.paidAmount).plus(held),
            notes: target.notes
              ? `${target.notes}\nTransferred in from the previous tenancy on ${on}`
              : `Transferred in from the previous tenancy on ${on}`,
          },
        });
      } else {
        await tx.leaseObligation.create({
          data: {
            leaseId: successorId,
            kind: 'SECURITY_DEPOSIT',
            direction: 'FROM_TENANT',
            totalAmount: held,
            paidAmount: held,
            status: 'SETTLED',
            notes: `Transferred in from the previous tenancy on ${on}`,
          },
        });
      }
      // The source no longer holds the money, so it IS discharged — this is the one
      // case where touching the collection status is honest.
      await tx.leaseObligation.update({
        where: { id: obligation.id },
        data: { status: 'SETTLED', paidAmount: new Prisma.Decimal(0), notes },
      });
      return { disposition, applied: true, amount: Number(held.toFixed(2)) };
    }

    // REFUND / FORFEIT — note only, status untouched. See the method comment.
    await tx.leaseObligation.update({ where: { id: obligation.id }, data: { notes } });
    return { disposition, applied: true, amount: Number(held.toFixed(2)) };
  }

  /**
   * Record what actually changed on a lease, for the unit's history.
   *
   * The audit interceptor already writes an UPDATE row per request, but its `newValues`
   * is the whole submitted body — the lease form posts all ~20 fields every save, so
   * that row cannot distinguish "the rent moved" from "someone re-saved the same lease".
   * This compares against the stored row and records only genuine differences, which is
   * what makes a readable "Lease updated — rent, end date" entry possible.
   *
   * Written as its own action so it sits alongside the raw request log rather than
   * replacing it: one is a security trail, this is a business one.
   */
  private async recordLeaseChanges(
    leaseId: string,
    before: Record<string, any>,
    after: Record<string, any>,
    userId?: string,
  ) {
    const norm = (v: any) => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === 'object' && typeof v.toFixed === 'function') return v.toString(); // Decimal
      return String(v);
    };

    const changes = TRACKED_LEASE_FIELDS
      .map((f) => ({ ...f, from: norm(before[f.field]), to: norm(after[f.field]) }))
      .filter((c) => c.from !== c.to);
    if (changes.length === 0) return;

    try {
      await this.audit.log({
        userId,
        action: 'LEASE_TERMS_CHANGED',
        entity: 'Lease',
        entityId: leaseId,
        oldValues: Object.fromEntries(changes.map((c) => [c.field, c.from])),
        newValues: Object.fromEntries(changes.map((c) => [c.field, c.to])),
        metadata: {
          fields: changes.map((c) => ({ field: c.field, label: c.label, type: c.type })),
        },
      });
    } catch (err) {
      // A history entry must never cost someone their lease edit.
      this.logger.error(`Could not record lease changes for ${leaseId}: ${err}`);
    }
  }

  /**
   * Turn the lease's headline money terms into trackable obligations.
   *
   * `securityDeposit` and `nnnTotalAmount` are fields on the lease form. Until now they
   * were ONLY that — a number on the lease row. The Deposits & Allowances panel reads
   * LeaseObligation, so a user who filled in a $5,000 deposit while writing the lease
   * saw the panel report "$0 agreed across 0 items", and nothing anywhere said the two
   * were different things. The deposit was recorded and simultaneously untracked.
   *
   * So the terms now seed the ledger:
   *   - amount set, no obligation yet     -> create it
   *   - amount changed, nothing collected -> update the agreed total to match
   *   - amount changed, money collected   -> leave it alone
   *
   * That last case matters. Once a payment exists the obligation is a financial record
   * with its own history, and silently re-pointing its total because someone edited a
   * field on the lease form would rewrite what a tenant was recorded as having agreed.
   * The two are then intentionally allowed to diverge, and the panel is the truth.
   *
   * Never fatal: a lease must not fail to save because its deposit ledger could not be
   * seeded. Failures are logged and the term is still on the lease to seed from later.
   */
  private async syncHeadlineObligations(
    leaseId: string,
    terms: { securityDeposit?: unknown; nnnTotalAmount?: unknown; tiAllowance?: unknown },
  ) {
    // Direction is a property of the kind, not of the amount. TI is the only one of the
    // three that points OUTWARD — Prime owes the tenant — so it cannot share a hardcoded
    // FROM_TENANT, and getting it wrong would put a disbursement in the "money in" tile.
    const TERMS = [
      { field: 'securityDeposit', kind: 'SECURITY_DEPOSIT', direction: 'FROM_TENANT' },
      { field: 'nnnTotalAmount', kind: 'NNN', direction: 'FROM_TENANT' },
      { field: 'tiAllowance', kind: 'TI_ALLOWANCE', direction: 'TO_TENANT' },
    ] as const;

    const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
    const wanted = TERMS
      .map((t) => ({ ...t, amount: num((terms as Record<string, unknown>)[t.field]) }))
      .filter((t): t is typeof t & { amount: number } => t.amount != null && t.amount > 0);
    if (wanted.length === 0) return;

    for (const w of wanted) {
      try {
        const existing = await this.prisma.leaseObligation.findFirst({
          where: { leaseId, kind: w.kind },
          select: { id: true, totalAmount: true, paidAmount: true },
        });

        if (!existing) {
          await this.obligations.create({
            leaseId,
            kind: w.kind,
            direction: w.direction,
            totalAmount: w.amount,
            notes:
              w.kind === 'TI_ALLOWANCE'
                ? 'Created from the lease terms. Record each phase of the disbursement against it.'
                : 'Created from the lease terms. Record payments against it as they arrive.',
          });
          continue;
        }

        if (Number(existing.paidAmount) > 0) continue; // has history — hands off
        if (Number(existing.totalAmount) === w.amount) continue;

        await this.obligations.update(existing.id, { totalAmount: w.amount });
      } catch (err) {
        this.logger.error(
          `Could not sync the ${w.kind} obligation for lease ${leaseId} from its headline ` +
          `terms — the lease itself is saved and the amount is still on it. ${err}`,
        );
      }
    }
  }

  /**
   * Notification routing is project-scoped, so every lease event needs a projectId.
   * A lease hangs off EITHER a unit or a building, so resolve from whichever is set.
   */
  private async resolveProjectId(lease: { unitId: string | null; buildingId: string | null }) {
    if (lease.buildingId) {
      const b = await this.prisma.building.findUnique({
        where: { id: lease.buildingId }, select: { projectId: true },
      });
      return b?.projectId ?? null;
    }
    if (lease.unitId) {
      const u = await this.prisma.unit.findUnique({
        where: { id: lease.unitId },
        select: { building: { select: { projectId: true } } },
      });
      return u?.building?.projectId ?? null;
    }
    return null;
  }

  async findByUnit(unitId: string) {
    return this.prisma.lease.findMany({ where: { unitId, deletedAt: null }, orderBy: { leaseStart: 'desc' } });
  }

  /** Sprint 1: building-level leases (e.g. Leander Bldg 1 leased as one whole asset). */
  async findByBuilding(buildingId: string) {
    return this.prisma.lease.findMany({ where: { buildingId, deletedAt: null }, orderBy: { leaseStart: 'desc' } });
  }

  async findByProject(projectId: string) {
    // OR clause to capture both unit-leases (via unit→building→project) and
    // building-leases (via building→project) under one project.
    return this.prisma.lease.findMany({
      where: {
        deletedAt: null,
        OR: [
          { unit: { building: { projectId } } },
          { building: { projectId } },
        ],
      },
      include: {
        unit: { include: { building: { select: { name: true } } } },
        building: { select: { id: true, name: true } },
      },
      orderBy: { leaseStart: 'desc' },
    });
  }

  /**
   * Rent roll as of a date (defaults to today).
   *
   * `lease.monthlyRent` is the CONTRACTED headline rent. What a tenant actually
   * owes in a given month is the rent period covering that date — which differs
   * once escalations or free-rent months exist. Summing monthlyRent flat
   * overstates the roll for any lease sitting in an abatement period.
   *
   * Leases with no generated periods fall back to `monthlyRent`, so this is
   * identical to the old behaviour for existing data and degrades gracefully if
   * schedule generation ever failed for a lease.
   *
   * Both totals are returned: `totalMonthlyRent` is the effective (correct) one,
   * `contractedMonthlyRent` is the old flat sum, so the UI can show the gap and
   * explain it rather than looking like the number silently dropped.
   */
  async getRentRoll(projectId: string, asOf: Date = new Date()) {
    const leases = await this.prisma.lease.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        // Rent on a sold unit is not Prime's to report.
        ...NOT_ON_SOLD_UNIT,
        OR: [
          { unit: { building: { projectId } } },
          { building: { projectId } },
        ],
      },
      include: {
        unit: { include: { building: { select: { name: true } } } },
        building: { select: { id: true, name: true } },
      },
    });

    const leaseIds = leases.map((l) => l.id);
    const byLease = await this.periodsByLease(leaseIds);

    let totalRent = 0;
    let contractedRent = 0;
    let forwardYear = 0;
    let freeRentLeases = 0;

    const rows = leases.map((l) => {
      const periods = byLease.get(l.id) ?? [];
      const headline = Number(l.monthlyRent);
      const period = pickPeriodCovering(periods, asOf);
      const effectiveRent = period ? Number(period.monthlyRent) : headline;

      // Genuine next-12-months total: walk month by month through the schedule
      // rather than multiplying by 12. With free rent or a mid-year escalation
      // these differ materially — that gap is the whole point of the schedule.
      let leaseForwardYear = 0;
      for (let m = 0; m < 12; m += 1) {
        const at = addMonthsUtc(startOfUtcDay(asOf), m);
        const p = pickPeriodCovering(periods, at);
        leaseForwardYear += p ? Number(p.monthlyRent) : headline;
      }

      totalRent += effectiveRent;
      contractedRent += headline;
      forwardYear += leaseForwardYear;
      if (period?.isFreeRent) freeRentLeases += 1;

      return {
        ...l,
        effectiveMonthlyRent: effectiveRent,
        forwardYearRent: leaseForwardYear,
        currentPeriod: period,
      };
    });

    return {
      leases: rows,
      asOf,
      // Effective (correct) — what is actually owed this month.
      totalMonthlyRent: totalRent,
      // The old flat sum of headline rents, kept so the UI can show the gap.
      contractedMonthlyRent: contractedRent,
      // True next-12-months total. NOT totalMonthlyRent * 12.
      forwardYearRent: forwardYear,
      leaseCount: leases.length,
      freeRentLeaseCount: freeRentLeases,
    };
  }

  /** All rent periods for the given leases, newest start first (one query). */
  private async periodsByLease(leaseIds: string[]) {
    const byLease = new Map<string, Prisma.LeaseRentPeriodGetPayload<{}>[]>();
    if (leaseIds.length === 0) return byLease;

    const periods = await this.prisma.leaseRentPeriod.findMany({
      where: { leaseId: { in: leaseIds } },
      orderBy: [{ startDate: 'desc' }, { sequence: 'desc' }],
    });
    for (const p of periods) {
      const list = byLease.get(p.leaseId);
      if (list) list.push(p);
      else byLease.set(p.leaseId, [p]);
    }
    return byLease;
  }


  async findById(id: string) {
    const lease = await this.prisma.lease.findUnique({
      where: { id },
      include: { unit: true, building: { select: { id: true, name: true, projectId: true } } },
    });
    if (!lease || lease.deletedAt) throw new NotFoundException('Lease not found');
    return lease;
  }

  /**
   * What a leasing broker earns on this lease.
   *
   * Unlike a sale, which has one obvious base (the price), a lease fee can be quoted
   * three ways and Prime has not yet said which they use (Q12). So the basis is stored
   * per lease and this returns `undefined` when it is absent — leaving the amount
   * unstamped is honest; picking a base on the client's behalf would put a wrong number
   * in a broker report that someone might pay against.
   *
   *   FIRST_MONTH_RENT  pct x one month's contracted rent
   *   TOTAL_TERM_RENT   pct x monthly rent x term months
   *   FLAT              the broker's flat fee, ignoring any percentage
   *
   * Percentage precedence mirrors the sale side exactly: per-lease override → broker's
   * default rate. An explicit null means the override was CLEARED (drop to the broker's
   * rate); undefined means it was simply not part of this update (keep what is stored).
   */
  private async computeBrokerCommission(
    lease: {
      brokerId: string | null;
      monthlyRent: any;
      termMonths: number | null;
      brokerCommissionPct: any;
      brokerCommissionBasis: string | null;
    },
    data: Record<string, any>,
  ): Promise<number | undefined> {
    const brokerId = (data.brokerId as string | undefined) ?? lease.brokerId ?? undefined;
    if (!brokerId) return undefined;

    const broker = await this.prisma.broker.findUnique({
      where: { id: brokerId },
      select: { commissionRate: true, commissionFlat: true },
    });
    if (!broker) return undefined;

    const basis =
      (data.brokerCommissionBasis as string | undefined) ?? lease.brokerCommissionBasis ?? null;
    if (!basis) return undefined;

    if (basis === 'FLAT') {
      return broker.commissionFlat != null ? Number(broker.commissionFlat) : undefined;
    }

    const pctCleared = data.brokerCommissionPct === null;
    const pctRaw = pctCleared
      ? broker.commissionRate
      : data.brokerCommissionPct ?? lease.brokerCommissionPct ?? broker.commissionRate;
    if (pctRaw == null) {
      // A percentage basis with no percentage anywhere. Fall back to the flat fee if the
      // broker has one, rather than returning nothing at all.
      return broker.commissionFlat != null ? Number(broker.commissionFlat) : undefined;
    }

    const monthlyRent = Number((data.monthlyRent as any) ?? lease.monthlyRent ?? 0);
    if (!monthlyRent) return undefined;
    const pct = Number(pctRaw);

    if (basis === 'FIRST_MONTH_RENT') {
      return Math.round(((monthlyRent * pct) / 100) * 100) / 100;
    }

    // TOTAL_TERM_RENT. Uses the DERIVED term (H1b), so a lease with a fit-out gap is
    // commissioned on the months actually billed, not on the paper length of the lease.
    const term = Number((data.termMonths as any) ?? lease.termMonths ?? 0);
    if (!term) return undefined;
    return Math.round(((monthlyRent * term * pct) / 100) * 100) / 100;
  }

  /**
   * Normalise the H1b date/NNN fields on a create or update payload, in place.
   *
   * Three jobs, all of which have to happen on BOTH write paths or the two disagree:
   *
   *  1. Coerce `rentStartDate`. Like the other date fields it arrives as a bare
   *     "YYYY-MM-DD" from an <input type="date"> and Prisma needs a Date.
   *  2. Validate rent commencement is not before legal commencement. There is a CHECK
   *     constraint for this too; this exists to produce a sentence rather than a
   *     Postgres error.
   *  3. Derive `termMonths` and `nnnMonthly` rather than trusting what was typed.
   *
   * `termMonths` was previously hand-entered and unchecked against the dates, while
   * `summariseEffectiveRent` prefers it over what the periods actually cover — so a
   * mistyped term silently skewed the effective-rent KPI with nothing to notice it by.
   * It is now always a function of the dates.
   *
   * @param merged the post-update view of the lease (incoming ?? existing), so an update
   *               that touches only one date still derives the term from both.
   */
  private async normaliseTermAndNnn(
    data: Record<string, any>,
    merged: { leaseStart?: Date | null; rentStartDate?: Date | null; leaseEnd?: Date | null; unitId?: string | null },
  ) {
    if (typeof data.rentStartDate === 'string') data.rentStartDate = new Date(data.rentStartDate);

    const leaseStart = (data.leaseStart as Date) ?? merged.leaseStart ?? null;
    const rentStart =
      (data.rentStartDate !== undefined ? data.rentStartDate : merged.rentStartDate) ?? null;
    const leaseEnd = (data.leaseEnd as Date) ?? merged.leaseEnd ?? null;

    if (rentStart && leaseStart && startOfUtcDay(rentStart) < startOfUtcDay(leaseStart)) {
      throw new BadRequestException(
        'Rent start date cannot be before the lease start date. Rent commences on or after ' +
        'the lease begins — a fit-out period sits between the two.',
      );
    }

    // Term runs from RENT commencement to the rent end date. A 36-month lease with a
    // 3-month fit-out is 36 months of rent, not 39 months of paper.
    const termOrigin = rentStart ?? leaseStart;
    if (termOrigin && leaseEnd) {
      const months = monthsBetweenUtc(startOfUtcDay(termOrigin), startOfUtcDay(leaseEnd));
      data.termMonths = Math.max(0, Math.round(months));
    }

    // NNN $/sqft is the quoted rate; the TOTAL is derived against the unit's area. This
    // is a one-time sum charged at signing (client-confirmed 2026-08-12), not a monthly
    // charge — it is a headline term here, and the money is tracked as a LeaseObligation
    // of kind NNN. An explicitly supplied total always wins, for leases quoted flat.
    if (data.nnnPerSqft !== undefined && data.nnnTotalAmount === undefined) {
      const unitId = (data.unitId as string) ?? merged.unitId ?? null;
      const rate = data.nnnPerSqft === null ? null : Number(data.nnnPerSqft);
      if (rate === null) {
        data.nnnTotalAmount = null;
      } else if (unitId) {
        const unit = await this.prisma.unit.findUnique({
          where: { id: unitId },
          select: { sqft: true },
        });
        if (unit?.sqft) data.nnnTotalAmount = Number((rate * unit.sqft).toFixed(2));
      }
    }
  }

  /**
   * Two leases on one unit must not overlap IN TIME.
   *
   * This replaced a partial unique index that allowed at most one lease per unit
   * outside (EXPIRED, TERMINATED). That was a stand-in for "no double-booking" which
   * broke as soon as a unit had a past tenancy: entering the second lease was refused
   * outright, which is why two years of history could never be entered.
   *
   * Bounds are inclusive-start / exclusive-end, matching the DB constraint
   * `lease_unit_no_overlap`, so a lease ending 30 Jun and one starting 30 Jun are
   * fine — same-day turnover is real.
   *
   * This is the friendly fast path; the exclusion constraint is the real enforcement
   * and catches races this check cannot.
   */
  private async assertNoOverlappingLease(
    unitId: string,
    leaseStart: Date,
    leaseEnd: Date,
    excludeLeaseId?: string,
    terminationDate?: Date | null,
  ) {
    if (!(leaseStart instanceof Date) || !(leaseEnd instanceof Date)) return;
    if (Number.isNaN(leaseStart.getTime()) || Number.isNaN(leaseEnd.getTime())) return;
    if (leaseEnd <= leaseStart) {
      throw new BadRequestException('Lease end date must be after the lease start date');
    }
    // Mirrors the DB CHECK `lease_termination_after_start`. Without this the constraint
    // surfaces as an opaque driver error rather than a 400 anyone can act on.
    if (terminationDate instanceof Date && !Number.isNaN(terminationDate.getTime())) {
      if (terminationDate < leaseStart) {
        throw new BadRequestException('Move-out date cannot be before the lease start date');
      }
    }

    // What matters for double-booking is the range the unit is OCCUPIED, which ends at
    // the move-out date when there is one — not the contracted expiry. A lease that
    // ended early frees the unit even though its leaseEnd still says otherwise.
    // This must stay in step with `lease_unit_no_overlap`, which ranges over
    // COALESCE(terminationDate, leaseEnd); if the two disagree, this fast path rejects
    // successors the database would have accepted and the fix is unreachable.
    const effectiveEnd =
      terminationDate instanceof Date && !Number.isNaN(terminationDate.getTime())
        ? terminationDate
        : leaseEnd;

    const clash = await this.prisma.lease.findFirst({
      where: {
        unitId,
        deletedAt: null,
        ...(excludeLeaseId ? { id: { not: excludeLeaseId } } : {}),
        // Overlap iff existing.start < new.effectiveEnd AND new.start < existing.effectiveEnd.
        leaseStart: { lt: effectiveEnd },
        // Prisma cannot express COALESCE in a filter, so the two cases are spelled out.
        // They are exhaustive and disjoint: `{ gt }` never matches NULL, so a terminated
        // lease is judged on its move-out date and a live one on its contracted end.
        OR: [
          { terminationDate: null, leaseEnd: { gt: leaseStart } },
          { terminationDate: { gt: leaseStart } },
        ],
      },
      select: {
        id: true,
        tenantName: true,
        tenantBrand: true,
        leaseStart: true,
        leaseEnd: true,
        terminationDate: true,
        status: true,
      },
    });

    if (clash) {
      // Defensive formatting: this runs on an error path, and a TypeError thrown while
      // building an error message would replace a clear 400 with an opaque 500.
      const day = (d: unknown) =>
        d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '?';
      const who = clash.tenantBrand || clash.tenantName || 'an existing lease';
      // Report the range that actually conflicts, so an early-terminated lease does not
      // claim to run to a contracted end it no longer occupies.
      const when = `${day(clash.leaseStart)} to ${day(clash.terminationDate ?? clash.leaseEnd)}`;
      throw new BadRequestException(
        `These dates overlap an existing lease on this unit: ${who} ` +
        `(${when}${clash.status ? `, ${String(clash.status).toLowerCase()}` : ''}). ` +
        `Adjust the dates so the tenancies do not overlap — a lease may start on the day another ends.`,
      );
    }
  }

  /**
   * Prisma has no dedicated error code for an exclusion-constraint violation, so it
   * surfaces as an opaque driver error. Translate ours into the same 400 the fast
   * path produces; re-throw anything else untouched.
   */
  private translateOverlapError(e: any): any {
    const message = String(e?.message ?? '');
    if (message.includes('lease_unit_no_overlap')) {
      return new BadRequestException(
        'These dates overlap an existing lease on this unit. Adjust the dates so the ' +
        'tenancies do not overlap — a lease may start on the day another ends.',
      );
    }
    if (message.includes('lease_termination_after_start')) {
      return new BadRequestException('Move-out date cannot be before the lease start date');
    }
    return e;
  }

  async create(data: Prisma.LeaseUncheckedCreateInput, createdById?: string) {
    // class-validator's @IsDateString() accepts a bare "YYYY-MM-DD" date, but Prisma's
    // DateTime columns need a full ISO-8601 datetime — pass Date objects so Prisma
    // serializes them correctly instead of erroring "premature end of input".
    if (typeof data.leaseStart === 'string') data.leaseStart = new Date(data.leaseStart);
    if (typeof data.leaseEnd === 'string') data.leaseEnd = new Date(data.leaseEnd);
    // Same coercion for freeRentStartDate — it's also @IsDateString(), so a bare
    // "YYYY-MM-DD" from an <input type="date"> would otherwise reach Prisma as a string.
    if (typeof data.freeRentStartDate === 'string') data.freeRentStartDate = new Date(data.freeRentStartDate);
    // Sprint 1: leases are polymorphic — exactly one of (unitId, buildingId) required.
    const unitId = data.unitId as string | null | undefined;
    const buildingId = data.buildingId as string | null | undefined;
    if (!unitId && !buildingId) {
      throw new BadRequestException('Lease must reference either a unit or a building');
    }
    if (unitId && buildingId) {
      throw new BadRequestException('Lease cannot reference both a unit and a building');
    }
    await this.normaliseTermAndNnn(data as Record<string, any>, {
      leaseStart: data.leaseStart as Date,
      rentStartDate: data.rentStartDate as Date | null,
      leaseEnd: data.leaseEnd as Date,
      unitId,
    });

    // Commission is EARNED when the lease goes live, mirroring the sale side's
    // stamp-on-close. A DRAFT lease may name a broker without owing them anything yet.
    if (data.status === 'ACTIVE' && data.brokerCommissionAmt === undefined) {
      const amt = await this.computeBrokerCommission(
        {
          brokerId: (data.brokerId as string) ?? null,
          monthlyRent: data.monthlyRent,
          termMonths: (data.termMonths as number) ?? null,
          brokerCommissionPct: data.brokerCommissionPct ?? null,
          brokerCommissionBasis: (data.brokerCommissionBasis as string) ?? null,
        },
        data as Record<string, any>,
      );
      if (amt != null) (data as Record<string, any>).brokerCommissionAmt = amt;
    }

    if (unitId) {
      await this.assertNoOverlappingLease(
        unitId,
        data.leaseStart as Date,
        data.leaseEnd as Date,
        undefined,
        // Normally null on create; the H2 backfill enters leases that already ended.
        (data.terminationDate as Date) ?? null,
      );
    }
    let lease: Prisma.LeaseGetPayload<{}>;
    try {
      // One transaction with the unit sync. Everything AFTER this point (schedule,
      // obligations, events) is deliberately outside it — those are recoverable and
      // must not cost the user a lease they already entered. The unit is different: a
      // lease that activated without moving its unit is the inconsistency itself.
      lease = await this.prisma.$transaction(async (tx) => {
        const created = await tx.lease.create({ data });
        await this.syncUnitFromLease(tx, created as any, createdById);
        return created;
      });
    } catch (e: any) {
      throw this.translateOverlapError(e);
    }

    // Build the rent schedule (escalations + free-rent months) up front so the
    // client sees the full timeline the moment the lease is signed.
    //
    // Deliberately NOT part of the create transaction: a schedule that fails to
    // generate must not cost the user a lease they already entered. Nothing reads
    // periods without falling back to lease.monthlyRent (see getRentRoll), and
    // generateForLease is idempotent, so this is safe to retry later.
    await this.generateSchedule(lease.id, createdById);

    // Seed the obligation ledger from the terms just entered, so a deposit typed on the
    // lease form is immediately visible — and collectable — in Deposits & Allowances.
    await this.syncHeadlineObligations(lease.id, data as Record<string, unknown>);

    const projectId = await this.resolveProjectId(lease);
    if (projectId) {
      this.bus.emit({ type: 'lease.created', leaseId: lease.id, projectId, tenantName: lease.tenantName });
      // A lease entered straight as ACTIVE never passes through an update, so it would
      // otherwise never announce itself to Finance/Accounting.
      if (lease.status === 'ACTIVE') {
        this.bus.emit({ type: 'lease.activated', leaseId: lease.id, projectId, tenantName: lease.tenantName });
      }
    }
    return lease;
  }

  /** Idempotent, non-fatal. Logged loudly rather than swallowed. */
  private async generateSchedule(leaseId: string, createdById?: string, force = false) {
    try {
      await this.rentPeriods.generateForLease(leaseId, { createdById, force });
    } catch (err) {
      this.logger.error(
        `Rent schedule generation failed for lease ${leaseId} — the lease is intact and rent ` +
        `falls back to its headline monthlyRent. Re-run via POST /leases/${leaseId}/rent-periods/generate. ${err}`,
      );
    }
  }

  async update(id: string, data: Prisma.LeaseUncheckedUpdateInput, updatedById?: string) {
    const before = await this.findById(id);
    if (typeof data.leaseStart === 'string') data.leaseStart = new Date(data.leaseStart);
    if (typeof data.leaseEnd === 'string') data.leaseEnd = new Date(data.leaseEnd);
    // Same coercion for freeRentStartDate — it's also @IsDateString(), so a bare
    // "YYYY-MM-DD" from an <input type="date"> would otherwise reach Prisma as a string.
    if (typeof data.freeRentStartDate === 'string') data.freeRentStartDate = new Date(data.freeRentStartDate);

    await this.normaliseTermAndNnn(data as Record<string, any>, {
      leaseStart: before.leaseStart,
      rentStartDate: before.rentStartDate,
      leaseEnd: before.leaseEnd,
      unitId: before.unitId,
    });

    // Commission: stamp when the lease ACTIVATES, and re-stamp when an already-active
    // lease has one of its commission inputs edited. Without the second half, correcting
    // the broker or the rate after activation leaves the previously stamped figure
    // behind — the exact staleness the sale side guards against (see
    // `editingClosedCommissionInputs` in SalesService.update).
    const activatingNow = data.status === 'ACTIVE' && before.status !== 'ACTIVE';
    // Compare VALUES, not mere presence in the payload. `normaliseTermAndNnn` above
    // derives and sets `termMonths` on every single update, so a presence check would
    // make an unrelated edit (a note, a status tweak) look like a commission change —
    // and re-stamping would then silently overwrite a manually negotiated
    // brokerCommissionAmt with the computed one.
    const changed = (field: keyof typeof before) =>
      (data as Record<string, any>)[field] !== undefined &&
      String((data as Record<string, any>)[field] ?? '') !== String(before[field] ?? '');
    const commissionInputsTouched =
      changed('brokerId') ||
      changed('brokerCommissionPct') ||
      changed('brokerCommissionBasis') ||
      changed('monthlyRent') ||
      changed('termMonths');
    const restamping = before.status === 'ACTIVE' && commissionInputsTouched;

    if ((activatingNow || restamping) && data.brokerCommissionAmt === undefined) {
      if (data.brokerId === null) {
        // Broker explicitly removed. The `??` chain in computeBrokerCommission cannot
        // tell "cleared" from "omitted", so clear the stamped amount here instead of
        // recomputing against a broker the lease no longer has.
        (data as Record<string, any>).brokerCommissionAmt = null;
      } else {
        const amt = await this.computeBrokerCommission(before as any, data as Record<string, any>);
        if (amt != null) {
          (data as Record<string, any>).brokerCommissionAmt = amt;
        } else if (restamping) {
          // Nothing computable from the current inputs, but a figure stamped from the
          // previous ones may still be sitting there. Leaving it would show a commission
          // the lease no longer supports.
          (data as Record<string, any>).brokerCommissionAmt = null;
        }
      }
    }

    // Moving a lease's dates can collide with a sibling tenancy on the same unit just
    // as creating one can. Check only when a date actually moved, against the merged
    // (incoming ?? current) range, excluding this lease from its own comparison.
    // terminationDate counts as a date move: it is what the occupied range now ends at,
    // so shortening or clearing it changes what this lease collides with.
    const datesMoved =
      data.leaseStart !== undefined ||
      data.leaseEnd !== undefined ||
      data.terminationDate !== undefined;
    if (datesMoved && before.unitId) {
      await this.assertNoOverlappingLease(
        before.unitId,
        (data.leaseStart as Date) ?? before.leaseStart,
        (data.leaseEnd as Date) ?? before.leaseEnd,
        id,
        data.terminationDate !== undefined
          ? (data.terminationDate as Date | null)
          : before.terminationDate,
      );
    }

    let updated: Prisma.LeaseGetPayload<{}>;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.lease.update({ where: { id }, data });
        // Covers both "DRAFT → ACTIVE" and an edit that leaves it ACTIVE while the unit
        // has drifted. syncUnitFromLease is a no-op when the unit already agrees, so
        // calling it unconditionally costs one indexed read and cannot double-write.
        await this.syncUnitFromLease(tx, row as any, updatedById);
        return row;
      });
    } catch (e: any) {
      throw this.translateOverlapError(e);
    }

    // Keep the obligation ledger in step when the headline terms are edited. Only
    // touches obligations with no payments recorded — see syncHeadlineObligations.
    if (
      data.securityDeposit !== undefined ||
      data.nnnTotalAmount !== undefined ||
      data.tiAllowance !== undefined
    ) {
      await this.syncHeadlineObligations(id, data as Record<string, unknown>);
    }

    // Terms that feed the schedule changed → re-derive the FUTURE periods. Past
    // periods stay frozen; the tenant was already invoiced against them.
    const scheduleChanged = SCHEDULE_INPUT_FIELDS.some(
      (f) => data[f] !== undefined && String(before[f] ?? '') !== String(updated[f] ?? ''),
    );
    if (scheduleChanged) {
      await this.generateSchedule(id, updatedById, true);
    }

    // Diff against the pre-write snapshot, so an unchanged field that the form merely
    // re-submitted does not land on the unit's timeline.
    await this.recordLeaseChanges(id, before as any, updated as any, updatedById);

    const projectId = await this.resolveProjectId(updated);
    if (projectId) {
      if (data.status && data.status !== before.status) {
        if (updated.status === 'ACTIVE') {
          this.bus.emit({ type: 'lease.activated', leaseId: id, projectId, tenantName: updated.tenantName });
        } else if (updated.status === 'TERMINATED') {
          this.bus.emit({ type: 'lease.terminated', leaseId: id, projectId, tenantName: updated.tenantName });
        }
      }
      // Headline rent moved — Finance/Accounting/AR need to know regardless of whether
      // it came from a scheduled escalation or someone editing the lease.
      const fromRent = Number(before.monthlyRent);
      const toRent = Number(updated.monthlyRent);
      if (data.monthlyRent !== undefined && fromRent !== toRent) {
        this.bus.emit({
          type: 'lease.rentChanged',
          leaseId: id,
          projectId,
          from: fromRent,
          to: toRent,
          effectiveAt: updated.leaseStart,
          source: 'MANUAL',
        });
      }
    }
    return updated;
  }

  // Soft-delete — preserves the row (and the unit's history) instead of destroying it.
  /**
   * Soft-delete a lease.
   *
   * A HISTORICAL lease (entered by hand via backfill) needs approval first — client
   * decision 2026-08-12, Q2 option b: Sales creates and edits, only a Founder deletes.
   * The gate exists because a backfilled tenancy carries a complete ledger somebody typed
   * in from records the system never witnessed; deleting it destroys data nothing can
   * regenerate. A live lease is different — its schedule can always be rebuilt from its
   * own terms.
   *
   * `canApproveDeletion` is the caller's `unit:history:delete` permission, passed down
   * from the controller. A holder IS the approver, so they delete directly and the audit
   * row records it as self-approved rather than inventing a request they approve of
   * themselves. Everyone else goes through request → approve.
   *
   * The lease's periods, invoices and obligations are not written to: every query for
   * them filters on `lease: { deletedAt: null }`, so soft-deleting the lease takes its
   * whole ledger out of view in one write.
   */
  async delete(id: string, userId?: string, canApproveDeletion = false) {
    const lease = await this.findById(id);
    const historical = !!(lease as any).isHistorical;
    let approvalId: string | null = null;
    let selfApproved = false;

    if (historical) {
      const approved = await this.prisma.historicalRecordDeletion.findFirst({
        where: { leaseId: id, status: 'APPROVED' },
        orderBy: { decidedAt: 'desc' },
      });

      if (approved) {
        approvalId = approved.id;
      } else if (canApproveDeletion) {
        // The approver deleting directly. Recorded as a request they raised and decided
        // in one act, so the trail reads the same shape as every other deletion rather
        // than being a hole where an approval should be.
        selfApproved = true;
        const now = new Date();
        const pending = await this.prisma.historicalRecordDeletion.findFirst({
          where: { leaseId: id, status: 'PENDING' },
        });
        const record = pending
          ? await this.prisma.historicalRecordDeletion.update({
              where: { id: pending.id },
              data: {
                status: 'APPROVED',
                decidedById: userId,
                decidedAt: now,
                decisionNote: 'Approved by deleting the record directly',
              },
            })
          : await this.prisma.historicalRecordDeletion.create({
              data: {
                leaseId: id,
                reason: 'Deleted directly by an approver',
                requestedById: userId!,
                status: 'APPROVED',
                decidedById: userId,
                decidedAt: now,
              },
            });
        approvalId = record.id;
      } else {
        const pending = await this.prisma.historicalRecordDeletion.findFirst({
          where: { leaseId: id, status: 'PENDING' },
        });
        throw new ForbiddenException(
          pending
            ? 'A deletion request for this historical record is still awaiting Founder approval.'
            : 'Historical records cannot be deleted directly. Request deletion first — a Founder '
              + 'has to approve it.',
        );
      }

      // Mark the approval used, so one approval cannot authorise a second deletion if the
      // record is ever restored.
      await this.prisma.historicalRecordDeletion.update({
        where: { id: approvalId! },
        data: { status: 'COMPLETED' },
      });
    }

    const deleted = await this.prisma.lease.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId,
      action: historical ? 'LEASE_HISTORICAL_DELETED' : 'LEASE_DELETED',
      entity: 'Lease',
      entityId: id,
      oldValues: {
        tenantName: lease.tenantName,
        isHistorical: historical,
        ...(historical ? { approvalId, selfApproved } : {}),
      },
    });
    return deleted;
  }

  // ─────── Historical deletion approval (R27) ───────

  /** Ask a Founder to approve deleting a backfilled tenancy. Reason is mandatory. */
  async requestHistoricalDeletion(leaseId: string, reason: string, userId: string) {
    const lease = await this.findById(leaseId);
    if (!(lease as any).isHistorical) {
      throw new BadRequestException(
        'This lease was recorded live, not backfilled — delete it directly.',
      );
    }
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to request deletion');
    }
    const existing = await this.prisma.historicalRecordDeletion.findFirst({
      where: { leaseId, status: 'PENDING' },
    });
    if (existing) {
      throw new BadRequestException('A deletion request for this record is already pending');
    }
    const request = await this.prisma.historicalRecordDeletion.create({
      data: { leaseId, reason: reason.trim(), requestedById: userId },
    });

    await this.audit.log({
      userId,
      action: 'HISTORICAL_DELETION_REQUESTED',
      entity: 'Lease',
      entityId: leaseId,
      newValues: { requestId: request.id, reason: request.reason },
    });
    this.bus.emit({
      type: 'history.deletionRequested',
      requestId: request.id,
      leaseId,
      projectId: await this.resolveProjectId(lease).catch(() => null),
      tenantName: lease.tenantName,
      reason: request.reason,
      requestedById: userId,
    });
    return request;
  }

  /**
   * Approve or reject a pending request.
   *
   * Approving does NOT delete anything — it authorises the delete, which stays a separate
   * deliberate act. One click that both approves and destroys would make the approval a
   * formality rather than a decision.
   */
  async decideHistoricalDeletion(
    requestId: string,
    approve: boolean,
    userId: string,
    note?: string,
  ) {
    const request = await this.prisma.historicalRecordDeletion.findUnique({
      where: { id: requestId },
      include: { lease: { select: { tenantName: true } } },
    });
    if (!request) throw new NotFoundException('Deletion request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`This request was already ${request.status.toLowerCase()}`);
    }
    // Nobody approves their own request. The gate exists to put a second person in the
    // path; letting the requester decide would remove exactly that. An approver who wants
    // to delete their own record does it directly instead — see delete().
    if (request.requestedById === userId) {
      throw new ForbiddenException('A deletion request must be approved by someone else');
    }
    const decided = await this.prisma.historicalRecordDeletion.update({
      where: { id: requestId },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedById: userId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
    });

    await this.audit.log({
      userId,
      action: approve ? 'HISTORICAL_DELETION_APPROVED' : 'HISTORICAL_DELETION_REJECTED',
      entity: 'Lease',
      entityId: request.leaseId,
      newValues: { requestId, decisionNote: decided.decisionNote },
    });
    this.bus.emit({
      type: 'history.deletionDecided',
      requestId,
      leaseId: request.leaseId,
      tenantName: request.lease?.tenantName ?? 'a tenancy',
      approved: approve,
      note: decided.decisionNote ?? undefined,
      requestedById: request.requestedById,
      decidedById: userId,
    });
    return decided;
  }

  /**
   * Withdraw your own pending request.
   *
   * Only the requester, and only while it is pending — a decided request is a record of
   * what a Founder decided, and the person who asked does not get to erase that.
   */
  async cancelHistoricalDeletion(requestId: string, userId: string) {
    const request = await this.prisma.historicalRecordDeletion.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Deletion request not found');
    if (request.requestedById !== userId) {
      throw new ForbiddenException('Only the person who raised a request can withdraw it');
    }
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`This request was already ${request.status.toLowerCase()}`);
    }
    const cancelled = await this.prisma.historicalRecordDeletion.update({
      where: { id: requestId },
      // decidedBy is the person who settled it, which for a withdrawal is the requester —
      // and the DB CHECK requires any non-PENDING row to name one.
      data: {
        status: 'CANCELLED',
        decidedById: userId,
        decidedAt: new Date(),
      },
    });
    await this.audit.log({
      userId,
      action: 'HISTORICAL_DELETION_CANCELLED',
      entity: 'Lease',
      entityId: request.leaseId,
      newValues: { requestId },
    });
    return cancelled;
  }

  /** Pending requests, oldest first — the Founder's queue. */
  async listHistoricalDeletionRequests(status = 'PENDING') {
    return this.prisma.historicalRecordDeletion.findMany({
      where: { status },
      orderBy: { requestedAt: 'asc' },
      include: {
        lease: { select: { id: true, tenantName: true, leaseStart: true, leaseEnd: true, unitId: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    });
  }
}
