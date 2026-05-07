import {
  Body, Controller, Delete, Get, Param, Post, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { DrawDocType } from '@prisma/client';
import { DrawsService } from './draws.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';

/**
 * Draw workflow API. Owns transitions, approvals, documents, checklist.
 * Vanilla CRUD for DrawRequest still lives under loans (loans.controller).
 */
@ApiTags('Draws')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('draws')
export class DrawsController {
  constructor(private draws: DrawsService) {}

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.draws.findById(id);
  }

  @Get(':id/checklist')
  checklist(@Param('id') id: string) {
    return this.draws.checklist(id);
  }

  // ─────── Workflow transitions ───────

  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.submit(id, userId, body?.comment);
  }

  @Post(':id/approve-internal')
  approveInternal(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.approveInternal(id, userId, body?.comment);
  }

  @Post(':id/submit-to-lender')
  submitToLender(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.submitToLender(id, userId, body?.comment);
  }

  @Post(':id/mark-funded')
  markFunded(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { fundedAt?: string },
  ) {
    return this.draws.markFunded(id, userId, body?.fundedAt ? new Date(body.fundedAt) : undefined);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { reason: string },
  ) {
    return this.draws.reject(id, userId, body.reason);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { comment?: string }) {
    return this.draws.cancel(id, userId, body?.comment);
  }

  // ─────── Documents ───────

  @Post(':id/documents')
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

  @Delete('documents/:documentId')
  removeDocument(@Param('documentId') documentId: string) {
    return this.draws.removeDocument(documentId);
  }
}
