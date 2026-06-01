import { Module } from '@nestjs/common';
import { DailyLogsService } from './daily-logs.service';
import { DailyLogsController } from './daily-logs.controller';
import { AuditService } from '../../common/utils/audit.service';

/**
 * Daily construction logs — dated field logs with photos, per project/building.
 * The client's #1 pain point ("daily logs with pictures").
 */
@Module({
  controllers: [DailyLogsController],
  providers: [DailyLogsService, AuditService],
  exports: [DailyLogsService],
})
export class DailyLogsModule {}
