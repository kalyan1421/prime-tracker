import {
  Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { DrawDocType } from '@prisma/client';
import { DrawsService } from './draws.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { RequireMfa } from '../../common/decorators/index';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';

/**
 * Draw workflow API. Owns transitions, approvals, documents, checklist.
 * Vanilla CRUD for DrawRequest still lives under loans (loans.controller).
 *
 * RBAC: read = draw:view, mutate = draw:edit, approval-step transitions
 * (approve-internal / mark-funded / reject) = draw:approve.
 */
@ApiTags('Draws')
@ApiBearerAuth()
// Money-moving routes carry @RequireMfa(): a stolen session should not be able to
// create a loan, alter a draw or mark one funded without a fresh code from the phone
// in the owner's pocket. READ routes are deliberately untouched — a TOTP prompt to
// merely view a loan would fire constantly and train people to click through it.
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard, MfaGuard)
@UseInterceptors(AuditInterceptor)
@Controller('draws')
export class DrawsController {
  constructor(private draws: DrawsService) {}

  @Get(':id')
  @RequirePermissions('draw:view')
  findById(@Param('id') id: string, @CurrentUser('permissions') permissions?: string[]) {
    const perms = permissions ?? [];
    const canViewFinancial = perms.includes('financial:view') || perms.includes('loan:view');
    return this.draws.findById(id, canViewFinancial);
  }

  @Get(':id/checklist')
  @RequirePermissions('draw:view')
  checklist(@Param('id') id: string) {
    return this.draws.checklist(id);
  }

  // ─────── Workflow transitions ───────

  @Post(':id/submit')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  submit(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.submit(id, userId, body?.comment);
  }

  @Post(':id/approve-internal')
  @RequirePermissions('draw:approve')
  @RequireMfa()
  approveInternal(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.approveInternal(id, userId, body?.comment);
  }

  @Post(':id/submit-to-lender')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  submitToLender(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('permissions') permissions: string[] = [],
    @Body() body: { comment?: string },
  ) {
    const canViewFinancial = permissions.includes('financial:view') || permissions.includes('loan:view');
    return this.draws.submitToLender(id, userId, canViewFinancial, body?.comment);
  }

  @Post(':id/return-for-info')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  returnForInfo(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.returnForInfo(id, userId, body?.comment);
  }

  @Post(':id/mark-funded')
  @RequirePermissions('draw:approve')
  @RequireMfa()
  markFunded(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { fundedAt?: string },
  ) {
    return this.draws.markFunded(id, userId, body?.fundedAt ? new Date(body.fundedAt) : undefined);
  }

  @Post(':id/reject')
  @RequirePermissions('draw:approve')
  @RequireMfa()
  reject(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { reason: string },
  ) {
    return this.draws.reject(id, userId, body.reason);
  }

  @Post(':id/cancel')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  cancel(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.cancel(id, userId, body?.comment);
  }

  // ─────── Documents ───────

  @Post(':id/documents')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  attachDocument(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { documentType: DrawDocType; storagePath: string; filename: string },
  ) {
    return this.draws.attachDocument({
      drawRequestId: id,
      uploadedById: userId,
      ...body,
    });
  }

  @Patch('documents/:documentId')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  renameDocument(@Param('documentId') documentId: string, @Body() body: { filename: string }) {
    return this.draws.renameDocument(documentId, body.filename);
  }

  @Delete('documents/:documentId')
  @RequirePermissions('draw:edit')
  @RequireMfa()
  removeDocument(@Param('documentId') documentId: string) {
    return this.draws.removeDocument(documentId);
  }
}
