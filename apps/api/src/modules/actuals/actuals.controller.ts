import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ActualsService } from './actuals.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { CreateActualDto, UpdateActualDto } from './dto/create-actual.dto';

@ApiTags('Actuals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('actuals')
export class ActualsController {
  constructor(private service: ActualsService) {}

  @Get()
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'List actuals by project' })
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get('unmapped')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'List unmapped QB transactions' })
  findUnmapped() { return this.service.findUnmapped(); }

  @Post()
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Create manual actual entry' })
  create(@Body() body: CreateActualDto) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Update actual (map unmapped to project/category)' })
  update(@Param('id') id: string, @Body() body: UpdateActualDto) { return this.service.update(id, body); }
}
