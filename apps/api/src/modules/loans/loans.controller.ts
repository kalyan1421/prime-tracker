import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, RequireMfa } from '../../common/decorators/index';
import { CreateLoanDto, UpdateLoanDto, CreateDrawDto, UpdateDrawDto, UpdateDrawStatusDto, UpsertDrawScheduleDto } from './dto/create-loan.dto';

@ApiTags('Loans')
@ApiBearerAuth()
// Money-moving routes carry @RequireMfa(): a stolen session should not be able to
// create a loan, alter a draw or mark one funded without a fresh code from the phone
// in the owner's pocket. READ routes are deliberately untouched — a TOTP prompt to
// merely view a loan would fire constantly and train people to click through it.
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard, MfaGuard)
@UseInterceptors(AuditInterceptor)
@Controller('loans')
export class LoansController {
  constructor(private service: LoansService) {}

  @Get('monthly-payments')
  @RequirePermissions('loan:view')
  @ApiOperation({ summary: 'Get monthly mortgage payments for a project' })
  getMonthlyPayments(@Query('projectId') projectId: string) {
    return this.service.getMonthlyPayments(projectId);
  }

  /**
   * `buildingId` returns ONLY loans secured on that building; `projectId` returns the
   * project's loans plus every building-level loan inside it (findByProject already ORs
   * on building.projectId). So the building view is a strict subset of the project view,
   * not a competing definition.
   *
   * findByBuilding() has existed since building-level loans shipped and had no route —
   * the service method was written and never exposed, so the building page had no way to
   * ask for its own loans and filtered the project's list in the browser instead.
   */
  @Get()
  @RequirePermissions('loan:view')
  @ApiOperation({ summary: 'List loans by project, or by building (decrypted)' })
  findAll(
    @Query('projectId') projectId?: string,
    @Query('buildingId') buildingId?: string,
  ) {
    if (buildingId) return this.service.findByBuilding(buildingId);
    return this.service.findByProject(projectId as string);
  }

  @Post()
  @RequirePermissions('loan:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Create loan with encrypted fields' })
  create(@Body() body: CreateLoanDto) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('loan:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Update loan, re-encrypts sensitive fields' })
  update(@Param('id') id: string, @Body() body: UpdateLoanDto) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('loan:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Soft-delete a loan (blocked if it has active draw requests)' })
  delete(@Param('id') id: string) { return this.service.delete(id); }

  // ---- Draw Management ----

  @Get('draws')
  @RequirePermissions('draw:view')
  @ApiOperation({ summary: 'Get all draw requests for a project' })
  findDrawsByProject(@Query('projectId') projectId: string, @Request() req: any) {
    // Only financial roles get the decrypted loan financials merged into each draw;
    // draw:view-only roles (CONSTRUCTION) get non-financial loan identifiers only.
    const perms: string[] = req.user?.permissions ?? [];
    const canViewFinancial = perms.includes('financial:view') || perms.includes('loan:view');
    return this.service.findDrawsByProject(projectId, canViewFinancial);
  }

  // Must stay ABOVE @Get(':id') — Express matches in declaration order, so a later
  // literal path is swallowed by the earlier parameterised one.
  @Get('draw-schedules')
  // Both, because this replaces a two-call sequence that needed both: GET /loans
  // (loan:view) followed by GET /loans/:id/schedule (draw:view). The response carries the
  // decrypted lender name, so loan:view is the one that actually matters here — dropping
  // it would hand lender names to draw:view-only roles like CONSTRUCTION.
  @RequirePermissions('loan:view', 'draw:view')
  @ApiOperation({ summary: 'Every draw schedule line across a project\'s loans' })
  findProjectDrawSchedules(@Query('projectId') projectId: string) {
    return this.service.findProjectDrawSchedules(projectId);
  }

  @Get(':id')
  @RequirePermissions('loan:view')
  @ApiOperation({ summary: 'Get loan by ID (decrypted)' })
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post(':loanId/draws')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Create a draw request for a loan' })
  createDraw(@Param('loanId') loanId: string, @Body() body: CreateDrawDto, @Request() req: any) {
    return this.service.createDraw(loanId, body, req.user.sub);
  }

  @Patch('draws/:id')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Edit a DRAFT draw request (amount, requestDate, notes)' })
  updateDraw(@Param('id') id: string, @Body() body: UpdateDrawDto) {
    return this.service.updateDraw(id, body);
  }

  @Patch('draws/:id/status')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Advance draw request status (include approvedAmount on APPROVED, rejectionReason on REJECTED)' })
  updateDrawStatus(
    @Param('id') id: string,
    @Body() body: UpdateDrawStatusDto,
    @Request() req: any,
  ) {
    return this.service.updateDrawStatus(id, body.status, req.user.sub, body.approvedAmount, body.rejectionReason);
  }

  @Delete('draws/:id')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Delete a DRAFT draw request' })
  deleteDraw(@Param('id') id: string) {
    return this.service.deleteDraw(id);
  }

  // ---- Draw Schedule ----

  @Get(':loanId/schedule')
  @RequirePermissions('draw:view')
  @ApiOperation({ summary: 'Get planned draw schedule for a loan' })
  getDrawSchedule(@Param('loanId') loanId: string) {
    return this.service.findDrawSchedule(loanId);
  }

  @Post(':loanId/schedule')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Upsert a draw schedule line (create or update by drawNumber)' })
  upsertDrawScheduleLine(
    @Param('loanId') loanId: string,
    @Body() body: UpsertDrawScheduleDto,
  ) {
    return this.service.upsertDrawScheduleLine(loanId, body);
  }

  @Delete('schedule/:id')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Delete a draw schedule line' })
  deleteDrawScheduleLine(@Param('id') id: string) {
    return this.service.deleteDrawScheduleLine(id);
  }
}
