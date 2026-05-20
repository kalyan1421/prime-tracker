import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { LeadStatus, LeadSource, LeadActivityType } from '@prisma/client';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('leads')
export class LeadsController {
  constructor(private service: LeadsService) {}

  @Get('dashboard')
  @RequirePermissions('lead:view')
  @ApiOperation({ summary: 'Aggregated dashboard: funnel, sources, stale, recent activity, attribution health' })
  dashboard(@Query('projectId') projectId?: string) {
    return this.service.dashboard({ projectId });
  }

  @Get()
  @RequirePermissions('lead:view')
  @ApiOperation({ summary: 'List leads (optionally filtered by project/status/assignee/unit)' })
  findAll(
    @Query('projectId') projectId?: string,
    @Query('status') status?: LeadStatus,
    @Query('assignedTo') assignedTo?: string,
    @Query('unitId') unitId?: string,
    @Query('buildingId') buildingId?: string,
    @Query('campaignId') campaignId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll({ projectId, status, assignedTo, unitId, buildingId, campaignId, search });
  }

  @Get(':id')
  @RequirePermissions('lead:view')
  @ApiOperation({ summary: 'Get a single lead with activities' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @RequirePermissions('lead:create')
  @ApiOperation({ summary: 'Create a new lead' })
  create(
    @Body() body: {
      projectId: string;
      name?: string;
      email?: string;
      phone?: string;
      source: LeadSource;
      status?: LeadStatus;
      unitId?: string;
      buildingId?: string;
      unitInterest?: string;
      budget?: number;
      notes?: string;
      assignedTo?: string;
      // Sprint 2 — campaign attribution
      campaignId?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmContent?: string;
    },
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.create({ ...body, createdBy: userId });
  }

  @Put(':id')
  @RequirePermissions('lead:edit')
  @ApiOperation({ summary: 'Update a lead' })
  update(
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      email?: string;
      phone?: string;
      source?: LeadSource;
      status?: LeadStatus;
      unitId?: string | null;
      buildingId?: string | null;
      unitInterest?: string;
      budget?: number;
      notes?: string;
      assignedTo?: string;
    },
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
    @Body() body: { type: LeadActivityType; note: string },
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.addActivity(leadId, userId, body.type, body.note);
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
