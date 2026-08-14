import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { AuditService } from '../../common/utils/audit.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, AuditService, UnitStatusEventService],
})
export class ReportsModule {}
