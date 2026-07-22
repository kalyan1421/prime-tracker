import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExceptionsService } from './exceptions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions, CurrentUser } from '../../common/decorators';

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
  constructor(private exceptions: ExceptionsService) {}

  @Get()
  @RequirePermissions('project:view')
  list(
    @CurrentUser('permissions') perms: string[],
    @Query('projectId') projectId?: string,
  ) {
    return projectId
      ? this.exceptions.forProject(projectId, perms ?? [])
      : this.exceptions.forPortfolio(perms ?? []);
  }
}
