import {
  Controller, Get, Post, Put, Delete, Param, Body, Query,
  UseGuards, UseInterceptors, ParseBoolPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { BuildingsService } from './buildings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';

@ApiTags('Buildings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('buildings')
export class BuildingsController {
  constructor(private service: BuildingsService) {}

  @Get()
  @RequirePermissions('building:view')
  @ApiOperation({ summary: 'List buildings by project' })
  findByProject(@Query('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get(':id')
  @RequirePermissions('building:view')
  @ApiOperation({ summary: 'Get building by ID with units' })
  findById(@Param('id') id: string) {
    return this.service.findById(id);
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
  @ApiOperation({ summary: 'Delete building (blocked if units exist unless force=true)' })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  delete(
    @Param('id') id: string,
    @Query('force', new DefaultValuePipe(false), ParseBoolPipe) force: boolean,
  ) {
    return this.service.delete(id, force);
  }
}
