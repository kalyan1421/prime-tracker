import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProjectHealthService } from './project-health.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { ProjectAccessService } from '../../common/access/project-access.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions, CurrentUser } from '../../common/decorators';

@ApiTags('Project Health')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@Controller('projects')
export class ProjectHealthController {
  constructor(
    private health: ProjectHealthService,
    private access: ProjectAccessService,
  ) {}

  // The single-project route resolves its `:id` through ProjectAccessGuard, so a scoped
  // field role hitting a project they aren't a member of already gets a 404.
  @Get(':id/health')
  @RequirePermissions('project:view')
  getOne(@Param('id') id: string) {
    return this.health.score(id);
  }

  /**
   * Bulk endpoint used by /projects list page so it can fetch all scores in
   * one request instead of N individual calls. Pass IDs as ?ids=a,b,c.
   *
   * The `ids` CSV isn't a key ProjectAccessGuard resolves, so we scope here: a field
   * role only gets scores for projects they're a member of (silently dropping the rest),
   * matching how the projects list itself is filtered. Non-scoped roles are unrestricted.
   */
  @Get('health/bulk')
  @RequirePermissions('project:view')
  async getBulk(
    @Query('ids') idsCsv: string,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    if (!idsCsv) return {};
    let ids = idsCsv.split(',').filter(Boolean);
    const scope = await this.access.listProjectScope({ userId: user.sub, role: user.role });
    if (scope !== undefined) {
      const allowed = new Set(scope);
      ids = ids.filter((id) => allowed.has(id));
    }
    if (ids.length === 0) return {};
    return this.health.scoreMany(ids);
  }
}
