import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, AuditService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
