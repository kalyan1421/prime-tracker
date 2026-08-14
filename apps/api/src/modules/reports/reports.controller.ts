import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get('portfolio')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Executive portfolio summary across all projects' })
  getPortfolio() { return this.service.getPortfolioSummary(); }

  @Get('sales-summary')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Sales pipeline analytics across all projects' })
  getSalesSummary() { return this.service.getSalesSummary(); }

  @Get('revenue')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Revenue & leasing report across all projects' })
  getRevenue() { return this.service.getRevenueSummary(); }

  @Get('debt')
  @RequirePermissions('loan:view')
  @ApiOperation({ summary: 'Debt & financing summary across all projects' })
  getDebt() { return this.service.getDebtSummary(); }

  @Get('unit-sales')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Unit sales value breakdown by project and building' })
  getUnitSales() { return this.service.getUnitSalesReport(); }

  // `financial:view` matches /reports/portfolio — this is the same class of money data
  // (commitment vs spend), just the isolated fit-out side of it. `interior:view` is the
  // operational (phase/snag) permission and is deliberately NOT what gates this.
  @Get('interior')
  @RequirePermissions('financial:view')
  @ApiOperation({
    summary: 'Interior / TI fit-out summary — committed vs invoiced vs remaining, per project',
  })
  getInterior(@Query('projectId') projectId?: string) {
    return this.service.getInteriorSummary({ projectId });
  }

  @Get('vacancy')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Vacancy report — available units ranked by time-on-market' })
  getVacancy(
    @Query('projectId') projectId?: string,
    @Query('minDays') minDays?: string,
  ) {
    return this.service.getVacancyReport({
      projectId,
      minDays: minDays ? parseInt(minDays, 10) : undefined,
    });
  }
}
