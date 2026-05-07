import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, AuditService],
  exports: [DashboardService],
})
export class DashboardModule {}
