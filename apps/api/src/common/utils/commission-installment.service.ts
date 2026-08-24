import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Exactly one of these is set — mirrors the Lease/Sale polymorphic convention. */
export interface CommissionTarget {
  leaseId?: string | null;
  saleId?: string | null;
}

function whereForTarget(target: CommissionTarget) {
  return target.leaseId ? { leaseId: target.leaseId } : { saleId: target.saleId! };
}

/**
 * Broker commission paid in installments (R7). Depends only on PrismaService, so — same
 * reasoning as UnitStatusEventService — it is provided directly in BrokersModule,
 * LeasesModule and SalesModule rather than through a shared import, which would close a
 * cycle (SalesModule already imports LeasesModule).
 */
@Injectable()
export class CommissionInstallmentService {
  constructor(private prisma: PrismaService) {}

  list(target: CommissionTarget, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    return tx.commissionInstallment.findMany({
      where: whereForTarget(target),
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async add(
    target: CommissionTarget,
    input: { brokerId: string; amount: number; paidAt?: Date | null; notes?: string; sequence?: number },
  ) {
    if (!target.leaseId && !target.saleId) {
      throw new NotFoundException('Commission installment needs a lease or a sale');
    }
    const nextSequence =
      input.sequence ??
      (await this.prisma.commissionInstallment.count({ where: whereForTarget(target) })) + 1;
    return this.prisma.commissionInstallment.create({
      data: {
        ...target,
        brokerId: input.brokerId,
        sequence: nextSequence,
        amount: input.amount,
        paidAt: input.paidAt ?? null,
        notes: input.notes ?? null,
      },
    });
  }

  async markPaid(id: string, paidAt?: Date) {
    const row = await this.prisma.commissionInstallment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Commission installment not found');
    return this.prisma.commissionInstallment.update({
      where: { id },
      data: { paidAt: paidAt ?? new Date() },
    });
  }

  async remove(id: string) {
    const row = await this.prisma.commissionInstallment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Commission installment not found');
    return this.prisma.commissionInstallment.delete({ where: { id } });
  }

  /**
   * Settle everything outstanding on a lease/sale in one action — what the existing
   * "mark commission paid" button now does. Previously that button flipped a single
   * boolean; now it pays off every unpaid installment, which is a more honest reading of
   * the same gesture ("we've paid this broker what we owe them on this deal") and keeps
   * BrokersController's markCommissionPaid / markLeaseCommissionPaid endpoints meaningful
   * without forcing a UI rewrite to land alongside this schema change.
   */
  async settleAll(target: CommissionTarget, paidAt?: Date) {
    await this.prisma.commissionInstallment.updateMany({
      where: { ...whereForTarget(target), paidAt: null },
      data: { paidAt: paidAt ?? new Date() },
    });
  }

  /**
   * Called whenever LeasesService/SalesService (re)stamps brokerCommissionAmt. Deliberately
   * NOT part of the caller's write transaction — mirrors generateSchedule's "recoverable,
   * must not cost the user the lease/sale they already entered" pattern. Idempotent.
   *
   * - No installments yet → create #1 for the full amount, unpaid.
   * - Exactly one installment and it is UNPAID → adjust its amount to match. Safe: nothing
   *   has been paid out yet, so there is nothing to silently overwrite.
   * - Any installment already PAID, or more than one exists → leave them alone. The
   *   stamped total and the installment sum can now disagree; that is surfaced by the
   *   broker report rather than resolved here by rewriting money that already moved.
   * - amount is null (commission cleared) or there's no broker → do nothing. Existing
   *   installments are a historical record of money that may already have been paid; a
   *   cleared commission does not erase what actually happened.
   */
  async syncStampedAmount(target: CommissionTarget, brokerId: string | null | undefined, amount: number | null | undefined) {
    if (!brokerId || amount == null) return;
    const existing = await this.list(target);
    if (existing.length === 0) {
      await this.add(target, { brokerId, amount, sequence: 1 });
      return;
    }
    if (existing.length === 1 && existing[0].paidAt == null && existing[0].brokerId === brokerId) {
      await this.prisma.commissionInstallment.update({
        where: { id: existing[0].id },
        data: { amount },
      });
    }
  }
}
