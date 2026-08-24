import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole, SaleBuyerType, SaleCancellationDisposition } from '@prisma/client';
import { EventBus } from '../../common/events/event-bus.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';
import { LeasesService, TerminationReason } from '../leases/leases.service';
import { startOfUtcDay } from '../leases/lease-rent-period.service';
import { SalePaymentsService } from './sale-payments.service';
import { CommissionInstallmentService } from '../../common/utils/commission-installment.service';
import { HistoricalDeletionService } from '../../common/utils/historical-deletion.service';
import { AuditService } from '../../common/utils/audit.service';
import {
  SALE_STAGE_ORDER,
  docCategoryLabel,
  requiredDocsForTransition,
  saleStageLabel,
  transitionSkipsStages,
} from './sale-document-gates';

/** What the caller may say about the money when cancelling a sale. All optional. */
export interface SaleCancellationInput {
  disposition?: SaleCancellationDisposition;
  refundAmount?: number;
  penaltyAmount?: number;
  refundPaidAt?: string | Date;
  refundReference?: string;
  note?: string;
}

/** A sale that already closed, entered by hand (R4). See SalesService.backfillSale. */
export interface BackfillSaleInput {
  unitId?: string | null;
  buildingId?: string | null;
  seller?: string | null;
  buyer: string;
  buyerType?: SaleBuyerType;
  salePrice: number;
  contractDate?: string | null;
  closingDate: string;
  notes?: string | null;
  brokerId?: string | null;
  brokerCommissionPct?: number | null;
  payments?: { label: string; amount: number; paidAt?: string }[];
  commissionInstallments?: { amount: number; paidAt?: string }[];
}

/** Money is compared at the precision it is stored at — Decimal(14,2). */
function money(value: unknown): Prisma.Decimal {
  return new Prisma.Decimal((value ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2);
}

/**
 * THE invariant. Every dollar collected on a cancelled sale is either given back or
 * kept — there is no third place for it to be.
 *
 * DECIDE_LATER is exempt because no decision exists yet, which is the entire point of
 * that state: it lets Sales cancel at 6pm without Finance in the room. The alternative
 * is zeros typed in to clear the dialog, and a row of zeros that looks like a record is
 * worse than no row at all.
 *
 * Named figures in the message, same shape as assertRentInvariant: whoever hits this has
 * to be able to see which of the three numbers is wrong without opening the database.
 */
export function assertCancellationReconciles(row: {
  disposition: SaleCancellationDisposition;
  totalCollected: Prisma.Decimal;
  refundAmount: Prisma.Decimal;
  penaltyAmount: Prisma.Decimal;
}): void {
  if (row.disposition === 'DECIDE_LATER') return;
  const accounted = row.refundAmount.plus(row.penaltyAmount).toDecimalPlaces(2);
  const collected = row.totalCollected.toDecimalPlaces(2);
  if (accounted.equals(collected)) return;
  throw new BadRequestException(
    `Cancellation ledger does not reconcile: refund (${row.refundAmount.toFixed(2)}) + ` +
      `penalty (${row.penaltyAmount.toFixed(2)}) = ${accounted.toFixed(2)}, but ` +
      `${collected.toFixed(2)} was collected on this sale. Off by ` +
      `${accounted.sub(collected).toFixed(2)}. Every dollar collected must be recorded ` +
      `as refunded or retained — or choose DECIDE_LATER to leave the decision to Finance.`,
  );
}

/**
 * The discount a sale price represents off a unit's asking price, as a percentage.
 * Null when it cannot be computed (no asking price, or no price on the sale) and 0 when
 * the sale is at or above asking — i.e. no discount at all.
 *
 * Extracted so the unit-swap path (S3) compares the same figure the approval gate below
 * tests, rather than a second implementation that could drift from it.
 */
export function discountPctOffAsking(
  askingPrice: unknown,
  salePrice: unknown,
): number | null {
  const asking = askingPrice != null ? Number(askingPrice) : null;
  const price = salePrice != null ? Number(salePrice) : null;
  if (asking == null || price == null) return null;
  if (!(asking > 0)) return null;
  if (price >= asking) return 0;
  return ((asking - price) / asking) * 100;
}

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
    private statusEvents: UnitStatusEventService,
    private leases: LeasesService,
    private salePayments: SalePaymentsService,
    private commissionInstallments: CommissionInstallmentService,
    private historicalDeletions: HistoricalDeletionService,
    private audit: AuditService,
  ) {}

  /**
   * A closing date is the real-world moment a unit changed hands, so the occupancy
   * event should carry it rather than the wall-clock time someone typed it in. Falls
   * back to now when the date is absent or unparseable.
   */
  private toDateOrNow(value: unknown): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string') {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  }

  /**
   * Who bought, relative to the sitting tenant (S4/T1).
   *
   * The incoming body wins when this request sets it — closing a sale and saying "a third
   * party bought it" is one PUT, and reading the stored row would act on the value the
   * sale had a moment ago. Prisma's update inputs allow a `{ set: value }` wrapper as well
   * as a bare value, so both are unwrapped rather than trusting the common shape.
   *
   * Falls back to the stored column, then to SITTING_TENANT — the column default, and
   * therefore exactly what every sale written before this field existed already meant.
   */
  private resolveBuyerType(
    sale: { buyerType?: SaleBuyerType | null },
    data: Prisma.SaleUncheckedUpdateInput,
  ): SaleBuyerType {
    const incoming = data.buyerType as SaleBuyerType | { set?: SaleBuyerType } | undefined;
    const fromBody =
      incoming && typeof incoming === 'object' ? incoming.set : (incoming as SaleBuyerType | undefined);
    return fromBody ?? sale.buyerType ?? 'SITTING_TENANT';
  }

  /**
   * What the unit's occupancy log says about this sale (R6).
   *
   * Only stated when there was actually a tenancy to reason about: on a vacant unit
   * buyerType has no consequence, and narrating one would put a distinction into the
   * history that the sale never made.
   */
  private saleClosedReason(tenancyTransfers: boolean, occupyingCount: number): string | undefined {
    if (occupyingCount === 0) return undefined;
    return tenancyTransfers
      ? 'Sold to a third party — the sitting tenancy transfers to the new owner and continues'
      : 'Sold to the sitting tenant — their tenancy ends at completion';
  }

  async findByProject(projectId: string) {
    return this.prisma.sale.findMany({
      where: { projectId, deletedAt: null },
      include: { unit: { include: { building: { select: { name: true } } } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getPipeline(projectId: string) {
    const sales = await this.findByProject(projectId);
    const byStatus: Record<string, any[]> = {};
    for (const s of sales) {
      (byStatus[s.status] ??= []).push(s);
    }

    // Sales velocity: avg days from creation to close for CLOSED sales
    const closed = sales.filter((s) => s.status === 'CLOSED' && s.closingDate);
    const avgDaysToClose = closed.length > 0
      ? Math.round(
          closed.reduce((sum, s) => {
            const days = (new Date(s.closingDate!).getTime() - new Date(s.createdAt).getTime())
              / (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / closed.length,
        )
      : null;

    const totalPipelineValue = sales
      .filter((s) => !['CLOSED', 'CANCELLED'].includes(s.status))
      .reduce((sum, s) => sum + Number(s.salePrice || 0), 0);

    const closedRevenue = closed.reduce((sum, s) => sum + Number(s.salePrice || 0), 0);

    return { byStatus, avgDaysToClose, totalPipelineValue, closedRevenue };
  }

  async findById(id: string) {
    // cancellation comes along for the ride: a CANCELLED sale whose detail view cannot
    // say what happened to the buyer's money is the gap S1 exists to close.
    const s = await this.prisma.sale.findUnique({
      where: { id },
      include: { unit: true, cancellation: true },
    });
    if (!s || s.deletedAt) throw new NotFoundException('Sale not found');
    return s;
  }

  async create(data: Prisma.SaleUncheckedCreateInput, createdById?: string) {
    // Sprint 1: Sales can attach to either a Unit (typical) or a Building (e.g.
    // Leander Bldg 1 sold as one asset). Exactly one of (unitId, buildingId)
    // must be set, and the chosen asset must live under data.projectId.
    const unitId = data.unitId as string | undefined;
    const buildingId = data.buildingId as string | undefined;
    if (!unitId && !buildingId) {
      throw new BadRequestException('Sale must reference either a unit or a building');
    }
    if (unitId && buildingId) {
      throw new BadRequestException('Sale cannot reference both a unit and a building');
    }
    if (unitId) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: unitId },
        include: { building: { select: { projectId: true } } },
      });
      if (!unit) throw new NotFoundException('Unit not found');
      if (unit.building.projectId !== data.projectId) {
        throw new BadRequestException('Unit does not belong to this project');
      }
    } else if (buildingId) {
      const building = await this.prisma.building.findUnique({
        where: { id: buildingId },
        select: { projectId: true },
      });
      if (!building) throw new NotFoundException('Building not found');
      if (building.projectId !== data.projectId) {
        throw new BadRequestException('Building does not belong to this project');
      }
    }
    // class-validator's @IsDateString() accepts a bare "YYYY-MM-DD" date, but Prisma's
    // DateTime columns need a full ISO-8601 datetime — pass Date objects so Prisma
    // serializes them correctly instead of erroring "premature end of input".
    for (const field of ['loiDate', 'contractDate', 'closingDate'] as const) {
      if (typeof data[field] === 'string') (data as any)[field] = new Date(data[field] as unknown as string);
    }
    // A sale can be CREATED already CLOSED — the units flow does exactly that when a
    // user flips a unit to SOLD and fills in the deal. update() gates that transition
    // on founder discount sign-off and stamps broker commission; create() must apply
    // the same rules, or "create as CLOSED" becomes a way around both.
    const createdClosed = data.status === 'CLOSED';
    if (createdClosed) {
      // The document gate (S6/D1) applies to a sale BORN closed exactly as it applies to
      // one moved there. Creating straight into CLOSED skips every stage, and
      // requiredDocsForTransition is cumulative over the rungs crossed precisely so that
      // skipping cannot buy a discount on the paperwork — "a gate that can be walked
      // around by skipping a stage is not a gate".
      //
      // Checked here, against the ORIGIN stage a new sale starts at, rather than by
      // reusing assertStageDocumentsAttached: that reads documents by saleId, and this
      // sale does not exist yet. Which is the whole point of the message below — there is
      // nothing to attach paperwork TO until the sale is created, so a closed-on-arrival
      // sale with documents outstanding is not a thing that can exist.
      // 'PROSPECT' is the column default, so it is the rung every new sale starts on.
      const required = requiredDocsForTransition(SALE_STAGE_ORDER[0], 'CLOSED');
      if (required.length > 0) {
        const names = required.map(docCategoryLabel);
        const list = names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        throw new ForbiddenException(
          `A sale cannot be created already closed: ${list} must be attached to it first, and `
          + 'documents attach to a sale that exists. Create the sale at its current stage, upload '
          + 'the paperwork, then move it to Closed.',
        );
      }
      await this.assertDiscountApproved({
        projectId: data.projectId as string,
        unitId: (data.unitId as string | undefined) ?? null,
        salePrice: (data.salePrice as Prisma.Decimal | undefined) ?? null,
        discountApprovedAt: (data.discountApprovedAt as Date | undefined) ?? null,
      });
      const commission = await this.computeBrokerCommission(
        {
          brokerId: (data.brokerId as string | undefined) ?? null,
          salePrice: data.salePrice,
          brokerCommissionPct: data.brokerCommissionPct,
        },
        data as Prisma.SaleUncheckedUpdateInput,
      );
      if (commission != null) (data as any).brokerCommissionAmt = commission;
    }

    // A sale born CLOSED against real space is written UNDER_CONTRACT and then closed
    // through update(), so it goes through the ONE closing path rather than a partial
    // copy of it.
    //
    // The copy was the bug. create() applied the discount gate and stamped the
    // commission, then emitted `unit.sold` — but never flipped the unit or ended the
    // tenancy, because that work lives in update(). Verified 2026-08-25: a CLOSED sale
    // created on a let unit left the unit unsold and the sitting tenant's lease ACTIVE
    // with no move-out date, still billing, while Finance was told the unit had sold.
    const closeAfterCreate = createdClosed && !!(data.unitId || data.buildingId);

    const created = await this.prisma.sale.create({
      data: {
        ...data,
        ...(closeAfterCreate ? { status: 'UNDER_CONTRACT' } : {}),
        lastActivityAt: new Date(),
      },
    });

    if (closeAfterCreate) {
      // update() re-runs the discount gate and re-stamps commission — both idempotent on
      // the values create() just computed — and then does the half create() never did.
      return this.update(created.id, { status: 'CLOSED' }, createdById);
    }

    // R7: mirror a commission stamped at creation into the installment table.
    if (createdClosed) {
      await this.commissionInstallments.syncStampedAmount(
        { saleId: created.id },
        created.brokerId,
        created.brokerCommissionAmt != null ? Number(created.brokerCommissionAmt) : null,
      );
      // A sale attached to no unit or building has nothing to close against, so it keeps
      // the direct path — and Finance still needs to hear about it.
      this.bus.emit({ type: 'sale.statusChanged', saleId: created.id, from: 'NEW', to: 'CLOSED' });
    }
    return created;
  }

  async update(
    id: string,
    data: Prisma.SaleUncheckedUpdateInput,
    /** Stamped onto any occupancy event this update causes. */
    updatedById?: string,
    /**
     * What becomes of the money already collected. Only consulted on the transition INTO
     * CANCELLED; omitted entirely means DECIDE_LATER, which is the client-locked default.
     */
    cancellation?: SaleCancellationInput,
  ) {
    const sale = await this.findById(id);
    for (const field of ['loiDate', 'contractDate', 'closingDate'] as const) {
      if (typeof data[field] === 'string') (data as any)[field] = new Date(data[field] as unknown as string);
    }

    // Slice 6: lostReason is captured on cancel — defaulted to OTHER if the caller
    // omits it so legacy clients don't break. The forced-picker UX lives in the
    // frontend; backend stays lenient to preserve API compatibility.
    const dataWithReason: Prisma.SaleUncheckedUpdateInput = { ...data };
    if (data.status === 'CANCELLED' && sale.status !== 'CANCELLED' && !data.lostReason) {
      dataWithReason.lostReason = 'OTHER';
    }

    // Always bump lastActivityAt on any update — drives the activity-drought cron.
    const dataWithActivity = { ...dataWithReason, lastActivityAt: new Date() };

    // Emit status-change so handlers can react (notifications, analytics)
    if (data.status && data.status !== sale.status) {
      // emit AFTER successful write — see below
    }

    const cancelling = data.status === 'CANCELLED' && sale.status !== 'CANCELLED';

    // Document gate (S6/D1): a sale may not ADVANCE into a stage whose paperwork is not
    // on file. Runs before every write for the same reason the discount gate does — a
    // refused transition must leave the sale exactly as it was. Only consulted when this
    // request actually changes the status; an edit that leaves the stage alone, a move
    // backwards, and a cancellation are all ungated (see requiredDocsForTransition).
    if (typeof data.status === 'string' && data.status !== sale.status) {
      await this.assertStageDocumentsAttached(sale, data.status);
    }

    // Discount-approval gate: committing a sale (UNDER_CONTRACT/CLOSED) with an over-threshold
    // discount requires Founder/Co-Founder sign-off first. Single approval (client decision).
    const committing =
      (data.status === 'UNDER_CONTRACT' || data.status === 'CLOSED') && data.status !== sale.status;
    if (committing) {
      await this.assertDiscountApproved(sale);
    }

    // Broker commission is earned when the sale CLOSES — compute + stamp the amount.
    // Also recompute when an ALREADY-CLOSED sale's broker/commission%/price is edited
    // afterward (e.g. correcting the record from the unit page) — otherwise the
    // stamped commission goes stale the moment any of its inputs changes post-close.
    const closingNow = data.status === 'CLOSED' && sale.status !== 'CLOSED';
    const editingClosedCommissionInputs =
      sale.status === 'CLOSED' &&
      (data.brokerId !== undefined || data.brokerCommissionPct !== undefined || data.salePrice !== undefined);
    if (closingNow || editingClosedCommissionInputs) {
      if (data.brokerId === null) {
        // Broker explicitly cleared. computeBrokerCommission's `data.brokerId ?? sale.brokerId`
        // can't tell "cleared" apart from "omitted" — both fall through to the old value —
        // so handle the clear here rather than asking it to compute against a broker
        // that was just removed.
        dataWithActivity.brokerCommissionAmt = null;
      } else {
        const commission = await this.computeBrokerCommission(sale, data);
        if (commission != null) {
          dataWithActivity.brokerCommissionAmt = commission;
        } else if (editingClosedCommissionInputs) {
          // Nothing computable — the broker carries neither a rate nor a flat fee, or
          // there's no price. An already-closed sale may still hold an amount stamped
          // from the previous broker/rate, so leaving it untouched would keep a figure
          // the current inputs no longer support. On the closingNow path there is
          // nothing stale to clear, and a close with no computable commission must
          // stay unstamped.
          dataWithActivity.brokerCommissionAmt = null;
        }
      }
    }

    let result;
    // Did THIS request actually perform the status transition? Only the optimistic-locked
    // CLOSE path can lose (a concurrent CLOSE beat us to the write); every other path
    // writes unconditionally and therefore always applies. Events must be gated on this,
    // not on the pre-transaction snapshot — otherwise two concurrent CLOSEs both read
    // status=UNDER_CONTRACT and both emit, double-notifying every recipient.
    let applied = true;
    // Set inside the transaction, emitted after it commits — a notification must not go
    // out for a tenancy that rolled back with its sale. Plural because a unit can hold
    // more than one tenancy in occupation (see the findMany below).
    let endedLeases: { id: string; tenantName: string }[] = [];
    // WHO bought, relative to the sitting tenant — the whole of the S4/T1 branch derives
    // from this one value. Read from the incoming body when this request sets it, else
    // from the stored row; SITTING_TENANT if neither, which is the column default and
    // therefore what every pre-existing sale means.
    const buyerType = this.resolveBuyerType(sale, dataWithActivity);
    // A third-party buyer takes the tenancy WITH the unit. The lease is not ended in the
    // ordinary sense — it leaves Prime's book intact — so the rent schedule and the future
    // invoices must survive untouched. See LEDGER_PRESERVING_REASONS in leases.service.
    const tenancyTransfers = buyerType === 'THIRD_PARTY';
    const terminationReason: TerminationReason = tenancyTransfers
      ? 'LEASE_TRANSFERRED_WITH_SALE'
      : 'TENANT_BOUGHT';
    if (data.status === 'CLOSED' && sale.unitId) {
      const unitId = sale.unitId;
      // Atomic + optimistic-locked: only the NOT_CLOSED→CLOSED transition stamps the broker
      // commission and flips the unit. Guarding the write on `status != CLOSED` means a
      // concurrent CLOSE finds 0 rows and skips re-stamping brokerCommissionAmt.
      const outcome = await this.prisma.$transaction(async (tx) => {
        const guard = await tx.sale.updateMany({
          where: { id, status: { not: 'CLOSED' } },
          data: dataWithActivity,
        });
        if (guard.count === 0) {
          // Lost the race — already CLOSED elsewhere. Return current row, no side effects.
          return { sale: await tx.sale.findUniqueOrThrow({ where: { id } }), applied: false };
        }
        // Read the prior status inside the transaction so the occupancy event records
        // what the unit actually moved FROM. Reading it outside would race the very
        // concurrent close the optimistic lock above exists to defend against.
        const before = await tx.unit.findUniqueOrThrow({
          where: { id: unitId },
          select: { status: true },
        });
        await tx.unit.update({
          where: { id: unitId },
          // Sale closed → unit becomes SOLD; clear time-on-market. Written BEFORE the
          // tenancy work below, which is load-bearing for a transfer: endTenancyWithin
          // refuses LEASE_TRANSFERRED_WITH_SALE unless the unit already reads SOLD, and
          // that refusal is what stops the ledger-preserving mode being reachable on a
          // unit Prime still owns and still bills.
          data: { status: 'SOLD', availableSince: null },
        });

        // A sale ENDS every tenancy the unit is carrying — unless a THIRD PARTY bought it,
        // in which case the tenancy goes with the unit (S4/T1). Until the H3 work existed,
        // closing a sale flipped the unit to SOLD and left the lease ACTIVE — only the
        // billing cron's sold-unit filter stopped the departed tenant being invoiced, and
        // the unit read SOLD with a tenancy still running.
        //
        // In the SAME transaction on purpose: sold-with-a-live-lease is exactly the
        // inconsistency both halves exist to prevent, so it must not be reachable by one
        // half succeeding. If a tenancy cannot be ended — rent collected past the
        // closing date — the CLOSE fails too, which is the honest outcome: that is a real
        // conflict a person has to resolve, not something to close around.
        //
        // Which of the two happens is DERIVED from Sale.buyerType, never assumed. Before
        // that field existed this path hard-coded TENANT_BOUGHT, so a third-party sale
        // deleted the remaining rent periods and voided the future invoices of a tenant
        // still in occupation and still owing rent.
        //
        // findMany, not findFirst: a unit can legitimately hold MORE THAN ONE
        // non-terminated lease right now. assertNoOverlappingLease permits a lease
        // starting the day another ends, and the unit state machine allows
        // LEASED → LEASE_PENDING precisely so a successor can be signed while the sitting
        // tenant is still in occupation. Ending only the newest row left the older,
        // still-occupying tenancy ACTIVE on a unit now reading SOLD.
        const closingDate = this.toDateOrNow(dataWithActivity.closingDate ?? sale.closingDate);
        const live = await tx.lease.findMany({
          where: {
            unitId,
            deletedAt: null,
            terminationDate: null,
            status: { notIn: ['EXPIRED', 'TERMINATED'] },
          },
          orderBy: { leaseStart: 'asc' },
          select: { id: true, tenantName: true, leaseStart: true },
        });

        // Only tenancies IN OCCUPATION on the closing date are ended by the sale (spec
        // R4). A lease drafted to start later has nothing to end — endTenancyWithin
        // rejects a termination dated before the lease start, so reaching for it would
        // surface as a baffling "move-out date cannot be before the lease start date".
        //
        // Those future leases are deliberately left ALONE here, and the close is never
        // blocked by one (R4). That is not the end of the story: a lease drafted for a
        // unit Prime no longer owns is a commitment nobody can honour, and R4 requires the
        // user be told it exists and asked what to do with it. That question belongs in
        // the close dialog, which is a later phase — not silently answered by this method.
        const closingDay = startOfUtcDay(closingDate);
        const occupying = live.filter((l) => startOfUtcDay(l.leaseStart) <= closingDay);

        // Only the request that won the lock reaches here, so the event is written
        // exactly once — same guarantee the `applied` flag gives the emitted events.
        //
        // Recorded after the tenancy lookup so its `reason` can say which of the two
        // stories this sale is (R6). The unit's history has to distinguish "the tenant
        // bought the place" from "the landlord changed and the tenant stayed" — they have
        // completely different consequences for whoever reads it later.
        await this.statusEvents.recordIfChanged(
          {
            unitId,
            fromStatus: before.status,
            toStatus: 'SOLD',
            source: 'SALE_CLOSED',
            saleId: id,
            effectiveAt: this.toDateOrNow(dataWithActivity.closingDate ?? sale.closingDate),
            reason: this.saleClosedReason(tenancyTransfers, occupying.length),
            recordedById: updatedById,
          },
          tx,
        );

        // ALL of them are acted on, oldest leaseStart first so the outcome does not depend
        // on row order. `terminationReason` carries the whole branch: TENANT_BOUGHT caps
        // the schedule and voids the future invoices, LEASE_TRANSFERRED_WITH_SALE does
        // neither and hands both over intact.
        endedLeases = occupying.map((l) => ({ id: l.id, tenantName: l.tenantName }));
        for (const lease of occupying) {
          await this.leases.endTenancyWithin(
            tx,
            lease.id,
            {
              terminationDate: closingDate,
              terminationReason,
              terminationNote: tenancyTransfers
                ? 'Transferred to the buyer when the sale of this unit closed. The tenant ' +
                  'remains in occupation; Prime no longer manages or bills this tenancy, ' +
                  'and the rent schedule and invoices are preserved as the new owner\'s record.'
                : 'Ended automatically when the sale of this unit closed.',
            },
            updatedById,
          );
        }

        return { sale: await tx.sale.findUniqueOrThrow({ where: { id } }), applied: true };
      });
      result = outcome.sale;
      applied = outcome.applied;
    } else if (data.status === 'CLOSED' && sale.buildingId) {
      // Selling a WHOLE BUILDING did nothing to anything inside it. Verified 2026-08-25:
      // the sale closed, every unit stayed AVAILABLE/LEASED, and their tenancies kept
      // billing rent on a building Prime no longer owned.
      //
      // Deliberately a sibling of the unit branch rather than a generalisation of it.
      // That branch carries the optimistic lock, the buyerType split and the ledger
      // preservation rules, all of it well covered; reshaping it to loop was the larger
      // risk. The rules applied here are the same ones, read from the same buyerType.
      const outcome = await this.prisma.$transaction(async (tx) => {
        const guard = await tx.sale.updateMany({
          where: { id, status: { not: 'CLOSED' } },
          data: dataWithActivity,
        });
        if (guard.count === 0) {
          return { sale: await tx.sale.findUniqueOrThrow({ where: { id } }), applied: false };
        }
        const closingDate = this.toDateOrNow(dataWithActivity.closingDate ?? sale.closingDate);
        const closingDay = startOfUtcDay(closingDate);
        const buildingId = sale.buildingId!;

        const units = await tx.unit.findMany({
          where: { buildingId, deletedAt: null },
          select: { id: true, status: true },
          orderBy: { unitNumber: 'asc' },
        });
        for (const unit of units) {
          if (unit.status !== 'SOLD') {
            await tx.unit.update({
              where: { id: unit.id },
              data: { status: 'SOLD', availableSince: null },
            });
            await this.statusEvents.recordIfChanged(
              {
                unitId: unit.id,
                fromStatus: unit.status,
                toStatus: 'SOLD',
                source: 'SALE_CLOSED',
                saleId: id,
                effectiveAt: closingDate,
                reason: this.saleClosedReason(tenancyTransfers, 0),
                recordedById: updatedById,
              },
              tx,
            );
          }
        }

        // Every tenancy the building carries, at either level: the leases of its units
        // AND any lease of the building as a whole. Both are occupancy the sale ends.
        const live = await tx.lease.findMany({
          where: {
            deletedAt: null,
            terminationDate: null,
            status: { notIn: ['EXPIRED', 'TERMINATED'] },
            OR: [{ buildingId }, { unit: { buildingId, deletedAt: null } }],
          },
          orderBy: { leaseStart: 'asc' },
          select: { id: true, tenantName: true, leaseStart: true },
        });
        // Same rule as the unit branch: only tenancies already in occupation on the
        // closing date are ended. One drafted to start later has nothing to end.
        const occupying = live.filter((l) => startOfUtcDay(l.leaseStart) <= closingDay);
        endedLeases = occupying.map((l) => ({ id: l.id, tenantName: l.tenantName }));
        for (const lease of occupying) {
          await this.leases.endTenancyWithin(
            tx,
            lease.id,
            {
              terminationDate: closingDate,
              terminationReason,
              terminationNote: tenancyTransfers
                ? 'Transferred to the buyer when the sale of this building closed. The tenant '
                  + 'remains in occupation; Prime no longer manages or bills this tenancy.'
                : 'Ended automatically when the sale of this building closed.',
            },
            updatedById,
          );
        }
        return { sale: await tx.sale.findUniqueOrThrow({ where: { id } }), applied: true };
      });
      result = outcome.sale;
      applied = outcome.applied;
    } else if (cancelling) {
      // Cancelling a sale must RELEASE the unit it was holding, or the unit stays stuck
      // in UNDER_CONTRACT forever (backend-issue #1). Only flip a unit that was *reserved*
      // by this sale — never override a SOLD/LEASED/OCCUPIED unit. Restart time-on-market.
      const unit = sale.unitId
        ? await this.prisma.unit.findUnique({
            where: { id: sale.unitId },
            select: { status: true },
          })
        : null;
      const reserved = !!unit && ['UNDER_CONTRACT', 'LEASE_PENDING'].includes(unit.status);
      const unitId = sale.unitId;

      // ONE transaction for the whole cancellation. The refund/penalty ledger (S1) is not
      // a follow-up step: a sale whose unit went back on the market with no account of the
      // money already collected is the exact hole this feature closes, so it must not be
      // reachable by one half succeeding. A ledger that does not reconcile therefore fails
      // the cancellation outright rather than releasing the unit and losing the money.
      //
      // Interactive rather than the array form: the occupancy event needs the unit's prior
      // status, and array-form operations cannot read a value produced in the same
      // transaction.
      result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.sale.update({ where: { id }, data: dataWithActivity });
        await this.recordCancellation(tx, id, cancellation, updatedById);
        if (reserved && unitId) {
          const before = await tx.unit.findUniqueOrThrow({
            where: { id: unitId },
            select: { status: true },
          });
          await tx.unit.update({
            where: { id: unitId },
            data: { status: 'AVAILABLE', availableSince: new Date() },
          });
          await this.statusEvents.recordIfChanged(
            {
              unitId,
              fromStatus: before.status,
              toStatus: 'AVAILABLE',
              source: 'SALE_CANCELLED',
              saleId: id,
              reason: 'Sale cancelled — reserved unit released back to market',
              recordedById: updatedById,
            },
            tx,
          );
        }
        return updated;
      });
    } else {
      result = await this.prisma.sale.update({ where: { id }, data: dataWithActivity });
    }

    // A tenancy taken off Prime's book by a sale must notify on exactly the same footing
    // as one ended by hand through LeasesService.endTenancy (spec R5) — otherwise the
    // alert depends on which door was used, and the sale door is the silent one.
    // endTenancyWithin emits nothing by design (the caller's transaction may still roll
    // back), so the emit is this method's job, here: after the commit, and only for a
    // close that actually applied. Same event shape as endTenancy's, and projectId comes
    // from the sale for the same reason unit.sold's does — the lease is on the sale's own
    // unit.
    //
    // BOTH paths emit, and `reason` is what tells them apart. A transfer does not get its
    // own event type: the audience is identical (Finance stops expecting the rent, Sales
    // stops treating the space as Prime's) and the required actions are the same, so a
    // second event type would be two names for one message — and a handler that forgot to
    // subscribe to the new one would silently re-create the exact R5 defect this fixes.
    // Downstream can branch on `reason`, which is already how TENANT_BOUGHT is told from
    // an ordinary move-out.
    if (applied && sale.projectId) {
      for (const lease of endedLeases) {
        this.bus.emit({
          type: 'lease.terminated',
          leaseId: lease.id,
          projectId: sale.projectId,
          tenantName: lease.tenantName,
          reason: terminationReason,
        });
      }
    }

    // `applied` (not the stale pre-read snapshot) is what makes these events fire exactly
    // once: the request that lost the optimistic lock changed nothing, so announcing a
    // transition it didn't make would double-notify — and its `from` is stale besides.
    if (applied && data.status && data.status !== sale.status) {
      this.bus.emit({
        type: 'sale.statusChanged',
        saleId: id,
        from: sale.status,
        to: data.status as string,
      });
      // A unit flipping to SOLD is the event Finance/Sales/Accounting actually care
      // about — distinct from a sale merely changing stage. Only emitted for
      // unit-level sales; a building-level sale has no unit to flip.
      if (data.status === 'CLOSED' && sale.status !== 'CLOSED' && sale.unitId && sale.projectId) {
        this.bus.emit({
          type: 'unit.sold',
          unitId: sale.unitId,
          saleId: id,
          projectId: sale.projectId,
        });
      }
    }

    // R7: only when this write actually applied AND touched brokerCommissionAmt — an
    // unrelated edit, or the losing side of the optimistic-locked CLOSE race, must not
    // re-run the sync and risk nudging an untouched installment's amount.
    if (applied && dataWithActivity.brokerCommissionAmt !== undefined) {
      await this.commissionInstallments.syncStampedAmount(
        { saleId: id },
        result.brokerId,
        result.brokerCommissionAmt != null ? Number(result.brokerCommissionAmt) : null,
      );
    }

    return result;
  }

  // ─────── Historical backfill (R4) ───────

  /**
   * A sale that already closed, entered by hand — the sale-side counterpart to
   * LeasesService.backfillTenancy (H2). Deliberately does NOT compose create()/update():
   * those carry live-workflow gates (discount approval, stage-document requirements) that
   * exist to govern a deal that is ABOUT to happen. A historical sale already happened —
   * gating it behind today's discount threshold or document checklist would block
   * legitimate old data for reasons that have nothing to do with it.
   */
  async backfillSale(input: BackfillSaleInput, userId?: string) {
    if (!input.unitId && !input.buildingId) {
      throw new BadRequestException('Sale must reference either a unit or a building');
    }
    if (input.unitId && input.buildingId) {
      throw new BadRequestException('Sale cannot reference both a unit and a building');
    }

    const closingDate = startOfUtcDay(new Date(input.closingDate));
    const today = startOfUtcDay(new Date());
    if (Number.isNaN(closingDate.getTime())) {
      throw new BadRequestException('Closing date must be a valid date');
    }
    // The whole point is that this is history — exactly backfillTenancy's guard.
    if (closingDate > today) {
      throw new BadRequestException(
        'This sale has not closed yet. Add it as a normal sale instead — backfill is for '
        + 'deals that already closed.',
      );
    }
    const contractDate = input.contractDate ? startOfUtcDay(new Date(input.contractDate)) : null;

    let projectId: string;
    let unitId: string | null = null;
    let buildingId: string | null = null;
    if (input.unitId) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: input.unitId },
        select: { id: true, deletedAt: true, building: { select: { projectId: true } } },
      });
      if (!unit || unit.deletedAt) throw new NotFoundException('Unit not found');
      projectId = unit.building.projectId;
      unitId = input.unitId;
    } else {
      const building = await this.prisma.building.findUnique({
        where: { id: input.buildingId! },
        select: { id: true, deletedAt: true, projectId: true },
      });
      if (!building || building.deletedAt) throw new NotFoundException('Building not found');
      projectId = building.projectId;
      buildingId = input.buildingId!;
    }

    const buyerType = input.buyerType ?? 'SITTING_TENANT';
    const tenancyTransfers = buyerType === 'THIRD_PARTY';
    const terminationReason: TerminationReason = tenancyTransfers
      ? 'LEASE_TRANSFERRED_WITH_SALE'
      : 'TENANT_BOUGHT';

    // Commission (R7): prefer the ACTUAL installment amounts if the caller has them —
    // backfill data records what really happened, which may not match today's formula.
    // Falls back to the same computeBrokerCommission the live close() path uses.
    let brokerCommissionAmt: number | null = null;
    if (input.brokerId) {
      if (input.commissionInstallments?.length) {
        brokerCommissionAmt = input.commissionInstallments.reduce((sum, c) => sum + c.amount, 0);
      } else {
        const computed = await this.computeBrokerCommission(
          { brokerId: input.brokerId, salePrice: input.salePrice, brokerCommissionPct: input.brokerCommissionPct ?? null },
          {},
        );
        brokerCommissionAmt = computed ?? null;
      }
    }

    // Deposit mirrors onto the flat Sale.depositAmt column too (not ONLY the SalePayment
    // row below) — UnitHistoryService's sale timeline entry still reads that column
    // directly, and duplicating one number here is cheaper than teaching it to sum
    // payments for this one case.
    const depositEntry = input.payments?.find((p) => p.label.trim().toLowerCase() === 'deposit');

    let endedLeases: { id: string; tenantName: string }[] = [];
    const sale = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          projectId,
          unitId,
          buildingId,
          seller: input.seller ?? null,
          buyer: input.buyer,
          buyerType,
          salePrice: input.salePrice,
          depositAmt: depositEntry ? depositEntry.amount : null,
          status: 'CLOSED',
          contractDate,
          closingDate,
          notes: input.notes ?? null,
          brokerId: input.brokerId ?? null,
          brokerCommissionPct: input.brokerCommissionPct ?? null,
          brokerCommissionAmt,
          isHistorical: true,
          lastActivityAt: new Date(),
        },
      });

      for (const [i, p] of (input.payments ?? []).entries()) {
        await tx.salePayment.create({
          data: {
            saleId: created.id,
            label: p.label,
            sequence: i + 1,
            trigger: 'FIXED_DATE',
            dueDate: p.paidAt ? new Date(p.paidAt) : closingDate,
            amount: p.amount,
            paidAmount: p.amount,
            paidAt: p.paidAt ? new Date(p.paidAt) : closingDate,
            status: 'PAID',
            notes: 'Historical — entered during backfill',
          },
        });
      }

      if (unitId) {
        const beforeUnit = await tx.unit.findUniqueOrThrow({ where: { id: unitId }, select: { status: true } });
        await tx.unit.update({
          where: { id: unitId },
          data: { status: 'SOLD', availableSince: null },
        });

        // Same "which tenancies are IN OCCUPATION on the closing date" filter as close().
        const live = await tx.lease.findMany({
          where: {
            unitId,
            deletedAt: null,
            terminationDate: null,
            status: { notIn: ['EXPIRED', 'TERMINATED'] },
          },
          orderBy: { leaseStart: 'asc' },
          select: { id: true, tenantName: true, leaseStart: true },
        });
        const closingDay = startOfUtcDay(closingDate);
        const occupying = live.filter((l) => startOfUtcDay(l.leaseStart) <= closingDay);

        await this.statusEvents.recordIfChanged(
          {
            unitId,
            fromStatus: beforeUnit.status,
            toStatus: 'SOLD',
            source: 'SALE_CLOSED',
            saleId: created.id,
            effectiveAt: closingDate,
            isHistorical: true,
            reason: this.saleClosedReason(tenancyTransfers, occupying.length)
              ?? `Historical sale entered by hand — ${input.buyer}`,
            recordedById: userId,
          },
          tx,
        );

        endedLeases = occupying.map((l) => ({ id: l.id, tenantName: l.tenantName }));
        for (const lease of occupying) {
          await this.leases.endTenancyWithin(
            tx,
            lease.id,
            {
              terminationDate: closingDate,
              terminationReason,
              terminationNote: tenancyTransfers
                ? 'Transferred to the buyer when the historical sale of this unit closed.'
                : 'Ended automatically when the historical sale of this unit closed (backfill).',
            },
            userId,
          );
        }
      }

      return created;
    });

    // R7: mirror the stamped commission into the installment table — outside the write
    // transaction, same "recoverable" reasoning as everywhere else this sync happens.
    if (input.brokerId && brokerCommissionAmt != null) {
      if (input.commissionInstallments?.length) {
        for (const [i, c] of input.commissionInstallments.entries()) {
          await this.commissionInstallments.add(
            { saleId: sale.id },
            { brokerId: input.brokerId, amount: c.amount, paidAt: c.paidAt ? new Date(c.paidAt) : null, sequence: i + 1 },
          );
        }
      } else {
        await this.commissionInstallments.syncStampedAmount({ saleId: sale.id }, input.brokerId, brokerCommissionAmt);
      }
    }

    if (unitId) {
      for (const lease of endedLeases) {
        this.bus.emit({
          type: 'lease.terminated',
          leaseId: lease.id,
          projectId,
          tenantName: lease.tenantName,
          reason: terminationReason,
        });
      }
    }
    this.bus.emit({ type: 'sale.statusChanged', saleId: sale.id, from: 'NEW', to: 'CLOSED' });
    if (unitId) {
      this.bus.emit({ type: 'unit.sold', unitId, saleId: sale.id, projectId });
    }

    await this.audit.log({
      userId,
      action: 'SALE_HISTORY_BACKFILLED',
      entity: 'Sale',
      entityId: sale.id,
      newValues: { unitId, buildingId, buyer: input.buyer, salePrice: input.salePrice, closingDate },
    });

    return sale;
  }

  // ─────── Cancellation ledger (S1) ───────

  /**
   * Record what became of the money already collected, and void the rest of the schedule.
   *
   * Deliberately conservative, exactly like LeasesService.settleDeposit: this records a
   * DECISION, it does not move money. SalePayment.paidAmount keeps meaning "what was
   * collected" — overloading it to also mean "refunded" would corrupt every receivables
   * and collections figure. Finance records the actual refund in their own system and
   * stamps refundPaidAt/refundReference here when it clears.
   *
   * Runs inside the caller's cancelling transaction so the ledger and the unit release
   * are one atomic act.
   */
  private async recordCancellation(
    tx: Prisma.TransactionClient,
    saleId: string,
    input: SaleCancellationInput | undefined,
    cancelledById?: string,
  ) {
    // Summed INSIDE the transaction and then frozen onto the row. Recomputing this on
    // read would let an installment edited months later silently restate a settlement
    // that was correct when it was agreed.
    const totalCollected = await this.salePayments.sumCollected(tx, saleId);

    const disposition = input?.disposition ?? 'DECIDE_LATER';
    const refundAmount = money(input?.refundAmount);
    const penaltyAmount = money(input?.penaltyAmount);

    assertCancellationReconciles({ disposition, totalCollected, refundAmount, penaltyAmount });
    const refundPaidAt = this.parseRefundPaidAt(input?.refundPaidAt, refundAmount);

    const row = {
      cancelledAt: new Date(),
      cancelledById: cancelledById ?? null,
      totalCollected,
      disposition,
      refundAmount,
      penaltyAmount,
      refundPaidAt,
      refundReference: input?.refundReference ?? null,
      note: input?.note ?? null,
    };

    // upsert, not create: nothing stops a CANCELLED sale being moved back to PROSPECT and
    // then cancelled again, and the second cancellation would hit @unique(saleId) as a
    // raw 500. The row records the outcome of THE cancellation this sale is currently
    // under, so a re-cancellation legitimately replaces it — with a freshly taken
    // totalCollected, since money may have moved in between. The superseded figures stay
    // in the audit log.
    const record = await tx.saleCancellation.upsert({
      where: { saleId },
      create: { saleId, ...row },
      update: row,
    });

    await this.salePayments.voidScheduleOnCancellation(tx, saleId);
    return record;
  }

  /** The ledger for a cancelled sale, or null if it was cancelled before S1 shipped. */
  async getCancellation(saleId: string) {
    await this.findById(saleId); // 404 if the sale is missing
    return this.prisma.saleCancellation.findUnique({ where: { saleId } });
  }

  /**
   * Finance settling a DECIDE_LATER after the fact, or stamping the reference once the
   * refund has actually cleared.
   *
   * Reconciles against the SNAPSHOT, never a fresh sum — the amount collected at the
   * moment of cancellation is the amount being disposed of, whatever has happened to the
   * installment rows since.
   */
  async settleCancellation(
    saleId: string,
    input: {
      disposition?: SaleCancellationDisposition;
      refundAmount?: number;
      penaltyAmount?: number;
      refundPaidAt?: string | Date;
      refundReference?: string;
      note?: string;
    },
  ) {
    const existing = await this.prisma.saleCancellation.findUnique({ where: { saleId } });
    if (!existing) {
      throw new NotFoundException('This sale has no cancellation record to settle');
    }

    const disposition = input.disposition ?? existing.disposition;
    // A decision, once made, can be CORRECTED — Finance gets numbers wrong like anyone
    // else, and the audit log carries the change. It cannot be UN-made: reverting to
    // DECIDE_LATER would erase the fact that somebody decided, which is the one thing
    // this row exists to remember.
    if (disposition === 'DECIDE_LATER' && existing.disposition !== 'DECIDE_LATER') {
      throw new BadRequestException(
        `This cancellation was already settled as ${existing.disposition} and cannot be ` +
          `returned to DECIDE_LATER. Correct the amounts, or record a new disposition.`,
      );
    }

    const totalCollected = new Prisma.Decimal(existing.totalCollected);
    const refundAmount =
      input.refundAmount !== undefined ? money(input.refundAmount) : money(existing.refundAmount);
    const penaltyAmount =
      input.penaltyAmount !== undefined ? money(input.penaltyAmount) : money(existing.penaltyAmount);

    assertCancellationReconciles({ disposition, totalCollected, refundAmount, penaltyAmount });
    const refundPaidAt =
      input.refundPaidAt !== undefined
        ? this.parseRefundPaidAt(input.refundPaidAt, refundAmount)
        : existing.refundPaidAt;
    // Guards the case where the amounts are corrected to zero refund on a row that was
    // already stamped as paid — the DB CHECK would reject it anyway, less legibly.
    if (refundPaidAt && refundAmount.lte(0)) {
      throw new BadRequestException(
        'This cancellation is marked as refunded, so the refund amount cannot be zero. ' +
          'Clear refundPaidAt if no money moved.',
      );
    }

    return this.prisma.saleCancellation.update({
      where: { saleId },
      data: {
        disposition,
        refundAmount,
        penaltyAmount,
        refundPaidAt,
        refundReference: input.refundReference ?? existing.refundReference,
        note: input.note ?? existing.note,
      },
    });
  }

  /** `refundPaidAt` says money moved; with nothing to refund that is a contradiction. */
  private parseRefundPaidAt(
    value: string | Date | undefined | null,
    refundAmount: Prisma.Decimal,
  ): Date | null {
    if (value == null || value === '') return null;
    const at = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(at.getTime())) {
      throw new BadRequestException('refundPaidAt is not a valid date');
    }
    if (refundAmount.lte(0)) {
      throw new BadRequestException(
        'refundPaidAt records the day the refund actually moved, but this cancellation ' +
          'refunds nothing. Set a refund amount, or leave refundPaidAt empty.',
      );
    }
    return at;
  }

  // ─────── Stage document gate (S6 + D1) ───────

  /**
   * Refuses a stage ADVANCE whose required documents are not attached to the sale.
   *
   * The map lives in `sale-document-gates.ts` (mirrored for display only by
   * apps/web/src/components/DocumentGateChip.tsx) — changing what a stage requires is an
   * edit to that map, never to this method.
   *
   * NOT applied in create(): a document attaches to a sale by `saleId`, so at creation
   * there is no sale for one to point at and the gate could never be satisfied. The
   * "create already CLOSED" path (the units flow) is therefore ungated by construction —
   * a deliberate seam, unlike the discount gate, which create() does mirror.
   */
  private async assertStageDocumentsAttached(
    sale: { id: string; status: string; buyer?: string | null; unit?: { unitNumber?: string } | null },
    target: string,
  ) {
    const required = requiredDocsForTransition(sale.status, target);
    if (required.length === 0) return;

    // Soft-deleted documents do not count — a deleted LOI is not an LOI on file.
    const attached = await this.prisma.document.findMany({
      where: { saleId: sale.id, deletedAt: null, category: { in: required } },
      select: { category: true },
    });
    const have = new Set(attached.map((d) => d.category as string));
    const missing = required.filter((c) => !have.has(c));
    if (missing.length === 0) return;

    // Name the sale, the stage, and every missing category by name: a gate that says only
    // "documents required" makes the user guess which one, on which sale.
    const names = missing.map(docCategoryLabel);
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const isAre = missing.length === 1 ? 'is' : 'are';
    const itThem = missing.length === 1 ? 'it' : 'them';
    const skipNote = transitionSkipsStages(sale.status, target)
      ? ` Moving straight from ${saleStageLabel(sale.status)} to ${saleStageLabel(target)} also ` +
        `requires the documents for the stages being skipped.`
      : '';

    throw new ForbiddenException(
      `${this.describeSale(sale)} cannot move to ${saleStageLabel(target)}: ${list} ` +
        `${isAre} not attached to this sale. Upload ${itThem} to the sale's documents, then ` +
        `move the stage.${skipNote}`,
    );
  }

  /** Enough of the sale to identify it in a refusal without opening the record. */
  private describeSale(sale: {
    id: string;
    buyer?: string | null;
    unit?: { unitNumber?: string } | null;
  }): string {
    const unit = sale.unit?.unitNumber ? `unit ${sale.unit.unitNumber}` : null;
    if (unit && sale.buyer) return `The sale of ${unit} to ${sale.buyer}`;
    if (unit) return `The sale of ${unit}`;
    if (sale.buyer) return `The sale to ${sale.buyer}`;
    return `Sale ${sale.id}`;
  }

  /** Founder/Co-Founder records sign-off on an over-threshold discount. */
  async approveDiscount(id: string, userId: string) {
    await this.findById(id); // 404 if missing
    return this.prisma.sale.update({
      where: { id },
      data: { discountApprovedById: userId, discountApprovedAt: new Date() },
    });
  }

  /** Throws if the sale carries an over-threshold, un-approved discount vs the unit's asking price. */
  private async assertDiscountApproved(sale: {
    projectId: string;
    unitId: string | null;
    salePrice: Prisma.Decimal | null;
    discountApprovedAt: Date | null;
  }) {
    if (sale.discountApprovedAt) return; // already signed off
    if (!sale.unitId || sale.salePrice == null) return; // can't compute (building-level / no price)

    const unit = await this.prisma.unit.findUnique({
      where: { id: sale.unitId },
      select: { askingPrice: true },
    });
    const discountPct = discountPctOffAsking(unit?.askingPrice, sale.salePrice);
    if (discountPct == null || discountPct <= 0) return; // no computable discount

    const threshold = await this.resolveDiscountThreshold(sale.projectId);
    if (discountPct > threshold) {
      throw new ForbiddenException(
        `This sale's ${discountPct.toFixed(1)}% discount exceeds the ${threshold}% threshold and requires ` +
          `Founder/Co-Founder approval before it can be committed.`,
      );
    }
  }

  /**
   * Commission earned by the attributed broker when the sale closes.
   * Precedence: per-sale % override → broker default % (× salePrice) → broker flat fee.
   * Returns undefined when there's no broker or nothing to compute.
   */
  private async computeBrokerCommission(
    sale: { brokerId: string | null; salePrice: any; brokerCommissionPct: any },
    data: Prisma.SaleUncheckedUpdateInput,
  ): Promise<number | undefined> {
    const brokerId = (data.brokerId as string | undefined) ?? sale.brokerId ?? undefined;
    if (!brokerId) return undefined;
    const broker = await this.prisma.broker.findUnique({
      where: { id: brokerId },
      select: { commissionRate: true, commissionFlat: true },
    });
    if (!broker) return undefined;

    // An explicit null means the per-sale override was CLEARED, which is not the same as
    // omitting it (undefined), where the sale's existing override still stands. Without
    // this the `??` chain falls straight through to the value just deleted, recomputing
    // the amount from an override the row no longer has. Cleared → drop to the next rung
    // of the documented precedence: per-sale override → broker rate → flat fee.
    const pctCleared = data.brokerCommissionPct === null;
    const pctRaw = pctCleared
      ? broker.commissionRate
      : (data.brokerCommissionPct as any) ?? sale.brokerCommissionPct ?? broker.commissionRate;
    const priceRaw = (data.salePrice as any) ?? sale.salePrice;
    const salePrice = priceRaw != null ? Number(priceRaw) : null;

    if (pctRaw != null && salePrice != null) return (salePrice * Number(pctRaw)) / 100;
    if (broker.commissionFlat != null) return Number(broker.commissionFlat);
    return undefined;
  }

  /** Public so the unit-swap path (S3) re-gates against the same org threshold. */
  async resolveDiscountThreshold(projectId: string): Promise<number> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (project?.orgId) {
      const settings = await this.prisma.orgSettings.findUnique({
        where: { orgId: project.orgId },
        select: { discountApprovalThresholdPct: true },
      });
      if (settings?.discountApprovalThresholdPct != null) {
        return Number(settings.discountApprovalThresholdPct);
      }
    }
    return 5; // default until the org configures a threshold
  }

  /**
   * Soft-delete a sale.
   *
   * A HISTORICAL sale (entered by hand via R4 backfill) needs the same Founder-approval
   * gate a backfilled lease already has (R27, generalized by R6) — it carries a deal
   * (price, deposit, commission) typed in from records nothing witnessed, so deleting it
   * destroys data that cannot be regenerated. This gate takes precedence over the
   * pre-existing role check below, which still governs LIVE closed sales — a different
   * concern (protecting a real transaction from casual deletion, not protecting
   * unregenerable history).
   */
  async delete(id: string, userId: string | undefined, userRole: UserRole, canApproveDeletion = false) {
    const sale = await this.findById(id);
    const historical = !!(sale as any).isHistorical;
    let approvalId: string | null = null;
    let selfApproved = false;

    if (historical) {
      const target = { saleId: id };
      const approved = await this.historicalDeletions.findLatestApproved(target);
      if (approved) {
        approvalId = approved.id;
      } else if (canApproveDeletion) {
        selfApproved = true;
        const record = await this.historicalDeletions.selfApprove(target, userId!);
        approvalId = record.id;
      } else {
        const pending = await this.historicalDeletions.findPending(target);
        throw new ForbiddenException(
          pending
            ? 'A deletion request for this historical record is still awaiting Founder approval.'
            : 'Historical records cannot be deleted directly. Request deletion first — a Founder '
              + 'has to approve it.',
        );
      }
      await this.historicalDeletions.markCompleted(approvalId!);
    } else if (sale.status === 'CLOSED' && !['FOUNDER', 'SUPER_ADMIN'].includes(userRole)) {
      throw new ForbiddenException('Closed sales can only be deleted by Founder or Super Admin');
    }

    const deleted = await this.prisma.sale.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId,
      action: historical ? 'SALE_HISTORICAL_DELETED' : 'SALE_DELETED',
      entity: 'Sale',
      entityId: id,
      oldValues: {
        buyer: sale.buyer,
        isHistorical: historical,
        ...(historical ? { approvalId, selfApproved } : {}),
      },
    });
    return deleted;
  }

  /** Ask a Founder to approve deleting a backfilled sale. Reason is mandatory. */
  async requestHistoricalDeletion(saleId: string, reason: string, userId: string) {
    const sale = await this.findById(saleId);
    if (!(sale as any).isHistorical) {
      throw new BadRequestException(
        'This sale was recorded live, not backfilled — delete it directly.',
      );
    }
    const request = await this.historicalDeletions.request({ saleId }, reason, userId);

    await this.audit.log({
      userId,
      action: 'HISTORICAL_DELETION_REQUESTED',
      entity: 'Sale',
      entityId: saleId,
      newValues: { requestId: request.id, reason: request.reason },
    });
    this.bus.emit({
      type: 'history.deletionRequested',
      requestId: request.id,
      saleId,
      projectId: sale.projectId ?? null,
      label: sale.buyer ?? 'a sale',
      reason: request.reason,
      requestedById: userId,
    });
    return request;
  }
}
