import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, AuditService],
})
export class ReportsModule {}
