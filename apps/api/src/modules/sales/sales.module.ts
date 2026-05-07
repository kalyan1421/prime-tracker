import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { SalesForecastService } from './sales-forecast.service';
import { SalesStaleCron } from './sales-stale.cron';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [SalesController],
  providers: [SalesService, SalesForecastService, SalesStaleCron, AuditService],
  exports: [SalesService, SalesForecastService],
})
export class SalesModule {}
