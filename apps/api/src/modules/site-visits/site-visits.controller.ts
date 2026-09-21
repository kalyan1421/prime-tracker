import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SiteVisitsService } from './site-visits.service';
import { VisitAvailabilityService } from './visit-availability.service';
import {
  BulkAvailabilityDto, CreateAvailabilityDto, UpdateAvailabilityDto, CreateSiteVisitDto, DecideSiteVisitDto,
  RescheduleSiteVisitDto, CancelSiteVisitDto, OutcomeSiteVisitDto,
} from './dto/site-visit.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { PERMISSIONS } from '@prime-tracker/shared';

@ApiTags('Site Visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('site-visits')
export class SiteVisitsController {
  constructor(
    private service: SiteVisitsService,
    private availability: VisitAvailabilityService,
  ) {}

  @Get('attention')
  @RequirePermissions('siteVisit:view')
  @ApiOperation({ summary: 'Dashboard queue — pending decisions for approvers, own outstanding visits for everyone else' })
  attention(
    @CurrentUser('sub') userId: string,
    @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.service.attention({
      userId,
      canApprove: (permissions ?? []).includes(PERMISSIONS.SITE_VISIT_APPROVE),
    });
  }

  @Get()
  @RequirePermissions('siteVisit:view')
  @ApiOperation({ summary: 'List site visits' })
  findAll(
    @Query('status') status?: string,
    @Query('hostId') hostId?: string,
    @Query('leadId') leadId?: string,
    @Query('requestedById') requestedById?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll({ status, hostId, leadId, requestedById, from, to });
  }

  @Get(':id')
  @RequirePermissions('siteVisit:view')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @RequirePermissions('siteVisit:request')
  @ApiOperation({ summary: 'Book an open slot — created REQUESTED and holds the slot until decided' })
  create(@Body() body: CreateSiteVisitDto, @CurrentUser('sub') userId: string) {
    return this.service.create(body, userId);
  }

  @Post(':id/decide')
  @RequirePermissions('siteVisit:approve')
  @ApiOperation({ summary: 'Confirm or reject a requested visit. Rejecting requires a reason.' })
  decide(@Param('id') id: string, @Body() body: DecideSiteVisitDto, @CurrentUser('sub') userId: string) {
    return this.service.decide(id, body.confirmed, userId, body.decisionNote);
  }

  @Post(':id/reschedule')
  @RequirePermissions('siteVisit:request')
  @ApiOperation({ summary: 'Move a visit — closes the original as RESCHEDULED and creates a linked replacement' })
  reschedule(@Param('id') id: string, @Body() body: RescheduleSiteVisitDto, @CurrentUser('sub') userId: string) {
    return this.service.reschedule(id, body, userId);
  }

  @Post(':id/cancel')
  @RequirePermissions('siteVisit:request')
  cancel(@Param('id') id: string, @Body() body: CancelSiteVisitDto, @CurrentUser('sub') userId: string) {
    return this.service.cancel(id, body.reason, userId);
  }

  @Post(':id/outcome')
  @RequirePermissions('siteVisit:request')
  @ApiOperation({ summary: 'Record what happened — COMPLETED or NO_SHOW. Also writes the lead timeline.' })
  outcome(@Param('id') id: string, @Body() body: OutcomeSiteVisitDto, @CurrentUser('sub') userId: string) {
    return this.service.recordOutcome(id, body, userId);
  }
}

@ApiTags('Site Visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('visit-availability')
export class VisitAvailabilityController {
  constructor(private service: VisitAvailabilityService) {}

  @Get('slots')
  @RequirePermissions('siteVisit:view')
  @ApiOperation({ summary: 'Bookable slots in a date range — OPEN minus BLOCKED minus held minus inside the notice period' })
  slots(@Query('hostId') hostId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.service.slots({ hostId, from, to });
  }

  @Get('policy')
  @RequirePermissions('siteVisit:view')
  @ApiOperation({ summary: 'Scheduling policy (notice period, slot length, working hours)' })
  policy() {
    return this.service.policy();
  }

  @Get()
  @RequirePermissions('siteVisit:view')
  list(@Query('hostId') hostId?: string) {
    return this.service.list(hostId);
  }

  @Get(':id/delete-impact')
  @RequirePermissions('availability:manage')
  @ApiOperation({ summary: 'What bookings a delete would affect — shown before confirming' })
  impact(@Param('id') id: string) {
    return this.service.impactOfDelete(id);
  }

  // The permission opens the door; the service decides WHOSE calendar. Everyone publishes
  // their own hours; only leadership may publish for somebody else.
  @Post()
  @RequirePermissions('availability:manage')
  create(
    @Body() body: CreateAvailabilityDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles?: string[],
    @CurrentUser('role') role?: string,
  ) {
    return this.service.create(body, userId, { userId, roles: roles ?? (role ? [role] : []) });
  }

  @Post('bulk')
  @RequirePermissions('availability:manage')
  @ApiOperation({ summary: 'Publish several rules at once (a full week, a month) in one transaction' })
  createMany(
    @Body() body: BulkAvailabilityDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles?: string[],
    @CurrentUser('role') role?: string,
  ) {
    return this.service.createMany(body.rules, userId, { userId, roles: roles ?? (role ? [role] : []) });
  }

  @Put(':id')
  @RequirePermissions('availability:manage')
  update(
    @Param('id') id: string,
    @Body() body: UpdateAvailabilityDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles?: string[],
    @CurrentUser('role') role?: string,
  ) {
    return this.service.update(id, body, { userId, roles: roles ?? (role ? [role] : []) });
  }

  @Delete(':id')
  @RequirePermissions('availability:manage')
  remove(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles?: string[],
    @CurrentUser('role') role?: string,
  ) {
    return this.service.remove(id, { userId, roles: roles ?? (role ? [role] : []) });
  }
}
