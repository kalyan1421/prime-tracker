import { Module } from '@nestjs/common';
import { ProjectHealthService } from './project-health.service';
import { ProjectHealthController } from './project-health.controller';
@Module({
  controllers: [ProjectHealthController],
  providers: [ProjectHealthService],
  exports: [ProjectHealthService],
})
export class ProjectHealthModule {}
