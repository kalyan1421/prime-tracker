import { Module } from '@nestjs/common';
import { SiteTrackerService } from './site-tracker.service';
import { SiteTrackerController } from './site-tracker.controller';

@Module({
  controllers: [SiteTrackerController],
  providers: [SiteTrackerService],
  exports: [SiteTrackerService],
})
export class SiteTrackerModule {}
