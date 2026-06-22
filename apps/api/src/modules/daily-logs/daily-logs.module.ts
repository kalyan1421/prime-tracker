import { Module } from '@nestjs/common';
import { DailyLogsService } from './daily-logs.service';
import { DailyLogsController } from './daily-logs.controller';
import { AuditService } from '../../common/utils/audit.service';
import { StorageService } from '../../common/storage/storage.service';

@Module({
  controllers: [DailyLogsController],
  providers: [DailyLogsService, AuditService, StorageService],
  exports: [DailyLogsService],
})
export class DailyLogsModule {}
