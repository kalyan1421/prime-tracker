import { Module } from '@nestjs/common';
import { SiteTrackerService } from './site-tracker.service';
import { SiteTrackerController } from './site-tracker.controller';
import { SiteTrackerImportService } from './site-tracker-import.service';

@Module({
  controllers: [SiteTrackerController],
  providers: [SiteTrackerService, SiteTrackerImportService],
  exports: [SiteTrackerService],
})
export class SiteTrackerModule {}
