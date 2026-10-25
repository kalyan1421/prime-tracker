import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, RequireMfa, CurrentUser } from '../../common/decorators/index';
import { ProjectAccessService, ScopedUser } from '../../common/access/project-access.service';
import { DrawsService } from '../draws/draws.service';
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
  constructor(
    private service: LoansService,
    private draws: DrawsService,
    private access: ProjectAccessService,
  ) {}

  // The list routes below take projectId as optional. ProjectAccessGuard passes a request
  // that names no project, so each narrows an omitted one to the caller's member projects
  // with projectIdFilter — otherwise it meant every project's loans and draws.
  @Get('monthly-payments')
  @RequirePermissions('loan:view')
  @ApiOperation({ summary: 'Get monthly mortgage payments for a project' })
  async getMonthlyPayments(@Query('projectId') projectId: string, @CurrentUser() user: ScopedUser) {
    return this.service.getMonthlyPayments(await this.access.projectIdFilter(user, projectId));
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
  async findAll(
    @CurrentUser() user: ScopedUser,
    @Query('projectId') projectId?: string,
    @Query('buildingId') buildingId?: string,
  ) {
    if (buildingId) return this.service.findByBuilding(buildingId);
    return this.service.findByProject(await this.access.projectIdFilter(user, projectId));
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
  async findDrawsByProject(@Query('projectId') projectId: string, @Request() req: any) {
    // Only financial roles get the decrypted loan financials merged into each draw;
    // draw:view-only roles (CONSTRUCTION) get non-financial loan identifiers only.
    const perms: string[] = req.user?.permissions ?? [];
    const canViewFinancial = perms.includes('financial:view') || perms.includes('loan:view');
    return this.service.findDrawsByProject(await this.access.projectIdFilter(req.user, projectId), canViewFinancial);
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
  async findProjectDrawSchedules(@Query('projectId') projectId: string, @CurrentUser() user: ScopedUser) {
    return this.service.findProjectDrawSchedules(await this.access.projectIdFilter(user, projectId));
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

  // Draw routes take ':drawId', not ':id'. On this controller a bare ':id' is a LOAN, so a
  // draw id resolved to nothing and ProjectAccessGuard checked no project; ':drawId' is
  // resolved to the draw's own project (KEY_ENTITY).
  @Patch('draws/:drawId')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Edit a DRAFT draw request (amount, requestDate, notes)' })
  updateDraw(@Param('drawId') id: string, @Body() body: UpdateDrawDto) {
    return this.service.updateDraw(id, body);
  }

  /**
   * @deprecated Use the /draws/:id/* workflow routes. Kept for API compatibility, but no
   * longer writes `status` itself: every target is run through DrawsService.transitionTo,
   * so APPROVED / FUNDED / REJECTED need draw:approve (as on /draws/:id/*) and every move
   * obeys the state machine's edges and document gates. draw:edit alone used to be enough
   * to approve any amount or mark a draft funded.
   */
  @Patch('draws/:drawId/status')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Advance draw request status (include approvedAmount on APPROVED, rejectionReason on REJECTED)' })
  async updateDrawStatus(
    @Param('drawId') id: string,
    @Body() body: UpdateDrawStatusDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('permissions') permissions: string[] = [],
  ) {
    await this.draws.transitionTo(id, body.status, userId, {
      canApprove: permissions.includes('draw:approve'),
      approvedAmount: body.approvedAmount,
      rejectionReason: body.rejectionReason,
    });
    // One response shape whatever the transition: the draw, with loan financials only for
    // a caller who may see them (draw:edit is held by PROJECT_MANAGER without loan:view).
    const canViewFinancial = permissions.includes('financial:view') || permissions.includes('loan:view');
    return this.draws.findById(id, canViewFinancial);
  }

  @Delete('draws/:drawId')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Delete a DRAFT draw request' })
  deleteDraw(@Param('drawId') id: string) {
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

  // ':scheduleId' for the same reason as ':drawId' above — resolved to the line's loan's project.
  @Delete('schedule/:scheduleId')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Delete a draw schedule line' })
  deleteDrawScheduleLine(@Param('scheduleId') id: string) {
    return this.service.deleteDrawScheduleLine(id);
  }
}
