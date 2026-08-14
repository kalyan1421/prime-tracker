import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';
import { NotificationsService } from './notifications.service';

/**
 * Milestone domain events -> notifications.
 *
 * Mirrors LeaseEventHandlers and DrawEventHandlers: MilestoneDepsService emits typed
 * events and stays completely ignorant of notifications, so MilestonesModule never has to
 * import NotificationsModule. Deleting this file leaves the slip gate working — it just
 * stops telling anyone it is there, which is the failure the gate cannot survive.
 *
 *   milestone.slipProposed -> project PM + leadership (ACTION)
 *
 * `milestone.slipped` is deliberately NOT handled here. It now fires on APPLICATION, and
 * by then the PM has already decided — telling them again about their own decision is
 * noise. It exists for the dashboard exception feed.
 *
 * Handler errors are swallowed by EventBus by design: a failed notification must never
 * roll back the write that caused it.
 */
@Injectable()
export class MilestoneEventHandlers implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.bus.on('milestone.slipProposed', (e) => this.onSlipProposed(e));
  }

  private async onSlipProposed(e: {
    proposalId: string;
    milestoneId: string;
    projectId: string;
    daysSlipped: number;
    affectedCount: number;
    drawCount: number;
    requestedById: string | null;
  }) {
    const [milestone, project, requester] = await Promise.all([
      this.prisma.milestone.findUnique({
        where: { id: e.milestoneId },
        select: { title: true },
      }),
      this.prisma.project.findUnique({ where: { id: e.projectId }, select: { name: true } }),
      e.requestedById
        ? this.prisma.user.findUnique({ where: { id: e.requestedById }, select: { name: true } })
        : Promise.resolve(null),
    ]);

    await this.notifications.notifyMilestoneSlipPendingReview({
      proposalId: e.proposalId,
      projectId: e.projectId,
      projectName: project?.name ?? null,
      // A missing title must not stop the alert — the reviewer can still open the queue.
      milestoneTitle: milestone?.title ?? 'a milestone',
      daysSlipped: e.daysSlipped,
      affectedCount: e.affectedCount,
      drawCount: e.drawCount,
      requestedByName: requester?.name ?? null,
    });
  }
}
