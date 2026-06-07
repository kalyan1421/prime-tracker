import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CashFlowService } from './cashflow.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';

@ApiTags('CashFlow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('cashflow')
export class CashFlowController {
  constructor(private service: CashFlowService) {}

  @Get()
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'List cash flow entries for a project' })
  findByProject(@Query('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get('forecast')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Unified cash flow forecast for one project (all sources, monthly)' })
  getForecast(@Query('projectId') projectId: string, @Query('months') months?: string) {
    return this.service.getForecast(projectId, months ? parseInt(months, 10) : undefined);
  }

  @Get('portfolio')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Portfolio-wide cash flow forecast across the viewer\'s projects' })
  getPortfolio(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @Query('months') months?: string,
  ) {
    return this.service.getPortfolioForecast({ userId, role }, months ? parseInt(months, 10) : undefined);
  }

  @Get('obligations')
  @RequirePermissions('budget:view')
  @ApiOperation({ summary: 'Budget cash-needs by category (Loan/Sub-AP/TI/Commissions/Misc), M/Q/A' })
  getObligations(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @Query('projectId') projectId?: string,
    @Query('granularity') granularity?: 'month' | 'quarter' | 'year',
  ) {
    return this.service.getObligations({ userId, role }, { projectId, granularity });
  }

  @Post()
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Create cash flow entry' })
  create(@Body() body: any, @Request() req: any) {
    return this.service.create(body, req.user.sub);
  }

  @Put(':id')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Update cash flow entry' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Delete cash flow entry' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
