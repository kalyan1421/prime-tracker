import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';
import type { BudgetChangeReason } from '@prisma/client';

/**
 * Append-only revision history for budget lines.
 *
 * Lifecycle:
 *   1. BudgetLine is created → revision #1 with the baseline amount.
 *   2. Each edit creates revision N+1; BudgetLine.revisedAmt is denormalized
 *      to the latest revision so existing reads stay fast.
 *   3. Revisions are NEVER updated or deleted — auditors and lenders need to
 *      see the trail of "we increased hard costs from $4M to $4.6M in March,
 *      reason: cost increase, approved by founder."
 *
 * Approvals:
 *   A revision can be created without approval (createdBy only) for fast
 *   collaboration. Approval is a separate action that stamps approvedBy/At.
 *   Whether approval is required before the revision "counts" is a policy
 *   decision per org — keep simple here, layer policy on top later.
 */
@Injectable()
export class BudgetRevisionService {
  constructor(private prisma: PrismaService, private bus: EventBus) {}

  async listForLine(budgetLineId: string) {
    return this.prisma.budgetRevision.findMany({
      where: { budgetLineId },
      orderBy: { revisionNumber: 'desc' },
      include: {
        createdBy:  { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Project-wide budget change log — every revision across every budget line in
   * the project, newest first. Powers the day-wise log in the Budget tab.
   */
  async listForProject(projectId: string) {
    return this.prisma.budgetRevision.findMany({
      where: { budgetLine: { projectId } },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy:  { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        budgetLine: { select: { id: true, description: true, category: true } },
      },
    });
  }

  /**
   * Create a new revision for an existing budget line.
   * Updates BudgetLine.revisedAmt to mirror the latest revision.
   */
  async createRevision(input: {
    budgetLineId: string;
    amount: number;
    reason: string;
    changeReason: BudgetChangeReason;
    createdById: string;
  }) {
    if (!input.reason?.trim()) {
      throw new BadRequestException('A reason is required for every revision');
    }
    const line = await this.prisma.budgetLine.findUnique({
      where: { id: input.budgetLineId },
      include: { revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } },
    });
    if (!line) throw new NotFoundException('Budget line not found');

    const lastRev = line.revisions[0];
    const nextNumber = (lastRev?.revisionNumber ?? 0) + 1;

    // Single transaction: create revision + update line's denormalized amount.
    const [revision] = await this.prisma.$transaction([
      this.prisma.budgetRevision.create({
        data: {
          budgetLineId: input.budgetLineId,
          revisionNumber: nextNumber,
          amount: input.amount,
          reason: input.reason.trim(),
          changeReason: input.changeReason,
          createdById: input.createdById,
        },
      }),
      this.prisma.budgetLine.update({
        where: { id: input.budgetLineId },
        data: { revisedAmt: input.amount },
      }),
    ]);

    this.bus.emit({
      type: 'budget.revisionCreated',
      budgetLineId: input.budgetLineId,
      revisionNumber: nextNumber,
      createdById: input.createdById,
    });

    return revision;
  }

  /** Stamp approval on an existing revision. Cannot un-approve. */
  async approve(revisionId: string, approverId: string) {
    const rev = await this.prisma.budgetRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw new NotFoundException('Revision not found');
    if (rev.approvedById) {
      throw new BadRequestException('Revision is already approved');
    }
    return this.prisma.budgetRevision.update({
      where: { id: revisionId },
      data: { approvedById: approverId, approvedAt: new Date() },
    });
  }
}
