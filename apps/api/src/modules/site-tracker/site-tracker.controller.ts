import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SiteTrackerService } from './site-tracker.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';

@ApiTags('Site Tracker')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('site-tracker')
export class SiteTrackerController {
  constructor(private service: SiteTrackerService) {}

  @Get()
  @RequirePermissions('siteTracker:view')
  @ApiOperation({ summary: 'Every tracked unit across all properties, with blocker, checklist progress and summary' })
  grid(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('permissions') permissions: string[],
    @CurrentUser('roles') roles?: string[],
    @Query('projectId') projectId?: string,
    @Query('buildingId') buildingId?: string,
    @Query('blockerStatus') blockerStatus?: string,
    @Query('sitePriority') sitePriority?: string,
    @Query('search') search?: string,
    @Query('includeUntracked') includeUntracked?: string,
  ) {
    return this.service.grid(
      { projectId, buildingId, blockerStatus, sitePriority, search,
        includeUntracked: includeUntracked === 'true' },
      { userId, role, roles, permissions: permissions ?? [] },
    );
  }
}
