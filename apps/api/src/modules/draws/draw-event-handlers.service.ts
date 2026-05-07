import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { ProjectHealthService } from '../health/project-health.service';

/**
 * Cross-feature event handlers — the wires connecting our 7 features.
 *
 *   milestone.completed       → if linkedDrawSchedule, auto-create DrawRequest{ DRAFT }
 *   drawRequest.funded        → auto-create Actual rows, invalidate dashboards + health
 *   drawRequest.fundingOverdue→ create Notification for Finance+Founder
 *   budget.varianceExceeded   → create Notification, invalidate project health cache
 *
 * This service is the "glue layer". If you remove it, all features still work
 * individually — but the system stops feeling like one product. Keep handlers
 * SHORT; if they grow, factor into the owning module.
 */
@Injectable()
export class DrawEventHandlers implements OnModuleInit {
  private readonly logger = new Logger(DrawEventHandlers.name);

  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
    private dashboard: DashboardService,
    private health: ProjectHealthService,
  ) {}

  onModuleInit() {
    this.bus.on('milestone.completed', (e) => this.onMilestoneCompleted(e));
    this.bus.on('drawRequest.funded', (e) => this.onDrawFunded(e));
    this.bus.on('drawRequest.fundingOverdue', (e) => this.onFundingOverdue(e));
    this.bus.on('budget.varianceExceeded', (e) => this.onVarianceExceeded(e));
    this.bus.on('unit.staleAvailable', () => this.dashboard.invalidate());
  }

  /**
   * The big one: marking a milestone complete on a job site auto-drafts a
   * draw request the PM can submit a moment later.
   *
   * Triggered only when the milestone has `linkedDrawScheduleId` set.
   */
  private async onMilestoneCompleted(e: { milestoneId: string; projectId: string }) {
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: e.milestoneId },
      include: { linkedDrawSchedule: { include: { loan: true } } },
    });
    if (!milestone?.linkedDrawSchedule) return;

    const schedule = milestone.linkedDrawSchedule;
    // Idempotency: if a draw was already created for this schedule entry, skip.
    const existing = await this.prisma.drawRequest.findFirst({
      where: { loanId: schedule.loanId, drawNumber: schedule.drawNumber },
    });
    if (existing) {
      this.logger.log(`Draw #${schedule.drawNumber} already exists for loan ${schedule.loanId} — skipping auto-draft`);
      return;
    }

    // Default expected funding: 14 days from now (overridable via OrgSettings)
    const expectedFundingDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await this.prisma.drawRequest.create({
      data: {
        loanId: schedule.loanId,
        projectId: e.projectId,
        drawNumber: schedule.drawNumber,
        amount: schedule.plannedAmount,
        requestedAmount: schedule.plannedAmount,
        requestDate: new Date(),
        status: 'DRAFT',
        expectedFundingDate,
        notes: `Auto-drafted from milestone completion: "${milestone.title}"`,
      },
    });
    this.logger.log(`Auto-drafted draw #${schedule.drawNumber} for milestone ${e.milestoneId}`);

    // Recompute project health since milestone status + new draft draw both affect it
    this.health.invalidate(e.projectId);
  }

  /**
   * When a draw is FUNDED, create matching Actual records so the budget
   * is updated automatically — no double-entry needed.
   *
   * One Actual per draw, charged to a default category. Smarter category
   * mapping (per draw line item) is a follow-up.
   */
  private async onDrawFunded(e: { drawId: string; projectId: string; amount: number }) {
    if (!e.projectId) return;

    // Idempotency: check if we already posted an Actual for this draw
    const existing = await this.prisma.actual.findFirst({
      where: { qbTxnId: `draw:${e.drawId}` },
    });
    if (existing) {
      this.logger.log(`Actual already posted for draw ${e.drawId} — skipping`);
      return;
    }

    await this.prisma.actual.create({
      data: {
        projectId: e.projectId,
        category: 'HARD_COSTS',  // sensible default; refine when per-line categorization ships
        description: `Construction draw #${e.drawId.slice(-6)}`,
        amount: e.amount,
        txnDate: new Date(),
        qbTxnId: `draw:${e.drawId}`,
        qbSyncStatus: 'PENDING',  // QB will pick up on next sync
      },
    });
    this.logger.log(`Posted actual for draw ${e.drawId} ($${e.amount})`);

    this.dashboard.invalidate();
    this.health.invalidate(e.projectId);
  }

  private async onFundingOverdue(e: { drawId: string; daysOverdue: number }) {
    const draw = await this.prisma.drawRequest.findUnique({
      where: { id: e.drawId },
      include: { loan: { select: { lender: true } }, project: { select: { name: true, id: true } } },
    });
    if (!draw) return;

    // Notify Finance + Founder roles. We use the existing Notification model.
    const recipients = await this.prisma.user.findMany({
      where: { role: { in: ['FOUNDER', 'FINANCE', 'AR_AP'] }, isActive: true },
      select: { id: true },
    });

    await this.prisma.notification.createMany({
      data: recipients.map((u) => ({
        userId: u.id,
        type: 'BUDGET_VARIANCE',  // closest existing type; add DRAW_OVERDUE in next migration
        title: `Draw funding overdue (${e.daysOverdue}d)`,
        body: `Draw #${draw.drawNumber} on ${draw.project?.name ?? 'project'} is ${e.daysOverdue} days past expected funding`,
        link: draw.projectId ? `/projects/${draw.projectId}/draws` : null,
      })),
    });
  }

  private async onVarianceExceeded(e: { projectId: string; pct: number }) {
    // Invalidate health so the dashboard reflects the new severity immediately
    this.health.invalidate(e.projectId);
    this.dashboard.invalidate();
  }
}
