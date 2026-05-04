import { Controller, Get, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { KpiService } from './kpi.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('KPI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('kpi')
export class KpiController {
  constructor(private service: KpiService) {}

  @Get('latest')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Get latest KPI snapshot for project' })
  getLatest(@Query('projectId') projectId: string) { return this.service.getLatest(projectId); }

  @Get('history')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Get KPI history time series' })
  getHistory(@Query('projectId') projectId: string, @Query('months') months?: number) {
    return this.service.getHistory(projectId, months);
  }

  @Post('snapshot')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Calculate and store KPI snapshot' })
  createSnapshot(@Query('projectId') projectId: string) { return this.service.createSnapshot(projectId); }
}
