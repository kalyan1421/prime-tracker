import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Cross-feature event handlers — the wires connecting our 7 features.
 *
 *   milestone.completed       → if linkedDrawSchedule, auto-create DrawRequest{ DRAFT }
 *   drawRequest.submitted     → notify approvers (Super Admin/Founder/Executive/Finance)
 *   drawRequest.approved      → notify Finance/leadership the draw is ready for the lender
 *   drawRequest.funded        → auto-create Actual rows, invalidate dashboards, notify
 *   drawRequest.fundingOverdue→ notify Finance/AR-AP (+ leadership) the lender is late
 *   budget.varianceExceeded   → invalidate dashboard cache
 *
 * Note: project health is unit-based only (see ProjectHealthService) and does not
 * depend on draws, milestones, or budget variance — none of these handlers touch it.
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
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.bus.on('milestone.completed', (e) => this.onMilestoneCompleted(e));
    this.bus.on('drawRequest.submitted', (e) => this.onDrawSubmitted(e));
    this.bus.on('drawRequest.approved', (e) => this.onDrawApproved(e));
    this.bus.on('drawRequest.funded', (e) => this.onDrawFunded(e));
    this.bus.on('drawRequest.fundingOverdue', (e) => this.onFundingOverdue(e));
    this.bus.on('budget.varianceExceeded', (e) => this.onVarianceExceeded(e));
    this.bus.on('unit.staleAvailable', () => this.dashboard.invalidate());
  }

  /**
   * Shared fetch for the shape notifyDrawRequest needs. Reads projectId/project off
   * DrawRequest itself (not through loan) — a loan can be building-level only
   * (loan.projectId null), but DrawRequest.projectId is always resolved.
   */
  private async findDrawForNotification(drawId: string) {
    return this.prisma.drawRequest.findUnique({
      where: { id: drawId },
      select: {
        drawNumber: true,
        loanId: true,
        projectId: true,
        project: { select: { name: true } },
      },
    });
  }

  private async onDrawSubmitted(e: { drawId: string; step: string }) {
    // Same event type also fires for "forwarded to lender" (loans.service.ts
    // submitToLender, step: LENDER_SUBMITTED) — only the internal-review submission
    // needs an approver notification.
    if (e.step !== 'INTERNAL_REVIEW') return;
    const draw = await this.findDrawForNotification(e.drawId);
    if (!draw?.projectId || !draw.project) return;
    await this.notifications.notifyDrawRequest({ status: 'SUBMITTED', ...draw, projectId: draw.projectId, project: draw.project });
  }

  private async onDrawApproved(e: { drawId: string; approverId: string }) {
    const draw = await this.findDrawForNotification(e.drawId);
    if (!draw?.projectId || !draw.project) return;
    await this.notifications.notifyDrawRequest({ status: 'APPROVED', ...draw, projectId: draw.projectId, project: draw.project });
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

    const draw = await this.findDrawForNotification(e.drawId);
    if (draw?.projectId && draw.project) {
      await this.notifications.notifyDrawRequest({ status: 'FUNDED', ...draw, projectId: draw.projectId, project: draw.project });
    }
  }

  /**
   * Delegates to NotificationsService like its sibling handlers do. The raw
   * prisma.notification.createMany this replaced bypassed project routing,
   * per-user mute preferences and email entirely — which made the settings
   * toggle for DRAW_FUNDING_OVERDUE a lie.
   *
   * `loan.lender` is deliberately NOT fetched: it is an AES-encrypted field, so
   * reading it here would put ciphertext in a notification body.
   */
  private async onFundingOverdue(e: { drawId: string; daysOverdue: number }) {
    const draw = await this.findDrawForNotification(e.drawId);
    if (!draw?.projectId) return;

    await this.notifications.notifyDrawFundingOverdue({
      drawNumber: draw.drawNumber,
      projectId: draw.projectId,
      projectName: draw.project?.name ?? null,
      daysOverdue: e.daysOverdue,
    });
  }

  private async onVarianceExceeded(e: { projectId: string; pct: number }) {
    // Invalidate dashboard so the new variance severity shows up immediately
    this.dashboard.invalidate();
  }
}
