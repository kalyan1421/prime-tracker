import { Controller, Get, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { KpiService } from './kpi.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { ProjectAccessService, ScopedUser } from '../../common/access/project-access.service';

@ApiTags('KPI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('kpi')
export class KpiController {
  constructor(
    private service: KpiService,
    private access: ProjectAccessService,
  ) {}

  // Without a projectId these read across every project's snapshots; narrowed to the
  // caller's member projects like the other optional-projectId reads.
  @Get('latest')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Get latest KPI snapshot for project' })
  async getLatest(@Query('projectId') projectId: string, @CurrentUser() user: ScopedUser) {
    return this.service.getLatest(await this.access.projectIdFilter(user, projectId));
  }

  @Get('history')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Get KPI history time series' })
  async getHistory(
    @Query('projectId') projectId: string,
    @CurrentUser() user: ScopedUser,
    @Query('months') months?: number,
  ) {
    return this.service.getHistory(await this.access.projectIdFilter(user, projectId), months);
  }

  @Post('snapshot')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Calculate and store KPI snapshot' })
  createSnapshot(@Query('projectId') projectId: string) { return this.service.createSnapshot(projectId); }
}
