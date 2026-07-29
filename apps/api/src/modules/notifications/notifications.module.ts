import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ScheduledNotificationsService } from './scheduled-notifications.service';
import { AuditService } from '../../common/utils/audit.service';
import { NotificationsGateway } from './notifications.gateway';
import { LeaseEventHandlers } from './lease-event-handlers.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' },
    }),
  ],
  controllers: [NotificationsController],
    // LeaseEventHandlers subscribes to the EventBus on init — it lives here rather than in
  // LeasesModule so leases never has to import notifications (the circular dep that
  // DrawEventHandlers exists to avoid).
  providers: [NotificationsService, ScheduledNotificationsService, AuditService, NotificationsGateway, LeaseEventHandlers],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
