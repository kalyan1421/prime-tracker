import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query,
  UseGuards, UseInterceptors, ParseBoolPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UnitsService } from './units.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { UpdateUnitStatusDto } from './dto/update-unit-status.dto';
import { UserRole } from '@prisma/client';

@ApiTags('Units')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('units')
export class UnitsController {
  constructor(private service: UnitsService) {}

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
  ) {
    return this.service.findInventory({ status: status as any, unitType, projectId, search, viewer: userId && role ? { userId, role, roles } : undefined });
  }

  @Get()
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'List units by project or building' })
  findByProject(
    @Query('projectId') projectId: string,
    @Query('buildingId') buildingId?: string,
  ) {
    if (buildingId) return this.service.findByBuilding(buildingId);
    return this.service.findByProject(projectId);
  }

  @Get(':id')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Get unit by ID with leases and sales' })
  findById(@Param('id') id: string) {
    return this.service.findById(id);
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

  @Put(':id')
  @RequirePermissions('unit:edit')
  @ApiOperation({ summary: 'Update unit (Sales role: status only)' })
  update(
    @Param('id') id: string,
    @Body() body: UpdateUnitDto,
    @CurrentUser('role') userRole: UserRole,
  ) {
    return this.service.update(id, body, userRole);
  }

  @Patch(':id/status')
  @RequirePermissions('unit:edit')
  @ApiOperation({ summary: 'Update unit status only (state-machine enforced)' })
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateUnitStatusDto,
    @CurrentUser('role') userRole: UserRole,
  ) {
    return this.service.updateStatus(id, body.status, userRole);
  }

  @Delete(':id')
  @RequirePermissions('unit:edit')
  @ApiOperation({ summary: 'Delete unit (blocked if leases/sales exist unless force=true)' })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  delete(
    @Param('id') id: string,
    @CurrentUser('role') userRole: UserRole,
    @Query('force', new DefaultValuePipe(false), ParseBoolPipe) force: boolean,
  ) {
    return this.service.delete(id, userRole, force);
  }
}
