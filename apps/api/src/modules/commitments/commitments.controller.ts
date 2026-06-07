import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CommitmentsService } from './commitments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { CreateCommitmentDto, UpdateCommitmentDto } from './dto/create-commitment.dto';

@ApiTags('Commitments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('commitments')
export class CommitmentsController {
  constructor(private service: CommitmentsService) {}

  @Get()
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'List commitments (contracts/POs) by project' })
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get(':id')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Get commitment by ID' })
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Create commitment' })
  create(@Body() body: CreateCommitmentDto) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Update commitment (track paidToDate changes)' })
  update(@Param('id') id: string, @Body() body: UpdateCommitmentDto) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Delete commitment' })
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
