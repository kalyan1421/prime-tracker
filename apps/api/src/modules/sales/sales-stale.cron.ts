import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';

/**
 * Nightly scan for sales that have gone cold or stalled.
 *
 *   Activity drought: lastActivityAt > 14 days ago      → 'sale.activityDrought'
 *   Stage age:        same status > 30 days             → 'sale.staleStage'
 *
 * Fires events; handlers (notifications, exception feed) act on them.
 * No DB writes — these are computed-on-the-fly flags.
 */
@Injectable()
export class SalesStaleCron {
  private readonly logger = new Logger(SalesStaleCron.name);

  constructor(private prisma: PrismaService, private bus: EventBus) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { name: 'sales-stale' })
  async run() {
    const droughtDays = 14;
    const stageAgeDays = 30;
    const droughtCutoff  = new Date(Date.now() - droughtDays * 24 * 60 * 60 * 1000);
    const stageAgeCutoff = new Date(Date.now() - stageAgeDays * 24 * 60 * 60 * 1000);

    // Activity drought: only on still-in-flight deals
    const dryDeals = await this.prisma.sale.findMany({
      where: {
        status: { in: ['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT'] },
        OR: [
          { lastActivityAt: { lt: droughtCutoff } },
          { lastActivityAt: null, updatedAt: { lt: droughtCutoff } },
        ],
      },
      select: { id: true, lastActivityAt: true, updatedAt: true },
    });
    for (const s of dryDeals) {
      const since = s.lastActivityAt ?? s.updatedAt;
      const days = Math.floor((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000));
      this.bus.emit({ type: 'sale.activityDrought', saleId: s.id, days });
    }

    // Stage age: same status for too long
    const staleStage = await this.prisma.sale.findMany({
      where: {
        status: { in: ['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT'] },
        updatedAt: { lt: stageAgeCutoff },
      },
      select: { id: true, status: true, updatedAt: true },
    });
    for (const s of staleStage) {
      const days = Math.floor((Date.now() - s.updatedAt.getTime()) / (24 * 60 * 60 * 1000));
      this.bus.emit({ type: 'sale.staleStage', saleId: s.id, status: s.status, days });
    }

    this.logger.log(`Sales stale cron: ${dryDeals.length} drought, ${staleStage.length} stage-stale`);
  }
}
