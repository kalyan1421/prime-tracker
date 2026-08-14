import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, UnitStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';
import { startOfUtcDay } from '../leases/lease-rent-period.service';
import { SalesService, discountPctOffAsking } from './sales.service';

/**
 * S3 — unit swap mid-contract.
 *
 * A buyer who signed an LOI on unit 101 and now wants unit 205 keeps the SAME sale.
 * Client decision 2026-08-14: carry forward, not cancel-and-restart. The buyer, the
 * documents and the broker are untouched; the payment schedule is rebased; the discount
 * approval carries only if the concession did not grow.
 *
 * Deliberately its own service rather than another branch of SalesService.update: a
 * swap is not a status change, it touches two units and every installment, and folding
 * it into the status machine would put a second multi-row transaction inside a method
 * that already carries three.
 */

/** Statuses that mean somebody else already has a claim on the unit, and why. */
const HELD_STATUS_REASON: Partial<Record<UnitStatus, string>> = {
  SOLD: 'has already been sold',
  OCCUPIED: 'is occupied',
  LEASED: 'is let',
  LEASE_PENDING: 'has a lease pending on it',
  UNDER_CONTRACT: 'is already under contract',
};

/** Sale stages that hold a unit off the market for their buyer. */
const HOLDING_SALE_STATUSES = ['LOI_SIGNED', 'UNDER_CONTRACT', 'CLOSED'];

/**
 * Installment states the rebase may rewrite. Everything else is either money that has
 * already moved (flagged instead — see below), a concession Prime already granted
 * (WAIVED), or scaffolding from a previous cancellation (CANCELLED); none of those is a
 * live balance for the new price to act on.
 */
const REBASABLE_STATUSES = ['SCHEDULED', 'DUE', 'OVERDUE'];

/**
 * Percentages are compared as floats, so an exactly-equal discount must not read as an
 * increase because 12.000000000000002 > 12. A hundred-thousandth of a percent on a $1M
 * unit is a tenth of a cent.
 */
const PCT_EPSILON = 1e-9;

export interface TransferSaleUnitInput {
  toUnitId: string;
  /** When the switch takes effect. Defaults to today. */
  effectiveDate?: string | Date;
  /**
   * The renegotiated price on the new unit. OMITTED means the price carries unchanged —
   * deliberately not derived from the new unit's asking price, because a sale price is a
   * negotiated number and guessing one would silently rewrite the deal.
   */
  newSalePrice?: number | null;
  reason?: string;
  note?: string;
}

@Injectable()
export class SaleUnitTransferService {
  constructor(
    private prisma: PrismaService,
    private statusEvents: UnitStatusEventService,
    private sales: SalesService,
  ) {}

  /** Every unit this sale has moved between, oldest first. */
  async findBySale(saleId: string) {
    return this.prisma.saleUnitTransfer.findMany({
      where: { saleId },
      orderBy: { effectiveDate: 'asc' },
      include: {
        fromUnit: { select: { id: true, unitNumber: true } },
        toUnit: { select: { id: true, unitNumber: true } },
        recordedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Move a live sale from one unit to another, carrying the deal with it.
   *
   * ONE transaction covers the sale, both units, both occupancy events, the rebased
   * installments and the transfer row. A half-applied swap — the new unit reserved while
   * the old one is still held, or a rebased schedule against the old price — is worse
   * than a refusal, because nothing in the system afterwards says which half happened.
   */
  async transferUnit(saleId: string, input: TransferSaleUnitInput, recordedById?: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { unit: { select: { id: true, unitNumber: true, askingPrice: true, status: true } } },
    });
    if (!sale || sale.deletedAt) throw new NotFoundException('Sale not found');

    // ─── Guards ───

    // A completed or dead deal does not swap units. Separate messages on purpose: the
    // right next step differs, and "cannot transfer" alone leaves the user guessing.
    if (sale.status === 'CLOSED') {
      throw new BadRequestException(
        `${this.describe(sale)} has already CLOSED — the unit has changed hands and the ` +
          `money has been collected against it. A closed deal does not swap units; if the ` +
          `buyer now wants a different unit, that is a new sale.`,
      );
    }
    if (sale.status === 'CANCELLED') {
      throw new BadRequestException(
        `${this.describe(sale)} was CANCELLED, and its refund/penalty ledger has already ` +
          `settled what happened to the money. A dead deal does not swap units — start a ` +
          `new sale on the unit the buyer now wants.`,
      );
    }
    if (!sale.unitId || !sale.unit) {
      throw new BadRequestException(
        `${this.describe(sale)} is attached to a building rather than a unit, so there is ` +
          `no unit to swap. Change the asset on the sale itself.`,
      );
    }
    if (input.toUnitId === sale.unitId) {
      throw new BadRequestException(
        `Unit ${sale.unit.unitNumber} is already the unit on this sale — nothing to transfer.`,
      );
    }

    const toUnit = await this.prisma.unit.findUnique({
      where: { id: input.toUnitId },
      include: { building: { select: { projectId: true, name: true } } },
    });
    if (!toUnit) throw new NotFoundException('The unit to transfer to was not found');
    if (toUnit.deletedAt) {
      throw new BadRequestException(
        `Unit ${toUnit.unitNumber} has been deleted and cannot take on a sale.`,
      );
    }
    if (toUnit.building.projectId !== sale.projectId) {
      throw new BadRequestException(
        `Unit ${toUnit.unitNumber} belongs to a different project than this sale. A sale ` +
          `can only move between units in its own project.`,
      );
    }

    await this.assertTargetIsFree(toUnit, saleId);

    const effectiveDate = this.parseEffectiveDate(input.effectiveDate);

    // ─── The money ───

    const priceBefore = sale.salePrice;
    const priceAfter =
      input.newSalePrice === undefined
        ? priceBefore
        : input.newSalePrice === null
          ? null
          : new Prisma.Decimal(input.newSalePrice).toDecimalPlaces(2);

    // A percentage installment with no price to take a percentage OF is not something to
    // resolve quietly — refuse before anything is written rather than leave a schedule
    // half-derived from a price that no longer exists.
    const percentInstallments = await this.prisma.salePayment.count({
      where: { saleId, percentOfPrice: { not: null } },
    });
    if (percentInstallments > 0 && priceAfter == null) {
      throw new BadRequestException(
        `This sale has ${percentInstallments} installment(s) priced as a percentage of the ` +
          `sale price, so the transfer needs a price on the new unit. Give one, or convert ` +
          `those installments to fixed amounts first.`,
      );
    }

    // ─── Discount approval (client-confirmed 2026-08-14) ───
    //
    // A Founder approving 12% off an $800k unit has NOT approved 12% off a $1.1M one:
    // the absolute concession is larger, and carrying the approval unchanged turns a
    // specific sign-off into a blank cheque. So the approval carries only when the new
    // discount % is the same or LOWER; an increase clears it and re-gates through the
    // existing approval flow.
    const discountPctBefore = discountPctOffAsking(sale.unit.askingPrice, priceBefore);
    const discountPctAfter = discountPctOffAsking(toUnit.askingPrice, priceAfter);
    const hadApproval = sale.discountApprovedAt != null;
    // Unknown counts as an increase. If the new unit carries an asking price and the old
    // one did not, there is no approved figure to compare against, and the safe direction
    // — the one that costs Prime nothing — is to ask the Founder again.
    const discountIncreased =
      discountPctAfter != null &&
      (discountPctBefore == null || discountPctAfter > discountPctBefore + PCT_EPSILON);
    const clearApproval = hadApproval && discountIncreased;

    // `approvalReRequired` records the consequence, not just the mechanic: true when the
    // sale comes out of this transfer WITHOUT a valid approval for a discount that
    // exceeds the org threshold — i.e. its next move to UNDER_CONTRACT/CLOSED will be
    // refused by SalesService's gate until a Founder signs off. An approval cleared on a
    // discount that is under the threshold anyway is not "re-required": nothing is
    // blocked, and a banner that cries wolf gets ignored when it matters.
    const threshold = await this.sales.resolveDiscountThreshold(sale.projectId);
    const approvalAfter = hadApproval && !clearApproval;
    const approvalReRequired =
      !approvalAfter && discountPctAfter != null && discountPctAfter > threshold;

    const fromUnit = sale.unit;

    return this.prisma.$transaction(async (tx) => {
      const payments = await this.rebasePayments(tx, saleId, priceBefore, priceAfter);

      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          unitId: toUnit.id,
          salePrice: priceAfter,
          lastActivityAt: new Date(),
          ...(clearApproval ? { discountApprovedById: null, discountApprovedAt: null } : {}),
        },
      });

      // The old unit goes back on the market — but only if THIS sale was what was
      // holding it. Same rule as the cancellation path: never override a unit that is
      // SOLD, LEASED or OCCUPIED, because whatever put it there is not this sale.
      const fromBefore = await tx.unit.findUniqueOrThrow({
        where: { id: fromUnit.id },
        select: { status: true },
      });
      const wasReserved = ['UNDER_CONTRACT', 'LEASE_PENDING'].includes(fromBefore.status);
      if (wasReserved) {
        await tx.unit.update({
          where: { id: fromUnit.id },
          // availableSince is the transfer date, not now(): a swap recorded a week late
          // must not read as a week of vacancy that never happened.
          data: { status: 'AVAILABLE', availableSince: effectiveDate },
        });
        await this.statusEvents.recordIfChanged(
          {
            unitId: fromUnit.id,
            fromStatus: fromBefore.status,
            toStatus: 'AVAILABLE',
            source: 'SALE_TRANSFERRED_OUT',
            saleId,
            effectiveAt: effectiveDate,
            reason: `Buyer transferred to unit ${toUnit.unitNumber}`,
            recordedById,
          },
          tx,
        );
      }

      // The new unit is now spoken for.
      const toBefore = await tx.unit.findUniqueOrThrow({
        where: { id: toUnit.id },
        select: { status: true },
      });
      await tx.unit.update({
        where: { id: toUnit.id },
        data: { status: 'UNDER_CONTRACT', availableSince: null },
      });
      await this.statusEvents.recordIfChanged(
        {
          unitId: toUnit.id,
          fromStatus: toBefore.status,
          toStatus: 'UNDER_CONTRACT',
          source: 'SALE_TRANSFERRED_IN',
          saleId,
          effectiveAt: effectiveDate,
          reason: `Sale transferred in from unit ${fromUnit.unitNumber}`,
          recordedById,
        },
        tx,
      );

      const transfer = await tx.saleUnitTransfer.create({
        data: {
          saleId,
          fromUnitId: fromUnit.id,
          toUnitId: toUnit.id,
          effectiveDate,
          priceBefore,
          priceAfter,
          discountPctBefore:
            discountPctBefore != null
              ? new Prisma.Decimal(discountPctBefore).toDecimalPlaces(2)
              : null,
          discountPctAfter:
            discountPctAfter != null
              ? new Prisma.Decimal(discountPctAfter).toDecimalPlaces(2)
              : null,
          approvalReRequired,
          reason: input.reason?.trim() || null,
          note: input.note?.trim() || null,
          recordedById: recordedById ?? null,
        },
      });

      return {
        sale: updatedSale,
        transfer,
        payments,
        /** False when the approval was cleared, or when there was never one to carry. */
        approvalCarried: approvalAfter,
        /** False when the old unit was left alone because this sale was not holding it. */
        fromUnitReleased: wasReserved,
      };
    });
  }

  // ─────── Internal ───────

  /**
   * Rebase the schedule onto the new price. REBASE, not recreate: the rows carry
   * paidAmount, milestone links and sequence, and destroying them to build the same
   * schedule again would throw away the record of what the buyer has actually paid.
   *
   * Milestone links survive untouched on purpose — milestones are project-level and both
   * units live in the same project, so "40% on foundation complete" still points at the
   * foundation.
   *
   * Three outcomes per installment:
   *   - a percentage installment with nothing collected  → its amount moves;
   *   - a percentage installment with money against it   → FLAGGED, never restated;
   *   - a flat installment                               → untouched. A figure someone
   *     agreed in dollars is not a derivative of the price, and re-deriving one would
   *     invent a number nobody signed.
   */
  private async rebasePayments(
    tx: Prisma.TransactionClient,
    saleId: string,
    priceBefore: Prisma.Decimal | null,
    priceAfter: Prisma.Decimal | null,
  ) {
    const rows = await tx.salePayment.findMany({
      where: { saleId },
      orderBy: { sequence: 'asc' },
    });

    const rebased: Array<{
      id: string;
      label: string;
      percentOfPrice: number;
      amountBefore: number;
      amountAfter: number;
    }> = [];
    const flagged: Array<{
      id: string;
      label: string;
      status: string;
      amount: number;
      paidAmount: number;
      wouldHaveBeen: number;
      reviewReason: string;
    }> = [];
    let unchanged = 0;

    for (const p of rows) {
      if (p.percentOfPrice == null || priceAfter == null) {
        unchanged++;
        continue;
      }
      const current = new Prisma.Decimal(p.amount).toDecimalPlaces(2);
      const next = priceAfter.mul(p.percentOfPrice).div(100).toDecimalPlaces(2);
      if (next.equals(current)) {
        unchanged++;
        continue;
      }

      const collected = new Prisma.Decimal(p.paidAmount);
      if (collected.greaterThan(0)) {
        // FLAG, never restate. paidAmount is the record of what the buyer actually
        // handed over, against this figure. Moving the figure would erase the very
        // over- or under-collection a human now has to resolve — the same reasoning as
        // LeaseRentInvoice.needsReview (R22), on a new surface.
        const priceNote =
          priceBefore != null
            ? ` and its price moved from ${priceBefore.toFixed(2)} to ${priceAfter.toFixed(2)}`
            : ` onto a price of ${priceAfter.toFixed(2)}`;
        const reviewReason =
          `Collected ${collected.toFixed(2)} against an installment billed at ` +
          `${current.toFixed(2)}. This sale then moved unit${priceNote}; at ` +
          `${Number(p.percentOfPrice)}% of the new price the installment would be ` +
          `${next.toFixed(2)}, leaving the buyer ` +
          `${collected.greaterThan(next) ? 'over' : 'under'}-collected by ` +
          `${collected.minus(next).abs().toFixed(2)}. The billed amount has been left as it ` +
          `was — decide whether to collect the difference, credit it, or leave it.`;
        await tx.salePayment.update({
          where: { id: p.id },
          data: { needsReview: true, reviewReason },
        });
        flagged.push({
          id: p.id,
          label: p.label,
          status: p.status,
          amount: current.toNumber(),
          paidAmount: collected.toNumber(),
          wouldHaveBeen: next.toNumber(),
          reviewReason,
        });
        continue;
      }

      // Nothing collected — but WAIVED and CANCELLED rows are still left alone. A waiver
      // is a concession Prime already granted at the old price, and a cancelled row is
      // scaffolding from a dead schedule; restating either would put a number nobody
      // agreed to into the concessions report.
      if (!REBASABLE_STATUSES.includes(p.status)) {
        unchanged++;
        continue;
      }

      await tx.salePayment.update({ where: { id: p.id }, data: { amount: next } });
      rebased.push({
        id: p.id,
        label: p.label,
        percentOfPrice: Number(p.percentOfPrice),
        amountBefore: current.toNumber(),
        amountAfter: next.toNumber(),
      });
    }

    return { rebased, flagged, unchanged };
  }

  /**
   * Refuse a target unit somebody else already has a claim on, and NAME the claim — a
   * bare "unit unavailable" makes the user go hunting for which of three things is in
   * the way.
   */
  private async assertTargetIsFree(
    toUnit: { id: string; unitNumber: string; status: UnitStatus },
    saleId: string,
  ) {
    // A live tenancy first: it is the most specific answer, and the unit's status alone
    // (LEASED vs OCCUPIED vs AVAILABLE on a lease not yet started) does not tell the
    // whole story.
    const lease = await this.prisma.lease.findFirst({
      where: {
        unitId: toUnit.id,
        deletedAt: null,
        terminationDate: null,
        status: { notIn: ['EXPIRED', 'TERMINATED'] },
      },
      select: { tenantName: true },
    });
    if (lease) {
      throw new BadRequestException(
        `Unit ${toUnit.unitNumber} is under a live tenancy (${lease.tenantName}). A sale ` +
          `cannot be transferred onto an occupied unit — end or reassign the tenancy first.`,
      );
    }

    const other = await this.prisma.sale.findFirst({
      where: {
        unitId: toUnit.id,
        deletedAt: null,
        id: { not: saleId },
        status: { in: HOLDING_SALE_STATUSES },
      },
      select: { buyer: true, status: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (other) {
      throw new BadRequestException(
        `Unit ${toUnit.unitNumber} is already committed to another buyer` +
          `${other.buyer ? ` (${other.buyer})` : ''} — that sale is ${other.status}. Cancel ` +
          `or move that sale before transferring this one onto the unit.`,
      );
    }

    // Status last: by here nothing explains the hold, so the unit's own state is the
    // answer — e.g. a unit marked SOLD by hand with no sale row behind it.
    const held = HELD_STATUS_REASON[toUnit.status];
    if (held) {
      throw new BadRequestException(
        `Unit ${toUnit.unitNumber} ${held} (status ${toUnit.status}), so a sale cannot be ` +
          `transferred onto it. Release the unit first.`,
      );
    }
  }

  private parseEffectiveDate(value: string | Date | undefined): Date {
    if (value == null || value === '') return startOfUtcDay(new Date());
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('The transfer effective date is not a valid date');
    }
    return startOfUtcDay(d);
  }

  /** Enough of the sale to identify it in a refusal without opening the record. */
  private describe(sale: { id: string; buyer?: string | null; unit?: { unitNumber: string } | null }) {
    const unit = sale.unit?.unitNumber ? `unit ${sale.unit.unitNumber}` : null;
    if (unit && sale.buyer) return `The sale of ${unit} to ${sale.buyer}`;
    if (unit) return `The sale of ${unit}`;
    if (sale.buyer) return `The sale to ${sale.buyer}`;
    return `Sale ${sale.id}`;
  }
}
