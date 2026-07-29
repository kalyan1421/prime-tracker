import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';

/**
 * Lease obligation ledger — an agreed total paid down by discrete payments.
 *
 * Two real-world things share this shape, so they share one service:
 *   - SECURITY_DEPOSIT: tenant → Prime  (direction FROM_TENANT)
 *   - TI_ALLOWANCE:     Prime → tenant  (direction TO_TENANT)
 * TI is a FIXED AGREED AMOUNT — never a percentage of rent, sqft or anything
 * else. It is simply disbursed in phases, i.e. several payment rows against one
 * obligation. There is deliberately no percentage-basis derivation anywhere here.
 *
 * Invariants:
 *   - ONE deposit per lease, at whatever level the lease sits at (a lease is
 *     polymorphic: unitId XOR buildingId). A building-level deposit is NEVER
 *     split across that building's units — the rollup shows it separately.
 *   - `paidAmount` is a MIRROR of sum(payments.amount). It is recomputed from
 *     the payment rows on every mutation, never incremented, so it cannot drift.
 *     Same discipline as BudgetLine.revisedAmt mirroring BudgetRevision.
 *   - `status` is DERIVED from (paidAmount vs totalAmount) and is never accepted
 *     from a caller. WAIVED is the single exception — set only via waive().
 *
 * Overpayment policy (deliberate): an overpayment is ALLOWED and lands on
 * SETTLED. Deposits genuinely get over- and under-paid in the field (rounded
 * wires, bundled first-month-plus-deposit cheques, FX). Rejecting the payment
 * would leave the user with money in the bank they cannot record anywhere,
 * which is worse than a ledger that shows pending as a negative number.
 * `pending = totalAmount - paidAmount`, so an overpaid obligation reports a
 * negative pending — that is the signal Finance needs to refund the difference.
 *
 * Money is handled with Prisma.Decimal throughout. Prisma Decimals are Decimal.js
 * objects that stringify, so a naive `a + b` string-concatenates — every sum and
 * comparison below goes through Decimal methods.
 */

export const OBLIGATION_KINDS = ['SECURITY_DEPOSIT', 'TI_ALLOWANCE', 'OTHER'] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

export const OBLIGATION_DIRECTIONS = ['FROM_TENANT', 'TO_TENANT'] as const;
export type ObligationDirection = (typeof OBLIGATION_DIRECTIONS)[number];

export const OBLIGATION_STATUSES = ['PENDING', 'PARTIAL', 'SETTLED', 'WAIVED'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

/** The direction each kind is locked to. OTHER is free-form, so it must be stated. */
const REQUIRED_DIRECTION: Record<string, ObligationDirection | null> = {
  SECURITY_DEPOSIT: 'FROM_TENANT',
  TI_ALLOWANCE: 'TO_TENANT',
  OTHER: null,
};

export interface CreateObligationInput {
  leaseId: string;
  kind: ObligationKind | string;
  /** Optional for SECURITY_DEPOSIT / TI_ALLOWANCE (implied); required for OTHER. */
  direction?: ObligationDirection | string;
  totalAmount: number | string | Prisma.Decimal;
  dueDate?: string | Date | null;
  notes?: string | null;
}

export interface UpdateObligationInput {
  /** Present only so a caller that round-trips the row gets a clear error. */
  kind?: string;
  totalAmount?: number | string | Prisma.Decimal;
  dueDate?: string | Date | null;
  notes?: string | null;
}

export interface RecordPaymentInput {
  amount: number | string | Prisma.Decimal;
  paidAt?: string | Date;
  method?: string | null;
  reference?: string | null;
  documentId?: string | null;
  notes?: string | null;
  recordedById?: string | null;
}

interface Totals {
  totalAgreed: number;
  totalPaid: number;
  totalPending: number;
}

@Injectable()
export class LeaseObligationService {
  private readonly logger = new Logger(LeaseObligationService.name);

  // EventBusModule is @Global(), so EventBus injects here without leases.module
  // importing anything — same as LeasesService.
  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
  ) {}

  // ─────── Reads ───────

  /** Obligations on a lease, each with its payments (newest payment first). */
  async findByLease(leaseId: string) {
    return this.prisma.leaseObligation.findMany({
      where: { leaseId },
      orderBy: { createdAt: 'asc' },
      include: {
        payments: {
          orderBy: { paidAt: 'desc' },
          include: { recordedBy: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  async findById(id: string) {
    const obligation = await this.prisma.leaseObligation.findUnique({
      where: { id },
      include: { payments: { orderBy: { paidAt: 'desc' } } },
    });
    if (!obligation) throw new NotFoundException('Lease obligation not found');
    return obligation;
  }

  // ─────── Create / Update ───────

  async create(input: CreateObligationInput) {
    const kind = this.assertKind(input.kind);
    const direction = this.resolveDirection(kind, input.direction);
    const totalAmount = this.toPositiveDecimal(input.totalAmount, 'Obligation total');

    const lease = await this.prisma.lease.findFirst({
      where: { id: input.leaseId, deletedAt: null },
      select: { id: true },
    });
    if (!lease) throw new NotFoundException('Lease not found');

    // One deposit per lease, at whatever level the lease sits at. A building-level
    // lease has exactly one deposit; it is never split across the building's units.
    if (kind === 'SECURITY_DEPOSIT') {
      const existing = await this.prisma.leaseObligation.findFirst({
        where: { leaseId: input.leaseId, kind: 'SECURITY_DEPOSIT' },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException(
          'This lease already has a security deposit. A lease carries one deposit at its own level — edit the existing one instead.',
        );
      }
    }

    return this.prisma.leaseObligation.create({
      data: {
        leaseId: input.leaseId,
        kind,
        direction,
        totalAmount,
        dueDate: this.toDate(input.dueDate),
        notes: input.notes ?? null,
        // status/paidAmount are derived — a brand-new obligation has no payments.
        status: 'PENDING',
        paidAmount: new Prisma.Decimal(0),
      },
    });
  }

  /**
   * Edit an obligation. `kind` is immutable — a deposit that turns out to be a TI
   * allowance is a different agreement, and silently switching it would move money
   * between two ledgers that are reported separately.
   */
  async update(id: string, input: UpdateObligationInput) {
    const obligation = await this.findById(id);
    if (input.kind !== undefined && input.kind !== obligation.kind) {
      throw new BadRequestException('Obligation kind cannot be changed; delete and re-create instead');
    }

    const data: Prisma.LeaseObligationUncheckedUpdateInput = {};
    if (input.dueDate !== undefined) data.dueDate = this.toDate(input.dueDate);
    if (input.notes !== undefined) data.notes = input.notes;

    if (input.totalAmount !== undefined) {
      const total = this.toPositiveDecimal(input.totalAmount, 'Obligation total');
      data.totalAmount = total;
      // Changing the agreed total can move the obligation across a status boundary
      // (e.g. raising a settled deposit makes it PARTIAL again). WAIVED is sticky.
      if (obligation.status !== 'WAIVED') {
        data.status = this.deriveStatus(total, new Prisma.Decimal(obligation.paidAmount));
      }
    }

    return this.prisma.leaseObligation.update({ where: { id }, data });
  }

  /** Removing an obligation cascades its payments (FK onDelete: Cascade). */
  async remove(id: string) {
    await this.findById(id);
    return this.prisma.leaseObligation.delete({ where: { id } });
  }

  /**
   * Forgive the obligation (deposit waived in negotiation, TI dropped from the deal).
   * The one status a caller sets explicitly. Payments already recorded are kept —
   * paidAmount stays truthful — only the status changes.
   */
  async waive(id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('A reason is required to waive an obligation');
    const obligation = await this.findById(id);
    if (obligation.status === 'WAIVED') throw new BadRequestException('Obligation is already waived');

    const stamp = `Waived: ${reason.trim()}`;
    return this.prisma.leaseObligation.update({
      where: { id },
      data: {
        status: 'WAIVED',
        notes: obligation.notes ? `${obligation.notes}\n${stamp}` : stamp,
      },
    });
  }

  // ─────── Payments ───────

  /**
   * Record a payment against an obligation, then recompute the mirror + status
   * inside the same transaction. Overpayment is allowed (see class doc).
   *
   * A payment against a TI_ALLOWANCE is a disbursement of Prime's money to the
   * tenant, so it raises `lease.tiDisbursed` for Finance/Accounting. A deposit
   * payment is money coming IN and raises nothing here.
   */
  async recordPayment(obligationId: string, input: RecordPaymentInput) {
    const amount = this.toPositiveDecimal(input.amount, 'Payment amount');

    // The TI context is carried OUT of the transaction rather than emitted inside
    // it: a notification must never go out for a payment that then rolls back.
    const { payment, obligation, ti } = await this.prisma.$transaction(async (tx) => {
      const current = await tx.leaseObligation.findUnique({ where: { id: obligationId } });
      if (!current) throw new NotFoundException('Lease obligation not found');
      if (current.status === 'WAIVED') {
        throw new BadRequestException('This obligation is waived; un-waive it before recording a payment');
      }

      const created = await tx.leaseObligationPayment.create({
        data: {
          obligationId,
          amount,
          paidAt: this.toDate(input.paidAt) ?? new Date(),
          method: input.method ?? null,
          reference: input.reference ?? null,
          documentId: input.documentId ?? null,
          notes: input.notes ?? null,
          recordedById: input.recordedById ?? null,
        },
      });

      const updated = await this.syncMirror(tx, obligationId);
      return {
        payment: created,
        obligation: updated,
        // recordPayment never touches totalAmount, so the pre-write value is current.
        ti:
          current.kind === 'TI_ALLOWANCE'
            ? { leaseId: current.leaseId, totalAmount: new Prisma.Decimal(current.totalAmount) }
            : null,
      };
    });

    if (ti) {
      await this.emitTiDisbursed(ti.leaseId, amount, ti.totalAmount, new Prisma.Decimal(obligation.paidAmount));
    }

    return { payment, obligation };
  }

  /**
   * Delete a payment (mis-keyed amount, bounced cheque) and re-derive the mirror.
   * Because paidAmount is recomputed from the surviving rows rather than
   * decremented, deleting a payment from the middle of the history is safe.
   */
  async deletePayment(paymentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.leaseObligationPayment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('Payment not found');

      await tx.leaseObligationPayment.delete({ where: { id: paymentId } });
      return this.syncMirror(tx, payment.obligationId);
    });
  }

  // ─────── Rollups ───────

  /**
   * Obligations on leases attached DIRECTLY to this unit. A building-level lease
   * covering the unit is intentionally excluded — its deposit belongs to the
   * building and is never apportioned down.
   */
  async summaryForUnit(unitId: string) {
    const rows = await this.prisma.leaseObligation.findMany({
      where: { lease: { unitId, deletedAt: null } },
      include: { lease: { select: { id: true, tenantName: true, status: true } } },
    });
    return { unitId, ...this.aggregate(rows), byKind: this.byKind(rows), obligations: rows };
  }

  /**
   * Building rollup, deliberately kept in two buckets:
   *   - buildingLevel: obligations on leases attached to the building itself
   *   - unitLevel:     obligations on leases attached to units inside it
   * `combined` adds the two (each obligation counted exactly once) — a
   * building-level deposit is NEVER pushed down into the unit totals.
   */
  async summaryForBuilding(buildingId: string) {
    const rows = await this.prisma.leaseObligation.findMany({
      where: {
        lease: {
          deletedAt: null,
          OR: [{ buildingId }, { unit: { buildingId } }],
        },
      },
      include: {
        lease: {
          select: {
            id: true,
            unitId: true,
            buildingId: true,
            tenantName: true,
            unit: { select: { id: true, unitNumber: true } },
          },
        },
      },
    });

    const buildingRows = rows.filter((r) => r.lease.buildingId != null);
    const unitRows = rows.filter((r) => r.lease.buildingId == null && r.lease.unitId != null);

    const byUnit = new Map<string, typeof unitRows>();
    for (const row of unitRows) {
      const key = row.lease.unitId as string;
      const bucket = byUnit.get(key) ?? [];
      bucket.push(row);
      byUnit.set(key, bucket);
    }

    return {
      buildingId,
      buildingLevel: {
        ...this.aggregate(buildingRows),
        byKind: this.byKind(buildingRows),
        obligations: buildingRows,
      },
      unitLevel: {
        ...this.aggregate(unitRows),
        byKind: this.byKind(unitRows),
        units: [...byUnit.entries()].map(([id, rowsForUnit]) => ({
          unitId: id,
          unitNumber: rowsForUnit[0].lease.unit?.unitNumber ?? null,
          ...this.aggregate(rowsForUnit),
          byKind: this.byKind(rowsForUnit),
        })),
      },
      // Sum of both buckets — every obligation appears in exactly one of them.
      combined: { ...this.aggregate(rows), byKind: this.byKind(rows) },
    };
  }

  // ─────── Internals ───────

  /**
   * Announce a TI disbursement. Runs AFTER the payment transaction has committed.
   *
   * Notification routing is project-scoped, and a lease is polymorphic (unit XOR
   * building), so the project is resolved through whichever side is set. If it
   * cannot be resolved we skip the emit entirely — a `lease.tiDisbursed` with a
   * bogus projectId would route the notification to the wrong people, which is
   * worse than not sending it. Likewise, anything that goes wrong here is logged
   * and swallowed: the money is already recorded and must not be un-recorded by
   * a failure in the telling.
   */
  private async emitTiDisbursed(
    leaseId: string,
    amount: Prisma.Decimal,
    totalAmount: Prisma.Decimal,
    paidAmount: Prisma.Decimal,
  ) {
    try {
      const lease = await this.prisma.lease.findUnique({
        where: { id: leaseId },
        select: {
          building: { select: { projectId: true } },
          unit: { select: { building: { select: { projectId: true } } } },
        },
      });
      const projectId = lease?.building?.projectId ?? lease?.unit?.building?.projectId ?? null;
      if (!projectId) {
        this.logger.warn(`Skipping lease.tiDisbursed for lease ${leaseId}: project could not be resolved`);
        return;
      }

      this.bus.emit({
        type: 'lease.tiDisbursed',
        leaseId,
        projectId,
        amount: this.num(amount),
        // Decimal.minus — raw `-`/`+` on Prisma Decimals is the repo's known bug class.
        // Mirrors the ledger's pending rule, so an over-disbursed TI reports negative.
        pending: this.num(totalAmount.minus(paidAmount)),
      });
    } catch (err) {
      this.logger.error(`Failed to emit lease.tiDisbursed for lease ${leaseId}`, err as Error);
    }
  }

  /**
   * Recompute paidAmount from the payment rows (never increment) and re-derive
   * status. Must run inside the same transaction as the mutation that triggered it.
   */
  private async syncMirror(tx: Prisma.TransactionClient, obligationId: string) {
    const obligation = await tx.leaseObligation.findUnique({ where: { id: obligationId } });
    if (!obligation) throw new NotFoundException('Lease obligation not found');

    const payments = await tx.leaseObligationPayment.findMany({
      where: { obligationId },
      select: { amount: true },
    });
    // Decimal.plus — a naive `a + b` on two Prisma Decimals concatenates strings.
    const paid = payments.reduce(
      (sum, p) => sum.plus(new Prisma.Decimal(p.amount)),
      new Prisma.Decimal(0),
    );

    // A waived obligation keeps its status; only the money mirror stays truthful.
    const status =
      obligation.status === 'WAIVED'
        ? 'WAIVED'
        : this.deriveStatus(new Prisma.Decimal(obligation.totalAmount), paid);

    return tx.leaseObligation.update({
      where: { id: obligationId },
      data: { paidAmount: paid, status },
    });
  }

  /** The only place status is computed. Callers never supply it. */
  private deriveStatus(total: Prisma.Decimal, paid: Prisma.Decimal): ObligationStatus {
    if (paid.lessThanOrEqualTo(0)) return 'PENDING';
    if (paid.greaterThanOrEqualTo(total)) return 'SETTLED';
    return 'PARTIAL';
  }

  private aggregate(rows: Array<{ totalAmount: Prisma.Decimal | number | string; paidAmount: Prisma.Decimal | number | string; status: string }>): Totals {
    let agreed = new Prisma.Decimal(0);
    let paid = new Prisma.Decimal(0);
    for (const row of rows) {
      // A waived obligation is no longer owed, so it drops out of the agreed total;
      // anything actually paid against it still counts as money that moved.
      if (row.status !== 'WAIVED') agreed = agreed.plus(new Prisma.Decimal(row.totalAmount));
      paid = paid.plus(new Prisma.Decimal(row.paidAmount));
    }
    return {
      totalAgreed: this.num(agreed),
      totalPaid: this.num(paid),
      totalPending: this.num(agreed.minus(paid)),
    };
  }

  private byKind(rows: Array<{ kind: string; totalAmount: Prisma.Decimal | number | string; paidAmount: Prisma.Decimal | number | string; status: string }>) {
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = groups.get(row.kind) ?? [];
      bucket.push(row);
      groups.set(row.kind, bucket);
    }
    return [...groups.entries()].map(([kind, rowsForKind]) => ({
      kind,
      count: rowsForKind.length,
      ...this.aggregate(rowsForKind),
    }));
  }

  private num(d: Prisma.Decimal): number {
    return Number(d.toFixed(2));
  }

  private assertKind(kind: string): ObligationKind {
    if (!(OBLIGATION_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`Invalid obligation kind: ${kind}`);
    }
    return kind as ObligationKind;
  }

  /**
   * A deposit only ever flows tenant→Prime and a TI allowance only ever flows
   * Prime→tenant. An inverted pair means the caller mis-labelled the money, so
   * reject rather than silently correcting it.
   */
  private resolveDirection(kind: ObligationKind, direction?: string): ObligationDirection {
    const required = REQUIRED_DIRECTION[kind];
    if (direction === undefined || direction === null) {
      if (required) return required;
      throw new BadRequestException(`direction is required for ${kind} obligations`);
    }
    if (!(OBLIGATION_DIRECTIONS as readonly string[]).includes(direction)) {
      throw new BadRequestException(`Invalid obligation direction: ${direction}`);
    }
    if (required && direction !== required) {
      throw new BadRequestException(`${kind} must be ${required}, not ${direction}`);
    }
    return direction as ObligationDirection;
  }

  private toPositiveDecimal(value: number | string | Prisma.Decimal, label: string): Prisma.Decimal {
    let dec: Prisma.Decimal;
    try {
      dec = new Prisma.Decimal(value as Prisma.Decimal.Value);
    } catch {
      throw new BadRequestException(`${label} must be a number`);
    }
    if (!dec.isFinite() || dec.lessThanOrEqualTo(0)) {
      throw new BadRequestException(`${label} must be greater than zero`);
    }
    return dec;
  }

  private toDate(value?: string | Date | null): Date | null {
    if (value === undefined || value === null) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid date');
    return date;
  }
}
