import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CashFlowService } from './cashflow.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { ProjectAccessService, ScopedUser } from '../../common/access/project-access.service';
import { CreateCashFlowEntryDto, UpdateCashFlowEntryDto } from './dto/cashflow-entry.dto';

@ApiTags('CashFlow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('cashflow')
export class CashFlowController {
  constructor(
    private service: CashFlowService,
    private access: ProjectAccessService,
  ) {}

  @Get()
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'List cash flow entries for a project' })
  async findByProject(@Query('projectId') projectId: string, @CurrentUser() user: ScopedUser) {
    return this.service.findByProject(await this.access.projectIdFilter(user, projectId));
  }

  @Get('forecast')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Unified cash flow forecast for one project (all sources, monthly)' })
  getForecast(
    @Query('projectId') projectId: string,
    @CurrentUser() user: ScopedUser,
    @Query('months') months?: string,
  ) {
    const horizon = months ? parseInt(months, 10) : undefined;
    // With no projectId the engine spans every project — which is the portfolio forecast,
    // so it goes through the path that already narrows a scoped role to its projects.
    return projectId
      ? this.service.getForecast(projectId, horizon)
      : this.service.getPortfolioForecast({ userId: user.sub, role: user.role, roles: user.roles }, horizon);
  }

  @Get('portfolio')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Portfolio-wide cash flow forecast across the viewer\'s projects' })
  getPortfolio(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('roles') roles: string[],
    @Query('months') months?: string,
  ) {
    return this.service.getPortfolioForecast({ userId, role, roles }, months ? parseInt(months, 10) : undefined);
  }

  @Get('obligations')
  @RequirePermissions('budget:view')
  @ApiOperation({ summary: 'Budget cash-needs by category (Loan/Sub-AP/TI/Commissions/Misc), M/Q/A' })
  getObligations(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('roles') roles: string[],
    @Query('projectId') projectId?: string,
    @Query('granularity') granularity?: 'month' | 'quarter' | 'year',
  ) {
    return this.service.getObligations({ userId, role, roles }, { projectId, granularity });
  }

  @Post()
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Create cash flow entry' })
  create(@Body() body: CreateCashFlowEntryDto, @Request() req: any) {
    return this.service.create(body, req.user.sub);
  }

  @Put(':id')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Update cash flow entry' })
  update(@Param('id') id: string, @Body() body: UpdateCashFlowEntryDto) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Delete cash flow entry' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
