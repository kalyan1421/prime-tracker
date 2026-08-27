import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query,
  UseGuards, UseInterceptors, ParseBoolPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UnitsService } from './units.service';
import { UnitHistoryService } from './unit-history.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { UpdateUnitStatusDto } from './dto/update-unit-status.dto';
import { UpdateSiteTrackerDto, SetUnitAssigneesDto } from './dto/site-tracker.dto';
import { UserRole } from '@prisma/client';

@ApiTags('Units')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('units')
export class UnitsController {
  constructor(
    private service: UnitsService,
    private history: UnitHistoryService,
  ) {}

  @Get('lease-income')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Get monthly lease income for a project' })
  getLeaseIncome(@Query('projectId') projectId: string) {
    return this.service.getMonthlyLeaseIncome(projectId);
  }

  @Get('inventory')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Cross-project unit inventory with optional filters' })
  findInventory(
    @Query('status') status?: string,
    @Query('unitType') unitType?: string,
    @Query('projectId') projectId?: string,
    @Query('search') search?: string,
    @CurrentUser('sub') userId?: string,
    @CurrentUser('role') role?: string,
    @CurrentUser('roles') roles?: string[],
    @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.service.findInventory({
      status: status as any,
      unitType,
      projectId,
      search,
      viewer: userId && role ? { userId, role, roles } : undefined,
      viewerPermissions: permissions ?? [],
    });
  }

  @Get()
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'List units by project or building' })
  findByProject(
    @Query('projectId') projectId: string,
    @Query('buildingId') buildingId?: string,
    @CurrentUser('permissions') permissions?: string[],
  ) {
    if (buildingId) return this.service.findByBuilding(buildingId, permissions ?? []);
    return this.service.findByProject(projectId, permissions ?? []);
  }

  @Get(':id')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Get unit by ID with leases and sales' })
  findById(@Param('id') id: string, @CurrentUser('permissions') permissions?: string[]) {
    return this.service.findById(id, permissions ?? []);
  }

  // Registered after `@Get(':id')` is fine — Nest matches the more specific literal
  // segment first regardless of declaration order for non-conflicting suffixes.
  @Get(':id/history')
  @RequirePermissions('unit:view')
  @ApiOperation({
    summary: "The unit's occupancy history — tenancies, sales, and vacancy windows",
    description:
      'Vacancy is computed from the unit_status_events log rather than inferred from ' +
      'gaps between leases, so the vacancy before the first lease and the one ' +
      'currently open both appear.',
  })
  getHistory(@Param('id') id: string, @CurrentUser('permissions') permissions?: string[]) {
    return this.history.getHistory(id, permissions ?? []);
  }

  @Post()
  @RequirePermissions('unit:edit')
  @ApiOperation({ summary: 'Create unit' })
  create(@Body() body: CreateUnitDto) {
    return this.service.create(body);
  }

  @Post('combine')
  @RequirePermissions('unit:edit')
  @ApiOperation({ summary: 'Combine 2+ adjacent units into one legal unit (sources archived, history kept)' })
  combine(
    @Body() body: { buildingId: string; sourceUnitIds: string[]; unitNumber: string; unitType?: string; notes?: string },
    @CurrentUser('role') userRole: UserRole,
  ) {
    return this.service.combine(body, userRole);
  }

  // Gated on the narrower `unit:editBuild`, not `unit:edit`. CONSTRUCTION owns the
  // physical facts of a unit (number, type, size, notes) and was previously unable to
  // correct any of them, while `unit:edit` also carries asking price and asking rent.
  // Every role holding `unit:edit` also holds `unit:editBuild`, so this only widens who
  // reaches the route; update() then rejects the commercial fields for callers without
  // `unit:edit`, which is where the actual restriction lives.
  @Put(':id')
  @RequirePermissions('unit:editBuild')
  @ApiOperation({ summary: 'Update unit (Sales: status/notes only; without unit:edit: build fields only)' })
  update(
    @Param('id') id: string,
    @Body() body: UpdateUnitDto,
    @CurrentUser('role') userRole: UserRole,
    @CurrentUser('permissions') permissions: string[],
    @CurrentUser('sub') userId?: string,
  ) {
    return this.service.update(id, body, userRole, userId, permissions ?? []);
  }

  @Patch(':id/status')
  @RequirePermissions('unit:edit')
  @ApiOperation({ summary: 'Update unit status only (state-machine enforced)' })
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateUnitStatusDto,
    @CurrentUser('role') userRole: UserRole,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.service.updateStatus(id, body.status, userRole, userId);
  }

  // Site Tracker (Phase 1). `siteTracker:edit`, NOT `unit:edit` — CONSTRUCTION holds the
  // former and not the latter, which is the right way round for a blocker flag.
  // ProjectAccessGuard covers these automatically: UnitsController's `:id` resolves to the
  // unit's project (project-access.service.ts CONTROLLER_ID_ENTITY).
  @Patch(':id/site-tracker')
  @RequirePermissions('siteTracker:edit')
  @ApiOperation({ summary: 'Set blocker / site priority / work type on a unit' })
  updateSiteTracker(
    @Param('id') id: string,
    @Body() body: UpdateSiteTrackerDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.service.updateSiteTracker(id, body, userId);
  }

  @Put(':id/assignees')
  @RequirePermissions('siteTracker:edit')
  @ApiOperation({ summary: 'Replace the unit\'s site owners (multi-assign; [] clears)' })
  setAssignees(
    @Param('id') id: string,
    @Body() body: SetUnitAssigneesDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.service.setAssignees(id, body.userIds, userId);
  }

  @Delete(':id')
  @RequirePermissions('unit:edit')
  @ApiOperation({ summary: 'Archive (soft-delete) a unit — blocked if leases/sales exist unless force=true' })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  delete(
    @Param('id') id: string,
    @CurrentUser('role') userRole: UserRole,
    @Query('force', new DefaultValuePipe(false), ParseBoolPipe) force: boolean,
  ) {
    return this.service.delete(id, userRole, force);
  }
}
