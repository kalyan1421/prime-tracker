import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import {
  AddLeadActivityDto, CreateLeadDto, LeadCommentDto, UpdateLeadDto,
} from './dto/lead.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { LeadSource, LeadActivityType } from '@prisma/client';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('leads')
export class LeadsController {
  constructor(private service: LeadsService) {}

  @Get('dashboard')
  @RequirePermissions('lead:view')
  @ApiOperation({ summary: 'Aggregated dashboard: funnel, sources, stale, recent activity, attribution health' })
  dashboard(
    @Query('projectId') projectId?: string,
    @CurrentUser('sub') userId?: string,
    @CurrentUser('role') role?: string,
    @CurrentUser('roles') roles?: string[],
  ) {
    return this.service.dashboard({ projectId, viewer: userId && role ? { userId, role, roles } : undefined });
  }

  @Get()
  @RequirePermissions('lead:view')
  @ApiOperation({ summary: 'List leads (optionally filtered by project/status/assignee/unit/broker)' })
  findAll(
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('unassigned') unassigned?: string,
    @Query('unitId') unitId?: string,
    @Query('buildingId') buildingId?: string,
    @Query('campaignId') campaignId?: string,
    @Query('brokerId') brokerId?: string,
    @Query('source') source?: string,
    @Query('via') via?: string,
    @Query('followUpBefore') followUpBefore?: string,
    @Query('search') search?: string,
    @CurrentUser('sub') userId?: string,
    @CurrentUser('role') role?: string,
    @CurrentUser('roles') roles?: string[],
  ) {
    return this.service.findAll({
      projectId, status, assignedTo,
      unassigned: unassigned === 'true' || unassigned === '1',
      unitId, buildingId, campaignId, brokerId, source, via, followUpBefore, search,
      viewer: userId && role ? { userId, role, roles } : undefined,
    });
  }

  @Get('waitlist')
  @RequirePermissions('lead:view')
  @ApiOperation({ summary: 'Per-unit waitlist — leads interested in a unit (oldest first)' })
  waitlist(@Query('unitId') unitId: string) {
    return this.service.unitWaitlist(unitId);
  }

  @Get(':id')
  @RequirePermissions('lead:view')
  @ApiOperation({ summary: 'Get a single lead with activities + units of interest' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  // Tighten the per-minute limit to 5 on lead creation (the global 'medium' is
  // 100/min). This is the intake path the public website will reuse via
  // /api/public/leads, so it needs to resist enquiry-form spam bursts.
  @Throttle({ medium: { limit: 5, ttl: 60_000 } })
  @RequirePermissions('lead:create')
  @ApiOperation({ summary: 'Create a new lead' })
  create(
    @Body() body: CreateLeadDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.create({ ...body, createdBy: userId });
  }

  @Put(':id')
  @RequirePermissions('lead:edit')
  @ApiOperation({ summary: 'Update a lead' })
  update(
    @Param('id') id: string,
    @Body() body: UpdateLeadDto,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('lead:delete')
  @ApiOperation({ summary: 'Delete a lead' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  // ---- Activities ----

  @Get(':id/activities')
  @RequirePermissions('lead:view')
  @ApiOperation({ summary: 'Get activity timeline for a lead' })
  getActivities(@Param('id') id: string) {
    return this.service.getActivities(id);
  }

  @Post(':id/activities')
  @RequirePermissions('lead:edit')
  @ApiOperation({ summary: 'Add an activity to a lead' })
  addActivity(
    @Param('id') leadId: string,
    @Body() body: AddLeadActivityDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.addActivity(leadId, userId, body.type, body.note, body.occurredAt);
  }

  // ---- Discussion thread ----
  //
  // Gated on lead:view / lead:edit rather than a new permission: discussing a lead is the
  // same work as working it, unlike approving a site visit which is a leadership act.

  @Get(':id/comments')
  @RequirePermissions('lead:view')
  @ApiOperation({ summary: 'Discussion thread for a lead (oldest first)' })
  getComments(@Param('id') id: string) {
    return this.service.getComments(id);
  }

  @Post(':id/comments')
  @RequirePermissions('lead:edit')
  @ApiOperation({ summary: 'Post to the thread. @mentions in the body notify those users.' })
  addComment(
    @Param('id') id: string,
    @Body() body: LeadCommentDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.addComment(id, userId, body.content);
  }

  @Put('comments/:commentId')
  @RequirePermissions('lead:edit')
  @ApiOperation({ summary: 'Edit your own comment' })
  updateComment(
    @Param('commentId') commentId: string,
    @Body() body: LeadCommentDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.updateComment(commentId, userId, body.content);
  }

  @Delete('comments/:commentId')
  @RequirePermissions('lead:edit')
  @ApiOperation({ summary: 'Delete your own comment' })
  deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.deleteComment(commentId, userId);
  }

  @Get(':id/calls')
  @RequirePermissions('lead:view')
  @ApiOperation({ summary: 'Call count, last call with its note, and a per-date activity roll-up' })
  getCalls(@Param('id') id: string) {
    return this.service.getCalls(id);
  }

  // ---- Multi-unit interest / waitlist ----

  @Post(':id/interests')
  @RequirePermissions('lead:edit')
  @ApiOperation({ summary: 'Add a unit of interest to a lead' })
  addInterest(@Param('id') leadId: string, @Body() body: { unitId: string; note?: string }) {
    return this.service.addInterest(leadId, body.unitId, body.note);
  }

  @Delete('interests/:interestId')
  @RequirePermissions('lead:edit')
  @ApiOperation({ summary: 'Remove a unit of interest (by join-row id)' })
  removeInterest(@Param('interestId') interestId: string) {
    return this.service.removeInterest(interestId);
  }

  // ---- Convert to Sale ----

  @Post(':id/convert')
  @RequirePermissions('lead:convert')
  @ApiOperation({ summary: 'Convert a lead to a sale' })
  convert(
    @Param('id') leadId: string,
    @Body() body: {
      unitId: string;
      buyer: string;
      salePrice: number;
      contractDate?: string;
      closingDate?: string;
    },
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.convertToSale(leadId, userId, body);
  }
}
