import { Controller, Get, UseGuards, UseInterceptors, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { CurrentUser } from '../../common/decorators/index';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Get('founder')
  @RequirePermissions('unit:view')
  getFounder(@CurrentUser('role') role: string) {
    if (!['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'].includes(role)) throw new ForbiddenException();
    return this.service.getFounderDashboard();
  }

  @Get('construction')
  @RequirePermissions('unit:view')
  getConstruction(@CurrentUser('role') role: string) {
    if (!['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER', 'CONSTRUCTION'].includes(role)) throw new ForbiddenException();
    return this.service.getConstructionDashboard(role);
  }

  @Get('sales')
  @RequirePermissions('unit:view')
  getSales(@CurrentUser('role') role: string) {
    if (!['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'SALES', 'MARKETING'].includes(role)) throw new ForbiddenException();
    return this.service.getSalesDashboard();
  }
}
