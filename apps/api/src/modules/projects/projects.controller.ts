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
import { AddMemberDto } from './dto/add-member.dto';
import { AddMembersBulkDto } from './dto/add-members-bulk.dto';

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
  getDashboard(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('roles') roles: string[],
    @CurrentUser('permissions') permissions: string[],
  ) {
    return this.projectsService.getDashboardSummary({
      userId,
      role,
      canViewFinancials: permissions?.includes('budget:view') ?? false,
    });
  }

  @Get()
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'List projects (paginated when page/pageSize provided)' })
  findAll(
    @Query() query: ListProjectsDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('roles') roles: string[],
  ) {
    const canViewArchived = role === 'SUPER_ADMIN' || role === 'FOUNDER';
    return this.projectsService.findAll(
      { ...query, archived: canViewArchived ? query.archived : undefined },
      { userId, role, roles },
    );
  }

  @Get('options')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Unscoped {id, name} list for cross-project attribution (e.g. lead capture)' })
  getOptions() {
    return this.projectsService.options();
  }

  @Get('slug/:slug')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Get project by slug' })
  findBySlug(
    @Param('slug') slug: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.projectsService.findBySlug(slug, { userId, role, roles });
  }

  @Get(':id/activity')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Project activity log (FOUNDER / SUPER_ADMIN only — enforced on frontend)' })
  getActivity(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.projectsService.getActivity(id, Number(page) || 1, Number(limit) || 60);
  }

  @Get(':id')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Get project by ID with all relations' })
  findById(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.projectsService.findById(id, { userId, role, roles });
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

  // Approved Budget (control total) is owned by Finance — gate on budget:edit, not project:edit.
  @Put(':id/approved-budget')
  @RequirePermissions('budget:edit')
  @ApiOperation({ summary: 'Set or clear the project approved budget (control total)' })
  setApprovedBudget(@Param('id') id: string, @Body() body: { approvedBudget: number | null }) {
    return this.projectsService.setApprovedBudget(id, body.approvedBudget ?? null);
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
    return this.projectsService.addMember(id, body.userId, body.role, body.roles);
  }

  @Post(':id/members/bulk')
  @RequirePermissions('project:edit')
  @ApiOperation({ summary: 'Add several team members to a project in one request' })
  addMembers(@Param('id') id: string, @Body() body: AddMembersBulkDto) {
    return this.projectsService.addMembers(id, body.members);
  }

  @Delete(':id/members/:userId')
  @RequirePermissions('project:edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a team member from a project' })
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.projectsService.removeMember(id, userId);
  }
}
