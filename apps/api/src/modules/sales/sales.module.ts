import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { SalesForecastService } from './sales-forecast.service';
import { SalesStaleCron } from './sales-stale.cron';
import { SalePaymentsService } from './sale-payments.service';
import { SalePaymentEventHandlers } from './sale-payment-event-handlers.service';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [SalesController],
  providers: [
    SalesService,
    SalesForecastService,
    SalesStaleCron,
    SalePaymentsService,
    SalePaymentEventHandlers,
    AuditService,
  ],
  exports: [SalesService, SalesForecastService, SalePaymentsService],
})
export class SalesModule {}
