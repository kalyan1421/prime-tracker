import { Module } from '@nestjs/common';
import { MilestonesService } from './milestones.service';
import { MilestonesController } from './milestones.controller';
import { MilestoneDepsService } from './milestone-deps.service';
import { OverdueDetectionCron } from './overdue-detection.cron';
import { AuditService } from '../../common/utils/audit.service';
import { StorageService } from '../../common/storage/storage.service';

@Module({
  controllers: [MilestonesController],
  providers: [MilestonesService, MilestoneDepsService, OverdueDetectionCron, AuditService, StorageService],
  exports: [MilestonesService, MilestoneDepsService],
})
export class MilestonesModule {}
