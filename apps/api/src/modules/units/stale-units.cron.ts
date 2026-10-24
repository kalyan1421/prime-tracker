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
 * De-duplication: one alert per unit per bucket per VACANCY — not one per day.
 *
 * This used to emit only when a unit's age landed in the exact 24-hour window after a
 * bucket (`days ≤ age < days + 1`). A run that did not happen — a deploy at 08:00, the
 * box down for a day — skipped that window, and the alert for that bucket was lost for
 * good: tomorrow the unit is a day past it and never matches again.
 *
 * It now remembers what it has already said, in `unit_vacancy_alerts` (one row per unit,
 * keyed on the vacancy start + the highest bucket alerted — the same idea as a
 * notification dedupeKey, which this event has no notification row to carry). Each run
 * alerts on the HIGHEST bucket a vacancy has crossed that it has not yet alerted for, so a
 * missed run is caught up the next morning, and a unit that sat through several missed
 * buckets gets one alert at the bucket it is actually in rather than a burst of stale ones.
 * A new vacancy (the unit was let or sold and came back) has a different start, so its
 * buckets start over.
 */
export const ALERT_DAY_BUCKETS = [90, 120, 180, 365] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The highest bucket a vacancy of this many whole days has reached, or null below the first. */
export function highestCrossedBucket(daysVacant: number): number | null {
  let crossed: number | null = null;
  for (const bucket of ALERT_DAY_BUCKETS) if (daysVacant >= bucket) crossed = bucket;
  return crossed;
}

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
    // Named and logged rather than left to the scheduler's anonymous error line — see
    // DrawFundingOverdueCron.run. A failed run is no longer lossy either: whatever it did
    // not alert on is still un-alerted tomorrow, and tomorrow's run catches it up.
    try {
      const alertsFired = await this.check();
      if (alertsFired > 0) {
        this.logger.log(`Stale-units cron fired ${alertsFired} alerts`);
      }
    } catch (err) {
      this.logger.error(`Cron stale-units failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }

  /** One pass. Returns the number of alerts emitted. `now` is injectable for tests. */
  async check(now: Date = new Date()): Promise<number> {
    let alertsFired = 0;

    // Vacancy age comes from the occupancy log rather than `availableSince`, which is
    // null on most units — the old date-range filter on that column simply skipped
    // them, so these alerts almost never fired. One query for the candidates, one for
    // their vacancy starts, then bucket in memory.
    const available = await this.prisma.unit.findMany({
      where: { status: 'AVAILABLE', deletedAt: null },
      select: {
        id: true,
        availableSince: true,
        createdAt: true,
        building: { select: { projectId: true } },
        vacancyAlert: { select: { vacancyStart: true, days: true } },
      },
    });
    const vacancyStarts = await this.statusEvents.currentVacancyStartByUnit(
      available.map((u) => u.id),
    );

    for (const u of available) {
      const since = vacancyStarts.get(u.id) ?? u.availableSince ?? u.createdAt;
      const daysVacant = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
      const bucket = highestCrossedBucket(daysVacant);
      if (bucket === null) continue;

      // What this vacancy has already been alerted for. A stored row for an EARLIER
      // vacancy says nothing about this one.
      const sameVacancy = u.vacancyAlert?.vacancyStart.getTime() === since.getTime();
      const alreadyAlerted = sameVacancy ? u.vacancyAlert!.days : 0;
      if (bucket <= alreadyAlerted) continue;

      // Recorded BEFORE the emit: the row is what makes the alert "sent", so a failure
      // here means it was not sent and tomorrow's run retries it, rather than an alert
      // going out that nothing remembers.
      await this.prisma.unitVacancyAlert.upsert({
        where: { unitId: u.id },
        create: { unitId: u.id, vacancyStart: since, days: bucket, alertedAt: now },
        update: { vacancyStart: since, days: bucket, alertedAt: now },
      });
      this.bus.emit({
        type: 'unit.staleAvailable',
        unitId: u.id,
        days: bucket,
        projectId: u.building.projectId,
      });
      alertsFired++;
    }

    return alertsFired;
  }
}
