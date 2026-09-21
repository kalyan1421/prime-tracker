import { Module } from '@nestjs/common';
import { SiteVisitsService } from './site-visits.service';
import { VisitAvailabilityService } from './visit-availability.service';
import { SiteVisitsController, VisitAvailabilityController } from './site-visits.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [SiteVisitsController, VisitAvailabilityController],
  providers: [SiteVisitsService, VisitAvailabilityService],
  exports: [SiteVisitsService, VisitAvailabilityService],
})
export class SiteVisitsModule {}
