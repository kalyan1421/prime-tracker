import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ScheduledNotificationsService } from './scheduled-notifications.service';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ScheduledNotificationsService, AuditService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
