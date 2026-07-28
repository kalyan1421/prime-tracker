import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

/**
 * Daily milestone-overdue detection.
 *
 * The current schema has `MilestoneStatus.OVERDUE`, but until now nothing
 * automatically transitioned a milestone *into* that state — `status` only
 * changed via manual edits. Result: a milestone could be 30 days past due
 * and still show as IN_PROGRESS unless someone clicked the row.
 *
 * This cron flips milestones whose `dueDate < now` and current status is
 * NOT_STARTED or IN_PROGRESS into OVERDUE. COMPLETED, BLOCKED, and already-OVERDUE
 * rows are left alone — once OVERDUE is set, the user is responsible for
 * progressing it (no auto-recovery to avoid status thrashing).
 *
 * Cache invalidation: clears the exceptions feed + dashboard so the new severity
 * shows up on the next read instead of waiting for the 60s TTL. (Project health is
 * unit-based only and does not depend on milestone status — nothing to invalidate there.)
 */
@Injectable()
export class OverdueDetectionCron {
  private readonly logger = new Logger(OverdueDetectionCron.name);

  constructor(private prisma: PrismaService, private cache: CacheService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'milestone-overdue-detection' })
  async run() {
    const result = await this.prisma.milestone.updateMany({
      where: {
        status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
        dueDate: { lt: new Date() },
      },
      data: { status: 'OVERDUE' },
    });

    if (result.count > 0) {
      this.logger.log(`Flagged ${result.count} milestones as OVERDUE`);
      // The exception feed depends on milestone status — wipe it and dashboard
      // so both reflect the change immediately.
      this.cache.invalidateTag('exceptions');
      this.cache.invalidateTag('dashboard');
    }
  }
}
