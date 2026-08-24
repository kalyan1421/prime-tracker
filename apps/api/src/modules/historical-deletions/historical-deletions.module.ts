import { Module } from '@nestjs/common';
import { HistoricalDeletionsController } from './historical-deletions.controller';
import { HistoricalDeletionService } from '../../common/utils/historical-deletion.service';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [HistoricalDeletionsController],
  providers: [HistoricalDeletionService, AuditService],
})
export class HistoricalDeletionsModule {}
