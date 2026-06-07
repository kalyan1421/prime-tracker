import {
  Controller, Get, Post, Put, Delete, Param, Body, Query,
  UseGuards, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { IsOptional, IsString, MaxLength } from 'class-validator';

class AddMemberDto {
  @IsString() userId!: string;
  @IsOptional() @IsString() @MaxLength(64) role?: string;
}

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get('dashboard')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Executive dashboard summary' })
  getDashboard() {
    return this.projectsService.getDashboardSummary();
  }

  @Get()
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'List projects (paginated when page/pageSize provided)' })
  findAll(
    @Query() query: ListProjectsDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.projectsService.findAll(query, { userId, role });
  }

  @Get('slug/:slug')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Get project by slug' })
  findBySlug(
    @Param('slug') slug: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.projectsService.findBySlug(slug, { userId, role });
  }

  @Get(':id')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Get project by ID with all relations' })
  findById(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.projectsService.findById(id, { userId, role });
  }

  @Post()
  @RequirePermissions('project:create')
  @ApiOperation({ summary: 'Create project' })
  create(@Body() body: CreateProjectDto, @CurrentUser('sub') userId: string) {
    return this.projectsService.create(body, userId);
  }

  @Put(':id')
  @RequirePermissions('project:edit')
  @ApiOperation({ summary: 'Update project' })
  update(@Param('id') id: string, @Body() body: UpdateProjectDto) {
    return this.projectsService.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('project:delete')
  @ApiOperation({ summary: 'Archive project (soft-delete: status → CANCELLED)' })
  delete(@Param('id') id: string) {
    return this.projectsService.delete(id);
  }

  // ---- Team Members ----

  @Get(':id/members')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Get project team members' })
  getMembers(@Param('id') id: string) {
    return this.projectsService.getMembers(id);
  }

  @Post(':id/members')
  @RequirePermissions('project:edit')
  @ApiOperation({ summary: 'Add a team member to a project' })
  addMember(@Param('id') id: string, @Body() body: AddMemberDto) {
    return this.projectsService.addMember(id, body.userId, body.role);
  }

  @Delete(':id/members/:userId')
  @RequirePermissions('project:edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a team member from a project' })
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.projectsService.removeMember(id, userId);
  }
}
