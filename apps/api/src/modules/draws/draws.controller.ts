import {
  Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { DrawDocType } from '@prisma/client';
import { DrawsService } from './draws.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
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
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('draws')
export class DrawsController {
  constructor(private draws: DrawsService) {}

  @Get(':id')
  @RequirePermissions('draw:view')
  findById(@Param('id') id: string) {
    return this.draws.findById(id);
  }

  @Get(':id/checklist')
  @RequirePermissions('draw:view')
  checklist(@Param('id') id: string) {
    return this.draws.checklist(id);
  }

  // ─────── Workflow transitions ───────

  @Post(':id/submit')
  @RequirePermissions('draw:edit')
  submit(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.submit(id, userId, body?.comment);
  }

  @Post(':id/approve-internal')
  @RequirePermissions('draw:approve')
  approveInternal(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.approveInternal(id, userId, body?.comment);
  }

  @Post(':id/submit-to-lender')
  @RequirePermissions('draw:edit')
  submitToLender(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.submitToLender(id, userId, body?.comment);
  }

  @Post(':id/return-for-info')
  @RequirePermissions('draw:edit')
  returnForInfo(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.returnForInfo(id, userId, body?.comment);
  }

  @Post(':id/mark-funded')
  @RequirePermissions('draw:approve')
  markFunded(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { fundedAt?: string },
  ) {
    return this.draws.markFunded(id, userId, body?.fundedAt ? new Date(body.fundedAt) : undefined);
  }

  @Post(':id/reject')
  @RequirePermissions('draw:approve')
  reject(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { reason: string },
  ) {
    return this.draws.reject(id, userId, body.reason);
  }

  @Post(':id/cancel')
  @RequirePermissions('draw:edit')
  cancel(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.cancel(id, userId, body?.comment);
  }

  // ─────── Documents ───────

  @Post(':id/documents')
  @RequirePermissions('draw:edit')
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
  renameDocument(@Param('documentId') documentId: string, @Body() body: { filename: string }) {
    return this.draws.renameDocument(documentId, body.filename);
  }

  @Delete('documents/:documentId')
  @RequirePermissions('draw:edit')
  removeDocument(@Param('documentId') documentId: string) {
    return this.draws.removeDocument(documentId);
  }
}
