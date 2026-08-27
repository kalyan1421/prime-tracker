import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query,
  UseGuards, UseInterceptors, ParseBoolPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { BuildingsService } from './buildings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { ReorderBuildingsDto } from './dto/reorder-buildings.dto';

@ApiTags('Buildings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('buildings')
export class BuildingsController {
  constructor(private service: BuildingsService) {}

  @Get()
  @RequirePermissions('building:view')
  @ApiOperation({
    summary: 'List buildings by project',
    description:
      'Each row carries `blastRadius: { units, leases, sales, loans }` — the live records that ' +
      'would go dark if the building were archived, counting both direct attachments and everything ' +
      'under its units. Intended for the delete-confirmation dialog.',
  })
  findByProject(@Query('projectId') projectId: string, @CurrentUser('permissions') permissions?: string[]) {
    return this.service.findByProject(projectId, permissions ?? []);
  }

  @Patch('reorder')
  @RequirePermissions('building:edit')
  @ApiOperation({ summary: 'Persist a new building display order within a project' })
  reorder(@Body() body: ReorderBuildingsDto) {
    return this.service.reorder(body.projectId, body.buildingIds);
  }

  @Get(':id')
  @RequirePermissions('building:view')
  @ApiOperation({ summary: 'Get building by ID with units (includes `blastRadius`)' })
  findById(@Param('id') id: string, @CurrentUser('permissions') permissions?: string[]) {
    return this.service.findById(id, permissions ?? []);
  }

  @Post()
  @RequirePermissions('building:edit')
  @ApiOperation({ summary: 'Create building' })
  create(@Body() body: CreateBuildingDto) {
    return this.service.create(body);
  }

  @Put(':id')
  @RequirePermissions('building:edit')
  @ApiOperation({ summary: 'Update building' })
  update(@Param('id') id: string, @Body() body: UpdateBuildingDto) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('building:edit')
  @ApiOperation({ summary: 'Archive (soft-delete) a building and its units — blocked if units exist unless force=true' })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  delete(
    @Param('id') id: string,
    @Query('force', new DefaultValuePipe(false), ParseBoolPipe) force: boolean,
  ) {
    return this.service.delete(id, force);
  }
}
