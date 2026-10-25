import { Module } from '@nestjs/common';
import { WebsiteSyncController } from './website-sync.controller';
import { WebsiteSyncCron } from './website-sync.cron';
import { WebsiteSyncService } from './website-sync.service';

/**
 * Publishes unit inventory to the public website (PrimeDevelopers-web). Off until
 * WEBSITE_SYNC_URL and WEBSITE_SYNC_SECRET are set; a project takes part once its
 * `websiteSlug` is set.
 */
@Module({
  controllers: [WebsiteSyncController],
  providers: [WebsiteSyncService, WebsiteSyncCron],
})
export class WebsiteSyncModule {}
