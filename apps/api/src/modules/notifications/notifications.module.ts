import { Module } from '@nestjs/common';
import { LeasesModule } from '../leases/leases.module';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ScheduledNotificationsService } from './scheduled-notifications.service';
import { AuditService } from '../../common/utils/audit.service';
import { NotificationsGateway } from './notifications.gateway';
import { LeaseEventHandlers } from './lease-event-handlers.service';

@Module({
  imports: [
    // For LeaseRentInvoiceService, which the daily cron calls to populate the rent
    // ledger before checking for overdue rent. Safe direction: LeasesModule does NOT
    // import NotificationsModule — LeaseEventHandlers lives here precisely so leases
    // never has to depend on notifications.
    LeasesModule,
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
