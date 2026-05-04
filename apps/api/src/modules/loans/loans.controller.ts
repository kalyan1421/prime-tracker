import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, RequireMfa } from '../../common/decorators/index';
import { DrawStatus } from '@prisma/client';

@ApiTags('Loans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, MfaGuard)
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

  @Get(':id')
  @RequirePermissions('loan:view')
  @ApiOperation({ summary: 'Get loan by ID (decrypted)' })
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('loan:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Create loan with encrypted fields (MFA required)' })
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('loan:edit')
  @RequireMfa()
  @ApiOperation({ summary: 'Update loan, re-encrypts sensitive fields (MFA required)' })
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  // ---- Draw Management ----

  @Get('draws')
  @RequirePermissions('draw:view')
  @ApiOperation({ summary: 'Get all draw requests for a project' })
  findDrawsByProject(@Query('projectId') projectId: string) {
    return this.service.findDrawsByProject(projectId);
  }

  @Post(':loanId/draws')
  @RequirePermissions('draw:edit')
  @ApiOperation({ summary: 'Create a draw request for a loan' })
  createDraw(@Param('loanId') loanId: string, @Body() body: any, @Request() req: any) {
    return this.service.createDraw(loanId, body, req.user.sub);
  }

  @Patch('draws/:id/status')
  @RequirePermissions('draw:edit')
  @ApiOperation({ summary: 'Advance draw request status (include approvedAmount on APPROVED, rejectionReason on REJECTED)' })
  updateDrawStatus(
    @Param('id') id: string,
    @Body() body: { status: DrawStatus; approvedAmount?: number; rejectionReason?: string },
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
    @Body() body: { drawNumber: number; plannedAmount: number; plannedDate: string; description?: string },
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
