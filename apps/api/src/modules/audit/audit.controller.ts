import { Controller, Get, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuditService } from '../../common/utils/audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';

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

  /**
   * The Activity Log shown in the Updates section — deliberately NOT gated on
   * `audit:view` like the routes around it. It is safe to open this wide because the
   * service drops every entity the caller cannot read and never returns the
   * oldValues/newValues payloads; see AuditService.activityFeed.
   */
  @Get('activity')
  @RequirePermissions('updateBoard:view')
  @ApiOperation({ summary: 'Cross-module activity feed, filtered to what the viewer may read' })
  activity(
    @CurrentUser('permissions') permissions: string[],
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('userId') userId?: string,
    @Query('area') area?: string,
  ) {
    return this.auditService.activityFeed(
      { page, limit, userId, area },
      { permissions: permissions ?? [] },
    );
  }

  @Get('activity/actors')
  @RequirePermissions('updateBoard:view')
  @ApiOperation({ summary: 'People who appear in the activity the viewer can see' })
  activityActors(@CurrentUser('permissions') permissions: string[]) {
    return this.auditService.activityActors({ permissions: permissions ?? [] });
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
