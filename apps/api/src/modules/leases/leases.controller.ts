import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LeasesService } from './leases.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { CreateLeaseDto, UpdateLeaseDto } from './dto/create-lease.dto';

@ApiTags('Leases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('leases')
export class LeasesController {
  constructor(private service: LeasesService) {}

  @Get()
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'List leases by project' })
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get('rent-roll')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Active leases rent roll with total monthly rent' })
  getRentRoll(@Query('projectId') projectId: string) { return this.service.getRentRoll(projectId); }

  @Get(':id')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Get lease by ID' })
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Create lease' })
  create(@Body() body: CreateLeaseDto) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Update lease' })
  update(@Param('id') id: string, @Body() body: UpdateLeaseDto) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Delete lease' })
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
