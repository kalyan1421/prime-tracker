import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SalePaymentTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';

/**
 * Sale Payment Schedule — milestone-linked installments on a Sale.
 *
 * Owns:
 *   - The installment schedule under a sale (CRUD + templates).
 *   - Partial-payment logging (paidAmount vs amount → PARTIALLY_PAID / PAID).
 *   - Milestone-completion automation: stamps effectiveDueDate + flips SCHEDULED→DUE.
 *   - Interior-handover automation: flips the ON_HANDOVER (TI) installment to DUE.
 *   - The Finance "upcoming receivables" view (feeds the cashflow forecast).
 *
 * Symmetric with DrawSchedule (the outflow side); see SALE_PAYMENT_SCHEDULE_DESIGN.md.
 */
@Injectable()
export class SalePaymentsService {
  constructor(private prisma: PrismaService, private bus: EventBus) {}

  // ─────── Reads ───────

  async listForSale(saleId: string) {
    return this.prisma.salePayment.findMany({
      where: { saleId },
      orderBy: { sequence: 'asc' },
      include: { milestone: { select: { id: true, title: true, status: true, dueDate: true } } },
    });
  }

  /**
   * Upcoming + overdue receivables within `weeks` weeks. Drives the Finance
   * "receivables next 2/4 weeks" widget and the cashflow inflows.
   */
  async receivables(weeks = 4) {
    const horizon = new Date(Date.now() + weeks * 7 * 86_400_000);
    const rows = await this.prisma.salePayment.findMany({
      where: { status: { in: ['SCHEDULED', 'DUE', 'PARTIALLY_PAID', 'OVERDUE'] } },
      include: { sale: { select: { id: true, buyer: true, projectId: true } } },
    });
    return rows
      .map((p) => ({ ...p, due: p.effectiveDueDate ?? p.dueDate }))
      .filter((p) => p.due != null && p.due <= horizon)
      .sort((a, b) => (a.due!.getTime() - b.due!.getTime()))
      .map((p) => ({
        id: p.id,
        saleId: p.saleId,
        buyer: p.sale.buyer,
        projectId: p.sale.projectId,
        label: p.label,
        due: p.due,
        amount: Number(p.amount),
        paidAmount: Number(p.paidAmount),
        outstanding: Number(p.amount) - Number(p.paidAmount),
        status: p.status,
      }));
  }

  // ─────── Create / Update / Delete ───────

  async addPayment(
    saleId: string,
    input: {
      label: string;
      amount?: number;
      percentOfPrice?: number;
      trigger?: SalePaymentTrigger;
      dueDate?: string;
      milestoneId?: string;
      interiorProjectId?: string;
      sequence?: number;
      notes?: string;
    },
  ) {
    const sale = await this.getSale(saleId);
    const trigger = input.trigger ?? 'FIXED_DATE';

    // A milestone-triggered payment needs a milestone; a fixed-date one needs a date.
    if (trigger === 'ON_MILESTONE' && !input.milestoneId) {
      throw new BadRequestException('ON_MILESTONE payments require a milestoneId');
    }
    if (trigger === 'FIXED_DATE' && !input.dueDate) {
      throw new BadRequestException('FIXED_DATE payments require a dueDate');
    }

    const amount = this.resolveAmount(input.amount, input.percentOfPrice, sale.salePrice);
    const sequence = input.sequence ?? (await this.nextSequence(saleId));

    return this.prisma.salePayment.create({
      data: {
        saleId,
        label: input.label,
        sequence,
        trigger,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        milestoneId: input.milestoneId ?? null,
        amount,
        percentOfPrice: input.percentOfPrice ?? null,
        interiorProjectId: input.interiorProjectId ?? null,
        notes: input.notes,
      },
    });
  }

  /**
   * Seed a schedule from one of Prime's standard templates. Percentages are
   * applied to the sale's salePrice. (Confirm Prime's real templates — D15.)
   */
  async applyTemplate(saleId: string, templateKey: keyof typeof PAYMENT_TEMPLATES) {
    const sale = await this.getSale(saleId);
    const template = PAYMENT_TEMPLATES[templateKey];
    if (!template) throw new BadRequestException(`Unknown payment template: ${templateKey}`);

    const existing = await this.prisma.salePayment.count({ where: { saleId } });
    if (existing > 0) {
      throw new BadRequestException('Sale already has a payment schedule; clear it before applying a template');
    }

    return this.prisma.$transaction(
      template.map((row, i) =>
        this.prisma.salePayment.create({
          data: {
            saleId,
            label: row.label,
            sequence: i,
            trigger: row.trigger,
            percentOfPrice: row.percentOfPrice,
            amount: this.resolveAmount(undefined, row.percentOfPrice, sale.salePrice),
          },
        }),
      ),
    );
  }

  async updatePayment(
    id: string,
    input: { label?: string; amount?: number; dueDate?: string; milestoneId?: string; sequence?: number; notes?: string },
  ) {
    const payment = await this.getPayment(id);
    if (input.amount != null) {
      if (!(input.amount > 0)) throw new BadRequestException('Installment amount must be positive');
      if (new Prisma.Decimal(input.amount).lessThan(payment.paidAmount)) {
        throw new BadRequestException('Installment amount cannot be lower than the amount already paid');
      }
    }
    const data: Prisma.SalePaymentUpdateInput = {
      label: input.label,
      amount: input.amount,
      sequence: input.sequence,
      notes: input.notes,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
    };
    if (input.milestoneId !== undefined) {
      data.milestone = input.milestoneId ? { connect: { id: input.milestoneId } } : { disconnect: true };
    }
    return this.prisma.salePayment.update({ where: { id }, data });
  }

  async removePayment(id: string) {
    await this.getPayment(id);
    return this.prisma.salePayment.delete({ where: { id } });
  }

  // ─────── Payment logging (partial-aware) ───────

  async logPayment(id: string, payAmount: number) {
    if (!(payAmount > 0)) throw new BadRequestException('Payment amount must be positive');

    // Money math is done in Prisma.Decimal (not JS floats), inside a transaction with
    // optimistic concurrency, so two concurrent logs can't lose an update or overpay.
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.salePayment.findUnique({ where: { id } });
      if (!payment) throw new NotFoundException('Sale payment not found');
      if (payment.status === 'PAID' || payment.status === 'WAIVED') {
        throw new BadRequestException('This installment is already settled');
      }

      const total = new Prisma.Decimal(payment.amount);
      const newPaid = new Prisma.Decimal(payment.paidAmount).plus(payAmount);
      if (newPaid.greaterThan(total)) {
        throw new BadRequestException(
          `Payment exceeds the outstanding balance (${total.minus(payment.paidAmount).toString()})`,
        );
      }
      const fullyPaid = newPaid.greaterThanOrEqualTo(total);

      // Guard on the paidAmount we read: if another payment landed first, count=0 → retry.
      const res = await tx.salePayment.updateMany({
        where: { id, paidAmount: payment.paidAmount },
        data: {
          paidAmount: newPaid,
          status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID',
          paidAt: fullyPaid ? new Date() : null,
        },
      });
      if (res.count === 0) {
        throw new ConflictException('Payment was updated concurrently — please retry');
      }
      return tx.salePayment.findUnique({ where: { id } });
    });

    this.bus.emit({ type: 'salePayment.paid', salePaymentId: id, saleId: result!.saleId, amount: payAmount });
    return result;
  }

  // ─────── Automation (called by event handlers) ───────

  /**
   * When a milestone completes, stamp effectiveDueDate and flip SCHEDULED→DUE for
   * every ON_MILESTONE installment linked to it. This is the "installments linked
   * to construction milestones" behavior the client asked for. Idempotent.
   */
  async applyMilestoneCompletion(milestoneId: string, completedAt: Date) {
    const payments = await this.prisma.salePayment.findMany({
      where: { milestoneId, trigger: 'ON_MILESTONE', status: 'SCHEDULED' },
      select: { id: true, saleId: true },
    });
    for (const p of payments) {
      await this.prisma.salePayment.update({
        where: { id: p.id },
        data: { effectiveDueDate: completedAt, status: 'DUE' },
      });
      this.bus.emit({ type: 'salePayment.due', salePaymentId: p.id, saleId: p.saleId });
    }
    return payments.length;
  }

  /** When an interior project hands over, flip its TI (ON_HANDOVER) installment to DUE. */
  async applyInteriorHandover(interiorProjectId: string, at: Date) {
    const payments = await this.prisma.salePayment.findMany({
      where: { interiorProjectId, trigger: 'ON_HANDOVER', status: 'SCHEDULED' },
      select: { id: true, saleId: true },
    });
    for (const p of payments) {
      await this.prisma.salePayment.update({
        where: { id: p.id },
        data: { effectiveDueDate: at, status: 'DUE' },
      });
      this.bus.emit({ type: 'salePayment.due', salePaymentId: p.id, saleId: p.saleId });
    }
    return payments.length;
  }

  /**
   * A fit-out was cancelled before handover, so its TI installment no longer has a
   * trigger to be due. Revert UNPAID installments (DUE/OVERDUE, nothing collected)
   * back to SCHEDULED. Installments with money against them (PARTIALLY_PAID / PAID /
   * WAIVED) are left untouched — unwinding collected money is a separate refund concern.
   */
  async applyInteriorCancelled(interiorProjectId: string) {
    const reverted = await this.prisma.salePayment.updateMany({
      where: {
        interiorProjectId,
        trigger: 'ON_HANDOVER',
        status: { in: ['DUE', 'OVERDUE'] },
        paidAmount: 0,
      },
      data: { status: 'SCHEDULED', effectiveDueDate: null },
    });
    return reverted.count;
  }

  // ─────── Internal ───────

  private async getSale(saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, deletedAt: null },
      select: { id: true, salePrice: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  private async getPayment(id: string) {
    const payment = await this.prisma.salePayment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Sale payment not found');
    return payment;
  }

  private async nextSequence(saleId: string): Promise<number> {
    const last = await this.prisma.salePayment.findFirst({
      where: { saleId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    return last ? last.sequence + 1 : 0;
  }

  /** Resolve an installment amount from an explicit amount or a % of the sale price. */
  private resolveAmount(
    amount: number | undefined,
    percentOfPrice: number | undefined,
    salePrice: Prisma.Decimal | null,
  ): number {
    if (amount != null) {
      if (!(amount > 0)) throw new BadRequestException('Installment amount must be positive');
      return amount;
    }
    if (percentOfPrice != null) {
      if (!(percentOfPrice > 0)) throw new BadRequestException('Installment percentage must be positive');
      if (salePrice == null) {
        throw new BadRequestException('Sale has no salePrice; cannot compute a percentage installment');
      }
      return (Number(salePrice) * percentOfPrice) / 100;
    }
    throw new BadRequestException('Provide either amount or percentOfPrice');
  }
}

/** Standard installment templates (percentages of salePrice). Confirm with Prime (D15). */
export const PAYMENT_TEMPLATES = {
  '10-40-50': [
    { label: 'Deposit', percentOfPrice: 10, trigger: 'ON_SIGNING' as SalePaymentTrigger },
    { label: 'Construction', percentOfPrice: 40, trigger: 'FIXED_DATE' as SalePaymentTrigger },
    { label: 'Handover', percentOfPrice: 50, trigger: 'ON_HANDOVER' as SalePaymentTrigger },
  ],
  '30-40-30': [
    { label: 'Signing', percentOfPrice: 30, trigger: 'ON_SIGNING' as SalePaymentTrigger },
    { label: 'Structure', percentOfPrice: 40, trigger: 'FIXED_DATE' as SalePaymentTrigger },
    { label: 'Handover', percentOfPrice: 30, trigger: 'ON_HANDOVER' as SalePaymentTrigger },
  ],
} as const;
