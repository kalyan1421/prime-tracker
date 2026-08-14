import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { SalesForecastService } from './sales-forecast.service';
import { SalesStaleCron } from './sales-stale.cron';
import { SalePaymentsService } from './sale-payments.service';
import { SalePaymentEventHandlers } from './sale-payment-event-handlers.service';
import { AuditService } from '../../common/utils/audit.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';
import { LeasesModule } from '../leases/leases.module';

@Module({
  // Closing a sale ends the sitting tenancy (H3), so SalesService needs LeasesService.
  // No cycle: LeasesModule does not import SalesModule.
  imports: [LeasesModule],
  controllers: [SalesController],
  providers: [
    SalesService,
    SalesForecastService,
    SalesStaleCron,
    SalePaymentsService,
    SalePaymentEventHandlers,
    AuditService,
    UnitStatusEventService,
  ],
  exports: [SalesService, SalesForecastService, SalePaymentsService],
})
export class SalesModule {}
