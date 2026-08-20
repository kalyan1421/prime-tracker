import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  // All "across all projects" reports below are scoped server-side to the viewer's
  // member projects when they hold a project-scoped role (PM/Construction/Sales/
  // Marketing) — same as LeadsService/UnitsService. `viewer` is undefined for an
  // anonymous/malformed token, which ProjectAccessService treats as unrestricted;
  // JwtAuthGuard has already rejected those requests by this point regardless.
  private viewer(userId?: string, role?: string, roles?: string[]) {
    return userId && role ? { userId, role, roles } : undefined;
  }

  @Get('portfolio')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Executive portfolio summary across all projects' })
  getPortfolio(
    @CurrentUser('sub') userId?: string,
    @CurrentUser('role') role?: string,
    @CurrentUser('roles') roles?: string[],
  ) {
    return this.service.getPortfolioSummary(this.viewer(userId, role, roles));
  }

  @Get('sales-summary')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Sales pipeline analytics across all projects' })
  getSalesSummary(
    @CurrentUser('sub') userId?: string,
    @CurrentUser('role') role?: string,
    @CurrentUser('roles') roles?: string[],
  ) {
    return this.service.getSalesSummary(this.viewer(userId, role, roles));
  }

  @Get('revenue')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Revenue & leasing report across all projects' })
  getRevenue(
    @CurrentUser('sub') userId?: string,
    @CurrentUser('role') role?: string,
    @CurrentUser('roles') roles?: string[],
  ) {
    return this.service.getRevenueSummary(this.viewer(userId, role, roles));
  }

  @Get('debt')
  @RequirePermissions('loan:view')
  @ApiOperation({ summary: 'Debt & financing summary across all projects' })
  getDebt(
    @CurrentUser('sub') userId?: string,
    @CurrentUser('role') role?: string,
    @CurrentUser('roles') roles?: string[],
  ) {
    return this.service.getDebtSummary(this.viewer(userId, role, roles));
  }

  @Get('unit-sales')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Unit sales value breakdown by project and building' })
  getUnitSales(
    @CurrentUser('sub') userId?: string,
    @CurrentUser('role') role?: string,
    @CurrentUser('roles') roles?: string[],
  ) {
    return this.service.getUnitSalesReport(this.viewer(userId, role, roles));
  }

  // `financial:view` matches /reports/portfolio — this is the same class of money data
  // (commitment vs spend), just the isolated fit-out side of it. `interior:view` is the
  // operational (phase/snag) permission and is deliberately NOT what gates this.
  @Get('interior')
  @RequirePermissions('financial:view')
  @ApiOperation({
    summary: 'Interior / TI fit-out summary — committed vs invoiced vs remaining, per project',
  })
  getInterior(
    @Query('projectId') projectId?: string,
    @CurrentUser('sub') userId?: string,
    @CurrentUser('role') role?: string,
    @CurrentUser('roles') roles?: string[],
  ) {
    return this.service.getInteriorSummary({ projectId, viewer: this.viewer(userId, role, roles) });
  }

  @Get('vacancy')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Vacancy report — available units ranked by time-on-market' })
  getVacancy(
    @Query('projectId') projectId?: string,
    @Query('minDays') minDays?: string,
    @CurrentUser('sub') userId?: string,
    @CurrentUser('role') role?: string,
    @CurrentUser('roles') roles?: string[],
  ) {
    return this.service.getVacancyReport({
      projectId,
      minDays: minDays ? parseInt(minDays, 10) : undefined,
      viewer: this.viewer(userId, role, roles),
    });
  }
}
