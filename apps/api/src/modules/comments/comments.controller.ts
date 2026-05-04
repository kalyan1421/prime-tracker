import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CommentType } from '@prisma/client';

@ApiTags('Comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('comments')
export class CommentsController {
  constructor(private service: CommentsService) {}

  @Get()
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'List comments for a unit or project' })
  findComments(
    @Query('unitId') unitId?: string,
    @Query('projectId') projectId?: string,
  ) {
    if (unitId) return this.service.findByUnit(unitId);
    if (projectId) return this.service.findByProject(projectId);
    return [];
  }

  @Get('recent')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Recent comments across all projects (grouped by type)' })
  findRecent(@Query('limit') limit?: string) {
    return this.service.findRecent(limit ? parseInt(limit) : 20);
  }

  @Post()
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Create comment on a unit or project' })
  create(
    @Body() body: { unitId?: string; projectId?: string; content: string; commentType?: CommentType },
    @CurrentUser('sub') userId: string,
  ) {
    if (body.unitId) {
      return this.service.createUnitComment(body.unitId, userId, body.content, body.commentType);
    }
    if (body.projectId) {
      return this.service.createProjectComment(body.projectId, userId, body.content, body.commentType);
    }
    return { error: 'Must provide unitId or projectId' };
  }

  @Put('unit/:id')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Update own unit comment' })
  updateUnit(
    @Param('id') id: string,
    @Body() body: { content: string },
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.updateUnitComment(id, userId, body.content);
  }

  @Put('project/:id')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Update own project comment' })
  updateProject(
    @Param('id') id: string,
    @Body() body: { content: string },
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.updateProjectComment(id, userId, body.content);
  }

  @Delete('unit/:id')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Delete own unit comment (or admin)' })
  deleteUnit(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.deleteUnitComment(id, userId, ['SUPER_ADMIN', 'FOUNDER'].includes(role));
  }

  @Delete('project/:id')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Delete own project comment (or admin)' })
  deleteProject(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.deleteProjectComment(id, userId, ['SUPER_ADMIN', 'FOUNDER'].includes(role));
  }
}
