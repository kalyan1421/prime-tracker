import { Module } from '@nestjs/common';
import { MilestonesService } from './milestones.service';
import { MilestonesController } from './milestones.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [MilestonesController],
  providers: [MilestonesService, AuditService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
