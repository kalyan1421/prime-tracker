import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { CreateLoanDto, UpdateLoanDto, CreateDrawDto, UpdateDrawDto, UpdateDrawStatusDto, UpsertDrawScheduleDto } from './dto/create-loan.dto';

@ApiTags('Loans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
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

  @Get()
  @RequirePermissions('loan:view')
  @ApiOperation({ summary: 'List loans by project (decrypted)' })
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Post()
  @RequirePermissions('loan:edit')
  @ApiOperation({ summary: 'Create loan with encrypted fields' })
  create(@Body() body: CreateLoanDto) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('loan:edit')
  @ApiOperation({ summary: 'Update loan, re-encrypts sensitive fields' })
  update(@Param('id') id: string, @Body() body: UpdateLoanDto) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('loan:edit')
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

  @Get(':id')
  @RequirePermissions('loan:view')
  @ApiOperation({ summary: 'Get loan by ID (decrypted)' })
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post(':loanId/draws')
  @RequirePermissions('draw:edit')
  @ApiOperation({ summary: 'Create a draw request for a loan' })
  createDraw(@Param('loanId') loanId: string, @Body() body: CreateDrawDto, @Request() req: any) {
    return this.service.createDraw(loanId, body, req.user.sub);
  }

  @Patch('draws/:id')
  @RequirePermissions('draw:edit')
  @ApiOperation({ summary: 'Edit a DRAFT draw request (amount, requestDate, notes)' })
  updateDraw(@Param('id') id: string, @Body() body: UpdateDrawDto) {
    return this.service.updateDraw(id, body);
  }

  @Patch('draws/:id/status')
  @RequirePermissions('draw:edit')
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
  @ApiOperation({ summary: 'Upsert a draw schedule line (create or update by drawNumber)' })
  upsertDrawScheduleLine(
    @Param('loanId') loanId: string,
    @Body() body: UpsertDrawScheduleDto,
  ) {
    return this.service.upsertDrawScheduleLine(loanId, body);
  }

  @Delete('schedule/:id')
  @RequirePermissions('draw:edit')
  @ApiOperation({ summary: 'Delete a draw schedule line' })
  deleteDrawScheduleLine(@Param('id') id: string) {
    return this.service.deleteDrawScheduleLine(id);
  }
}
