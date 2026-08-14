import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';

/**
 * Daily scan for units that have been AVAILABLE longer than the org's threshold
 * (default 90 days). Emits `unit.staleAvailable` so notifications + dashboard
 * exception feed can pick them up.
 *
 * De-duplication: one alert per unit per crossing — we don't re-emit every day.
 * Strategy: compare days-on-market today vs. yesterday's threshold check.
 * For now we emit at exactly 90/120/180 day buckets to avoid daily spam.
 */
const ALERT_DAY_BUCKETS = [90, 120, 180, 365];

@Injectable()
export class StaleUnitsCron {
  private readonly logger = new Logger(StaleUnitsCron.name);

  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
    private statusEvents: UnitStatusEventService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { name: 'stale-units' })
  async run() {
    const now = Date.now();
    let alertsFired = 0;

    // Vacancy age comes from the occupancy log rather than `availableSince`, which is
    // null on most units — the old date-range filter on that column simply skipped
    // them, so these alerts almost never fired. One query for the candidates, one for
    // their vacancy starts, then bucket in memory.
    const available = await this.prisma.unit.findMany({
      where: { status: 'AVAILABLE', deletedAt: null },
      select: { id: true, availableSince: true, createdAt: true, building: { select: { projectId: true } } },
    });
    const vacancyStarts = await this.statusEvents.currentVacancyStartByUnit(
      available.map((u) => u.id),
    );

    for (const days of ALERT_DAY_BUCKETS) {
      const cutoffStart = new Date(now - (days + 1) * 24 * 60 * 60 * 1000);
      const cutoffEnd = new Date(now - days * 24 * 60 * 60 * 1000);

      // Units that crossed *exactly* this threshold in the last 24h
      for (const u of available) {
        const since = vacancyStarts.get(u.id) ?? u.availableSince ?? u.createdAt;
        if (since < cutoffStart || since > cutoffEnd) continue;

        this.bus.emit({
          type: 'unit.staleAvailable',
          unitId: u.id,
          days,
          projectId: u.building.projectId,
        });
        alertsFired++;
      }
    }

    if (alertsFired > 0) {
      this.logger.log(`Stale-units cron fired ${alertsFired} alerts`);
    }
  }
}
