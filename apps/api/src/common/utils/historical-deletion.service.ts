import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Exactly one of these is set — mirrors CommissionInstallmentService's CommissionTarget. */
export interface HistoricalDeletionTarget {
  leaseId?: string | null;
  saleId?: string | null;
}

function whereForTarget(target: HistoricalDeletionTarget) {
  return target.leaseId ? { leaseId: target.leaseId } : { saleId: target.saleId! };
}

/**
 * The Founder-approval gate on deleting a backfilled record (R27, generalized to
 * lease/sale by R6). Depends only on PrismaService, so — same reasoning as
 * CommissionInstallmentService — it is provided directly in LeasesModule and SalesModule
 * rather than through a shared import, which would risk a cycle.
 *
 * Entity-agnostic on purpose: a request row names which entity it belongs to, and
 * deciding/cancelling one never needs to know in advance which kind it is. The
 * entity-specific half (audit logging under 'Lease'/'Sale', bus events, the "delete
 * consumes the approval" step) stays in LeasesService/SalesService — this service only
 * owns the historical_record_deletions table itself.
 */
@Injectable()
export class HistoricalDeletionService {
  constructor(private prisma: PrismaService) {}

  findPending(target: HistoricalDeletionTarget) {
    return this.prisma.historicalRecordDeletion.findFirst({
      where: { ...whereForTarget(target), status: 'PENDING' },
    });
  }

  findLatestApproved(target: HistoricalDeletionTarget) {
    return this.prisma.historicalRecordDeletion.findFirst({
      where: { ...whereForTarget(target), status: 'APPROVED' },
      orderBy: { decidedAt: 'desc' },
    });
  }

  async request(target: HistoricalDeletionTarget, reason: string, userId: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to request deletion');
    }
    const existing = await this.findPending(target);
    if (existing) {
      throw new BadRequestException('A deletion request for this record is already pending');
    }
    return this.prisma.historicalRecordDeletion.create({
      data: { ...target, reason: reason.trim(), requestedById: userId },
    });
  }

  /**
   * Approve or reject a pending request. Does NOT delete anything — approving authorises
   * the delete, which stays a separate deliberate act.
   */
  async decide(requestId: string, approve: boolean, userId: string, note?: string) {
    const request = await this.prisma.historicalRecordDeletion.findUnique({
      where: { id: requestId },
      include: {
        lease: { select: { tenantName: true } },
        sale: { select: { buyer: true } },
      },
    });
    if (!request) throw new NotFoundException('Deletion request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`This request was already ${request.status.toLowerCase()}`);
    }
    // Nobody approves their own request — an approver who wants to delete their own
    // record does it directly instead (self-approve, see selfApprove below).
    if (request.requestedById === userId) {
      throw new ForbiddenException('A deletion request must be approved by someone else');
    }
    const decided = await this.prisma.historicalRecordDeletion.update({
      where: { id: requestId },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedById: userId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
    });
    return { decided, request };
  }

  /** Withdraw your own pending request. Only while it is pending. */
  async cancel(requestId: string, userId: string) {
    const request = await this.prisma.historicalRecordDeletion.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Deletion request not found');
    if (request.requestedById !== userId) {
      throw new ForbiddenException('Only the person who raised a request can withdraw it');
    }
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`This request was already ${request.status.toLowerCase()}`);
    }
    return this.prisma.historicalRecordDeletion.update({
      where: { id: requestId },
      // decidedBy is the person who settled it, which for a withdrawal is the requester —
      // and the DB CHECK requires any non-PENDING row to name one.
      data: { status: 'CANCELLED', decidedById: userId, decidedAt: new Date() },
    });
  }

  /**
   * The approver deleting directly. Recorded as a request they raised and decided in one
   * act, so the trail reads the same shape as every other deletion rather than being a
   * hole where an approval should be.
   */
  async selfApprove(target: HistoricalDeletionTarget, userId: string) {
    const pending = await this.findPending(target);
    return pending
      ? this.prisma.historicalRecordDeletion.update({
          where: { id: pending.id },
          data: {
            status: 'APPROVED',
            decidedById: userId,
            decidedAt: new Date(),
            decisionNote: 'Approved by deleting the record directly',
          },
        })
      : this.prisma.historicalRecordDeletion.create({
          data: {
            ...target,
            reason: 'Deleted directly by an approver',
            requestedById: userId,
            status: 'APPROVED',
            decidedById: userId,
            decidedAt: new Date(),
          },
        });
  }

  /** Marks an approval used, so it cannot authorise a second deletion if the record is ever restored. */
  markCompleted(id: string) {
    return this.prisma.historicalRecordDeletion.update({ where: { id }, data: { status: 'COMPLETED' } });
  }

  /** The Founder's queue — every request of a given status, oldest first. */
  list(status = 'PENDING') {
    return this.prisma.historicalRecordDeletion.findMany({
      where: { status },
      orderBy: { requestedAt: 'asc' },
      include: {
        lease: { select: { id: true, tenantName: true, leaseStart: true, leaseEnd: true, unitId: true } },
        sale: { select: { id: true, buyer: true, salePrice: true, closingDate: true, unitId: true, buildingId: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    });
  }
}
