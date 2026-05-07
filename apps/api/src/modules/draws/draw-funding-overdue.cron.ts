import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';

/**
 * Daily check for draws that have passed their expected funding date.
 * Fires `drawRequest.fundingOverdue` so handlers can escalate
 * (notify Founder + Finance, surface in exception feed).
 */
@Injectable()
export class DrawFundingOverdueCron {
  private readonly logger = new Logger(DrawFundingOverdueCron.name);

  constructor(private prisma: PrismaService, private bus: EventBus) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { name: 'draw-funding-overdue' })
  async run() {
    const now = new Date();
    const overdue = await this.prisma.drawRequest.findMany({
      where: {
        status: 'APPROVED',           // approved internally + submitted to lender
        expectedFundingDate: { lt: now },
        fundedAt: null,
      },
      select: { id: true, expectedFundingDate: true },
    });

    for (const d of overdue) {
      const days = Math.floor(
        (now.getTime() - (d.expectedFundingDate?.getTime() ?? now.getTime())) /
          (24 * 60 * 60 * 1000),
      );
      this.bus.emit({ type: 'drawRequest.fundingOverdue', drawId: d.id, daysOverdue: days });
    }
    this.logger.log(`Draw funding overdue: ${overdue.length} draws past expected date`);
  }
}
