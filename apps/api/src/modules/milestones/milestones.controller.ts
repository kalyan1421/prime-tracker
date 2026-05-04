import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MilestonesService } from './milestones.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';

@ApiTags('Milestones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('milestones')
export class MilestonesController {
  constructor(private service: MilestonesService) {}

  @Get()
  @RequirePermissions('milestone:view')
  @ApiOperation({ summary: 'List milestones by project (includes owner)' })
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get(':id')
  @RequirePermissions('milestone:view')
  @ApiOperation({ summary: 'Get milestone by ID' })
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('milestone:edit')
  @ApiOperation({ summary: 'Create milestone' })
  create(@Body() body: CreateMilestoneDto) { return this.service.create(body as any); }

  @Put(':id')
  @RequirePermissions('milestone:edit')
  @ApiOperation({ summary: 'Update milestone (auto-sets completedAt on first completion only)' })
  update(@Param('id') id: string, @Body() body: UpdateMilestoneDto) { return this.service.update(id, body as any); }

  @Delete(':id')
  @RequirePermissions('milestone:edit')
  @ApiOperation({ summary: 'Delete milestone' })
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
