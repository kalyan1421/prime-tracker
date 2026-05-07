import { Module } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { BuildingsController } from './buildings.controller';
import { ProjectPhaseService } from './project-phase.service';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [BuildingsController],
  providers: [BuildingsService, ProjectPhaseService, AuditService],
  exports: [BuildingsService, ProjectPhaseService],
})
export class BuildingsModule {}
