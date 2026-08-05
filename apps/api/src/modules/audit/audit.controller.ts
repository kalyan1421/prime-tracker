import { Controller, Get, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuditService } from '../../common/utils/audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit')
export class AuditController {
  constructor(private auditService: AuditService) {}

  // Declared before @Get() has no bearing here (distinct paths), but keep it above the
  // list route so the filter endpoint stays visible next to what it feeds.
  @Get('filters')
  @RequirePermissions('audit:view')
  @ApiOperation({ summary: 'Distinct actions/entities/actors present in the log, with counts' })
  filterOptions() {
    return this.auditService.filterOptions();
  }

  @Get()
  @RequirePermissions('audit:view')
  @ApiOperation({ summary: 'List audit events (filter: action, entity, userId, dateRange)' })
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('userId') userId?: string,
    @Query('entity') entity?: string,
    @Query('action') action?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.auditService.findAll({
      page,
      limit,
      userId,
      entity,
      action,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }
}
