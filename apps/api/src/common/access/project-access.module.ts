import { Global, Module } from '@nestjs/common';
import { ProjectAccessService } from './project-access.service';
import { ProjectAccessGuard } from './project-access.guard';

/**
 * Global so any controller can list ProjectAccessGuard in @UseGuards and any service
 * can inject ProjectAccessService for cross-project member filtering.
 */
@Global()
@Module({
  providers: [ProjectAccessService, ProjectAccessGuard],
  exports: [ProjectAccessService, ProjectAccessGuard],
})
export class ProjectAccessModule {}
