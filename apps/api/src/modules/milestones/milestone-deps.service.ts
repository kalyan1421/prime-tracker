import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';

/**
 * Milestone dependency + slippage logic.
 *
 *   - setDependency():  attach Milestone B → depends on A. Cycles rejected.
 *   - canStart():       enforce: a milestone can move from NOT_STARTED only
 *                        when its dependency is COMPLETED.
 *   - propagateSlippage(): when a milestone's due date moves, push dependents
 *                          forward by the same delta and emit slip events.
 *
 * The schedule slippage forecast is just a tree walk of dependents. It's
 * cheap because dependency graphs in real estate are shallow (typically
 * 5–10 milestones deep, single chain per phase).
 */
@Injectable()
export class MilestoneDepsService {
  constructor(private prisma: PrismaService, private bus: EventBus) {}

  /** Set or change a dependency. Refuses to create a cycle. */
  async setDependency(milestoneId: string, dependsOnId: string | null) {
    if (dependsOnId === milestoneId) {
      throw new BadRequestException('A milestone cannot depend on itself');
    }
    if (dependsOnId) {
      // Walk dependsOn chain to detect cycles. Cap at 100 hops as a safety net.
      let current: string | null = dependsOnId;
      const seen = new Set<string>();
      for (let hops = 0; hops < 100 && current; hops++) {
        if (current === milestoneId) {
          throw new BadRequestException('This dependency would create a cycle');
        }
        if (seen.has(current)) break; // already-existing cycle — stop walking
        seen.add(current);
        const next: { dependsOnId: string | null } | null = await this.prisma.milestone.findUnique({
          where: { id: current },
          select: { dependsOnId: true },
        });
        current = next?.dependsOnId ?? null;
      }
    }
    return this.prisma.milestone.update({
      where: { id: milestoneId },
      data: { dependsOnId },
    });
  }

  /** Check whether a milestone is allowed to start (not blocked by dependency). */
  async canStart(milestoneId: string): Promise<{ allowed: boolean; reason?: string }> {
    const m = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: { dependsOn: { select: { id: true, title: true, status: true } } },
    });
    if (!m) throw new NotFoundException('Milestone not found');
    if (!m.dependsOn) return { allowed: true };
    if (m.dependsOn.status !== 'COMPLETED') {
      return {
        allowed: false,
        reason: `Blocked by "${m.dependsOn.title}" (status: ${m.dependsOn.status})`,
      };
    }
    return { allowed: true };
  }

  /**
   * When milestone X's due date moves by `daysSlipped`, push all dependents
   * forward by the same number of days. Returns the affected milestones.
   *
   * Emits 'milestone.slipped' for each dependent so the dashboard exception
   * feed and notifications can react.
   */
  async propagateSlippage(milestoneId: string, daysSlipped: number) {
    if (daysSlipped <= 0) return [];

    const affected: { id: string; oldDueDate: Date; newDueDate: Date }[] = [];
    const queue = [milestoneId];
    const visited = new Set<string>();

    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const dependents = await this.prisma.milestone.findMany({
        where: { dependsOnId: id, status: { notIn: ['COMPLETED'] } },
        select: { id: true, dueDate: true },
      });

      for (const d of dependents) {
        const newDate = new Date(d.dueDate.getTime() + daysSlipped * 24 * 60 * 60 * 1000);
        await this.prisma.milestone.update({
          where: { id: d.id },
          data: { dueDate: newDate },
        });
        affected.push({ id: d.id, oldDueDate: d.dueDate, newDueDate: newDate });
        this.bus.emit({
          type: 'milestone.slipped',
          milestoneId: d.id,
          oldDueDate: d.dueDate,
          newDueDate: newDate,
          daysSlipped,
        });
        queue.push(d.id); // recurse into transitive dependents
      }
    }
    return affected;
  }

  /**
   * Compute project end-date impact: latest dueDate across all non-completed
   * milestones for the project (rough but useful proxy).
   */
  async projectExpectedEnd(projectId: string): Promise<Date | null> {
    const m = await this.prisma.milestone.findFirst({
      where: { projectId, status: { notIn: ['COMPLETED'] } },
      orderBy: { dueDate: 'desc' },
      select: { dueDate: true },
    });
    return m?.dueDate ?? null;
  }
}
