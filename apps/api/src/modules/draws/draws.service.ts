import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type {
  DrawStatus, DrawApprovalStep, DrawApprovalAction, DrawDocType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';
import { canTransition, getTransition, DrawAction } from './draw-state-machine';

/**
 * Draw Request workflow service.
 *
 * Owns:
 *   - State machine transitions (validated against draw-state-machine.ts)
 *   - Approval log (audit trail of who acted at each step)
 *   - Document attachments (lender package)
 *   - Auto-creating Actuals when a draw is FUNDED — closes the loop
 *
 * The vanilla CRUD lives in LoansService; this service is for *workflow* actions.
 */
@Injectable()
export class DrawsService {
  constructor(private prisma: PrismaService, private bus: EventBus) {}

  // ─────── Transitions ───────

  async submit(drawId: string, actorId: string, comment?: string) {
    return this.transition(drawId, 'submit', actorId, 'INTERNAL_FINANCE', 'APPROVED', comment);
  }

  async approveInternal(drawId: string, actorId: string, comment?: string) {
    return this.transition(drawId, 'approveInternal', actorId, 'INTERNAL_FOUNDER', 'APPROVED', comment);
  }

  async submitToLender(drawId: string, actorId: string, comment?: string) {
    // Records that finance forwarded to lender. State stays APPROVED.
    const draw = await this.findById(drawId);
    if (draw.status !== 'APPROVED') {
      throw new BadRequestException('Draw must be APPROVED before submitting to lender');
    }
    await this.recordApproval(drawId, 'LENDER_SUBMITTED', 'APPROVED', actorId, comment);
    await this.prisma.drawRequest.update({
      where: { id: drawId },
      data: { submittedToLenderAt: new Date() },
    });
    this.bus.emit({ type: 'drawRequest.submitted', drawId, step: 'LENDER_SUBMITTED' });
    return this.findById(drawId);
  }

  async markFunded(drawId: string, actorId: string, fundedAt?: Date) {
    const draw = await this.findById(drawId);
    if (!canTransition(draw.status, 'markFunded')) {
      throw new BadRequestException(`Cannot mark funded from status ${draw.status}`);
    }
    const fundedDate = fundedAt ?? new Date();

    const [updated] = await this.prisma.$transaction([
      this.prisma.drawRequest.update({
        where: { id: drawId },
        data: { status: 'FUNDED', fundedAt: fundedDate },
      }),
      this.prisma.drawApproval.create({
        data: {
          drawRequestId: drawId,
          step: 'LENDER_FUNDED',
          action: 'APPROVED',
          actorId,
          comment: 'Funds wired by lender',
        },
      }),
    ]);

    // Slice 9 wire-up: emit funded event so handlers can create Actuals + invalidate cache
    this.bus.emit({
      type: 'drawRequest.funded',
      drawId,
      loanId: draw.loanId,
      projectId: draw.projectId ?? '',
      amount: Number(draw.approvedAmount ?? draw.amount),
    });
    return updated;
  }

  async reject(drawId: string, actorId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('Rejection reason is required');
    }
    const draw = await this.findById(drawId);
    if (!canTransition(draw.status, 'reject')) {
      throw new BadRequestException(`Cannot reject from status ${draw.status}`);
    }
    const step: DrawApprovalStep =
      draw.status === 'SUBMITTED' ? 'INTERNAL_FOUNDER' : 'LENDER_FUNDED';
    return this.prisma.$transaction(async (tx) => {
      await tx.drawRequest.update({
        where: { id: drawId },
        data: { status: 'REJECTED', rejectionReason: reason },
      });
      return tx.drawApproval.create({
        data: { drawRequestId: drawId, step, action: 'REJECTED', actorId, comment: reason },
      });
    });
  }

  async cancel(drawId: string, actorId: string, comment?: string) {
    const draw = await this.findById(drawId);
    if (!canTransition(draw.status, 'cancel')) {
      throw new BadRequestException(`Cannot cancel from status ${draw.status}`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.drawRequest.update({ where: { id: drawId }, data: { status: 'CANCELLED' } });
      return tx.drawApproval.create({
        data: {
          drawRequestId: drawId,
          step: 'INTERNAL_FOUNDER',
          action: 'REJECTED',
          actorId,
          comment: comment ?? 'Cancelled',
        },
      });
    });
  }

  // ─────── Documents ───────

  async attachDocument(input: {
    drawRequestId: string;
    documentType: DrawDocType;
    storagePath: string;
    filename: string;
    uploadedById: string;
  }) {
    return this.prisma.drawDocument.create({ data: input });
  }

  async removeDocument(documentId: string) {
    // Hard-delete — append-only doesn't apply to attachments since they're files
    return this.prisma.drawDocument.delete({ where: { id: documentId } });
  }

  /**
   * Document checklist for a draw.
   * Returns each required type and whether at least one file of that type
   * has been uploaded. Drives the red-flag UI on the draw detail page.
   */
  async checklist(drawId: string): Promise<Array<{ type: DrawDocType; required: boolean; uploaded: number }>> {
    const REQUIRED: DrawDocType[] = ['LIEN_WAIVER', 'INSPECTION_REPORT', 'SWORN_STATEMENT', 'VENDOR_INVOICE'];
    const docs = await this.prisma.drawDocument.findMany({
      where: { drawRequestId: drawId },
      select: { documentType: true },
    });
    const counts: Record<string, number> = {};
    for (const d of docs) counts[d.documentType] = (counts[d.documentType] ?? 0) + 1;
    return REQUIRED.map((t) => ({ type: t, required: true, uploaded: counts[t] ?? 0 }));
  }

  // ─────── Reads ───────

  async findById(id: string) {
    const draw = await this.prisma.drawRequest.findUnique({
      where: { id },
      include: {
        loan: { select: { id: true, lender: true, projectId: true } },
        approvals: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { id: true, name: true, email: true } } },
        },
        documents: {
          orderBy: { uploadedAt: 'desc' },
          include: { uploadedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!draw) throw new NotFoundException('Draw request not found');
    return draw;
  }

  // ─────── Internal ───────

  private async transition(
    drawId: string,
    action: DrawAction,
    actorId: string,
    step: DrawApprovalStep,
    actionOnAudit: DrawApprovalAction,
    comment?: string,
  ) {
    const draw = await this.findById(drawId);
    const t = getTransition(draw.status as DrawStatus, action);
    if (!t) {
      throw new BadRequestException(`Cannot ${action} from status ${draw.status}`);
    }

    // Required-doc gate
    if (t.requiredDocs?.length) {
      const docs = await this.prisma.drawDocument.findMany({
        where: { drawRequestId: drawId },
        select: { documentType: true },
      });
      const haveTypes = new Set(docs.map((d) => d.documentType));
      const missing = t.requiredDocs.filter((rt) => !haveTypes.has(rt as DrawDocType));
      if (missing.length) {
        throw new BadRequestException(
          `Missing required documents to ${action}: ${missing.join(', ')}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.drawRequest.update({
        where: { id: drawId },
        data: { status: t.to },
      });
      await tx.drawApproval.create({
        data: {
          drawRequestId: drawId,
          step,
          action: actionOnAudit,
          actorId,
          comment,
        },
      });
      return updated;
    });
  }

  private async recordApproval(
    drawId: string,
    step: DrawApprovalStep,
    actionOnAudit: DrawApprovalAction,
    actorId: string,
    comment?: string,
  ) {
    return this.prisma.drawApproval.create({
      data: { drawRequestId: drawId, step, action: actionOnAudit, actorId, comment },
    });
  }
}
