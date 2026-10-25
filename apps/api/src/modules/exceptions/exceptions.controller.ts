import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExceptionsService } from './exceptions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions, CurrentUser } from '../../common/decorators';
import { ProjectAccessService, ScopedUser } from '../../common/access/project-access.service';

/**
 * GET /api/exceptions          → portfolio-wide exception feed
 * GET /api/exceptions?projectId=:id  → per-project feed
 *
 * Read-only; cached 60s. Drives the dashboard "Needs Attention" panel and
 * the per-project Overview tab exception list.
 *
 * The feed surfaces lender/buyer/tenant names, so it requires the baseline
 * `project:view` permission (PermissionsGuard) and the service further filters
 * draw/sale/lease items by the viewer's own permissions.
 */
@ApiTags('Exceptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@Controller('exceptions')
export class ExceptionsController {
  constructor(
    private exceptions: ExceptionsService,
    private access: ProjectAccessService,
  ) {}

  @Get()
  @RequirePermissions('project:view')
  async list(
    @CurrentUser('permissions') perms: string[],
    @CurrentUser() user: ScopedUser,
    @Query('projectId') projectId?: string,
  ) {
    if (projectId) return this.exceptions.forProject(projectId, perms ?? []);
    // "Portfolio" for a scoped field role is its member projects, not the whole book —
    // the feed names buyers, tenants and lenders.
    const scope = await this.access.listProjectScope({ userId: user.sub, role: user.role, roles: user.roles });
    return scope
      ? this.exceptions.forProjects(scope, perms ?? [])
      : this.exceptions.forPortfolio(perms ?? []);
  }
}
