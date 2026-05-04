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

  @Get()
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'List leads (optionally filtered by project/status/assignee)' })
  findAll(
    @Query('projectId') projectId?: string,
    @Query('status') status?: LeadStatus,
    @Query('assignedTo') assignedTo?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll({ projectId, status, assignedTo, search });
  }

  @Get(':id')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Get a single lead with activities' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Create a new lead' })
  create(
    @Body() body: {
      projectId: string;
      name?: string;
      email?: string;
      phone?: string;
      source: LeadSource;
      status?: LeadStatus;
      unitInterest?: string;
      budget?: number;
      notes?: string;
      assignedTo?: string;
    },
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.create({ ...body, createdBy: userId });
  }

  @Put(':id')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Update a lead' })
  update(
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      email?: string;
      phone?: string;
      source?: LeadSource;
      status?: LeadStatus;
      unitInterest?: string;
      budget?: number;
      notes?: string;
      assignedTo?: string;
    },
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('unit:manage')
  @ApiOperation({ summary: 'Delete a lead' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  // ---- Activities ----

  @Get(':id/activities')
  @RequirePermissions('unit:view')
  @ApiOperation({ summary: 'Get activity timeline for a lead' })
  getActivities(@Param('id') id: string) {
    return this.service.getActivities(id);
  }

  @Post(':id/activities')
  @RequirePermissions('unit:view')
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
  @RequirePermissions('sale:manage')
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
