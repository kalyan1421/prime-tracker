import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeasesModule } from '../leases/leases.module';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ScheduledNotificationsService } from './scheduled-notifications.service';
import { AuditService } from '../../common/utils/audit.service';
import { NotificationsGateway } from './notifications.gateway';
import { LeaseEventHandlers } from './lease-event-handlers.service';
import { MilestoneEventHandlers } from './milestone-event-handlers.service';

@Module({
  imports: [
    // For LeaseRentInvoiceService, which the daily cron calls to populate the rent
    // ledger before checking for overdue rent. Safe direction: LeasesModule does NOT
    // import NotificationsModule — LeaseEventHandlers lives here precisely so leases
    // never has to depend on notifications.
    LeasesModule,
    // registerAsync + ConfigService, NOT register + process.env.
    //
    // `JwtModule.register({...})` evaluates its argument when THIS decorator's argument is
    // constructed — i.e. at import time. app.module.ts imports this module before its own
    // decorator runs, so that happens before ConfigModule.forRoot() has merged
    // apps/api/.env into process.env. Whenever the secret comes only from the .env file —
    // which is the local `nest start` case, since the dev script has no dotenv preload —
    // this resolved to `secret: undefined`.
    //
    // The failure was silent and total: jwtService.verify() threw inside
    // notifications.gateway.ts, the gateway's bare catch called client.disconnect(), and
    // every WebSocket connection was refused. Live notifications simply never arrived and
    // the 30s poll covered for it, so the gateway was untestable locally. registerAsync
    // defers the factory until ConfigModule is initialised, matching auth.module.ts.
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_EXPIRY', '15m') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [NotificationsController],
    // LeaseEventHandlers subscribes to the EventBus on init — it lives here rather than in
  // LeasesModule so leases never has to import notifications (the circular dep that
  // DrawEventHandlers exists to avoid).
  // MilestoneEventHandlers is here for the same reason as LeaseEventHandlers: it lets
  // MilestonesModule emit `milestone.slipProposed` without importing notifications.
  providers: [NotificationsService, ScheduledNotificationsService, AuditService, NotificationsGateway, LeaseEventHandlers, MilestoneEventHandlers],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
