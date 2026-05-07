import { Module } from '@nestjs/common';
import { ProjectHealthService } from './project-health.service';
import { ProjectHealthController } from './health.controller';

/**
 * Project Health module — note the deliberate name conflict avoidance:
 * `apps/api/src/common/health` is the system /health endpoint (DB ping).
 * This module is `modules/health` and exposes /projects/:id/health.
 */
@Module({
  controllers: [ProjectHealthController],
  providers: [ProjectHealthService],
  exports: [ProjectHealthService],
})
export class ProjectHealthModule {}
