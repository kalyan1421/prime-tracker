import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WebsiteSyncService } from './website-sync.service';

/**
 * Pushes published projects to the website every five minutes when their units
 * changed, and hourly regardless. Polling rather than hooking writes: unit status is
 * changed by a dozen services, and a poll sees every one of them — including a unit
 * renumbered or resized by hand — with no change to any of them.
 */
@Injectable()
export class WebsiteSyncCron {
  constructor(private sync: WebsiteSyncService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'website-sync' })
  run() {
    return this.sync.syncPublished();
  }
}
