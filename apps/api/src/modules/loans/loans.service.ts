import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { EventBus } from '../../common/events/event-bus.service';
import { Prisma, DrawStatus } from '@prisma/client';

/**
 * The Loan columns held only inside `encryptedFields`. Any read path that surfaces
 * one of these must run the row through `EncryptionService.decryptLoan` first —
 * the columns themselves are null.
 */
export const SENSITIVE_LOAN_FIELDS = ['lender', 'principalAmt', 'interestRate', 'currentBalance'] as const;

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private bus: EventBus,
  ) {}

  async findByProject(projectId: string) {
    // Sprint 1: loans can be attached at either project- or building-level (per
    // Centro Plaza's per-building construction loans). Surface both under the
    // project view via OR(projectId match, building.projectId match).
    const loans = await this.prisma.loan.findMany({
      where: {
        deletedAt: null,
        OR: [
          { projectId },
          { building: { projectId } },
        ],
      },
      include: {
        drawRequests: { orderBy: { drawNumber: 'asc' } },
        unit: { select: { unitNumber: true, building: { select: { name: true } } } },
        building: { select: { id: true, name: true } },
      },
    });
    return loans.map((l) => this.decryptLoan(l));
  }

  async findByBuilding(buildingId: string) {
    const loans = await this.prisma.loan.findMany({
      where: { buildingId, deletedAt: null },
      include: {
        drawRequests: { orderBy: { drawNumber: 'asc' } },
        building: { select: { id: true, name: true } },
      },
    });
    return loans.map((l) => this.decryptLoan(l));
  }

  async findById(id: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: { drawRequests: { orderBy: { drawNumber: 'asc' } } },
    });
    if (!loan || loan.deletedAt) throw new NotFoundException('Loan not found');
    return this.decryptLoan(loan);
  }

  // Soft-delete only (schema.prisma: "required for compliance/audit") — never a hard
  // delete. Blocked while the loan has any non-terminal draw request, since deleting
  // the loan would orphan in-flight/funded draws and the Actuals they've already posted.
  async delete(id: string) {
    const loan = await this.findById(id);
    const activeDraws = await this.prisma.drawRequest.count({
      where: {
        loanId: id,
        status: { notIn: [DrawStatus.DRAFT, DrawStatus.CANCELLED, DrawStatus.REJECTED] },
      },
    });
    if (activeDraws > 0) {
      throw new ConflictException(
        `This loan has ${activeDraws} active draw request${activeDraws === 1 ? '' : 's'}. ` +
        'Resolve or cancel them before deleting the loan.',
      );
    }
    return this.prisma.loan.update({ where: { id: loan.id }, data: { deletedAt: new Date() } });
  }

  async create(data: Prisma.LoanUncheckedCreateInput) {
    // Sprint 1: loans must reference at least one of (projectId, buildingId).
    // Setting both is allowed (a per-building loan that still rolls up to the project),
    // but at least one must be present to anchor the loan in the portfolio hierarchy.
    if (!data.projectId && !data.buildingId) {
      throw new BadRequestException('Loan must reference at least one of projectId or buildingId');
    }
    // If only buildingId is set, derive projectId from the building so legacy
    // project-scoped queries (e.g. dashboards) still find this loan without rewrites.
    if (!data.projectId && data.buildingId) {
      const b = await this.prisma.building.findUnique({
        where: { id: data.buildingId as string },
        select: { projectId: true },
      });
      if (!b) throw new NotFoundException('Building not found');
      data.projectId = b.projectId;
    }
    // class-validator's @IsDateString() accepts a bare "YYYY-MM-DD" date, but Prisma's
    // DateTime column needs a full ISO-8601 datetime — pass a Date object so Prisma
    // serializes it correctly instead of erroring "premature end of input".
    if (typeof data.maturityDate === 'string') {
      data.maturityDate = new Date(data.maturityDate);
    }
    // Spread `encrypted`, NOT `data`: encryptFields returns the sensitive keys nulled,
    // so the plaintext never reaches its own column. Spreading `data` here is exactly
    // what used to write lender/principal/rate/balance in the clear next to the blob.
    const encrypted = this.encryption.encryptFields(data as any, SENSITIVE_LOAN_FIELDS as any);
    return this.prisma.loan.create({ data: encrypted as any });
  }

  async update(id: string, data: Prisma.LoanUncheckedUpdateInput) {
    // Decrypted — needed below to re-encrypt the full sensitive set on a partial edit.
    const existing = await this.findById(id);

    // Re-linking to a building: derive projectId the same way create() does, so the
    // loan doesn't fall out of project-scoped queries/dashboards.
    if (data.buildingId) {
      const b = await this.prisma.building.findUnique({
        where: { id: data.buildingId as string },
        select: { projectId: true },
      });
      if (!b) throw new NotFoundException('Building not found');
      if (!data.projectId) data.projectId = b.projectId;
    }
    if (data.unitId) {
      const u = await this.prisma.unit.findUnique({
        where: { id: data.unitId as string },
        select: { buildingId: true },
      });
      if (!u) throw new NotFoundException('Unit not found');
    }
    if (typeof data.maturityDate === 'string') {
      data.maturityDate = new Date(data.maturityDate);
    }

    // The blob is rewritten WHOLE every time, so it must be built from the merge of
    // what's stored and what's changing — not from `data` alone. Editing only
    // currentBalance used to write a blob containing just that field; it looked fine
    // only because the other three were still readable in their plaintext columns.
    // With the columns nulled, that same code path would destroy lender, principal
    // and rate. Always re-encrypt the full set.
    const hasSensitive = SENSITIVE_LOAN_FIELDS.some((f) => (data as any)[f] !== undefined);
    if (hasSensitive) {
      const merged: Record<string, unknown> = {};
      for (const f of SENSITIVE_LOAN_FIELDS) {
        const incoming = (data as any)[f];
        merged[f] = incoming !== undefined ? incoming : (existing as any)[f];
      }
      const encrypted = this.encryption.encryptFields(merged, SENSITIVE_LOAN_FIELDS as any);
      for (const f of SENSITIVE_LOAN_FIELDS) (data as any)[f] = null; // clear any legacy plaintext
      (data as any).encryptedFields = encrypted.encryptedFields;
    }
    return this.prisma.loan.update({ where: { id }, data });
  }

  async getMonthlyPayments(projectId: string) {
    const loans = await this.prisma.loan.findMany({
      where: { projectId, deletedAt: null },
      include: {
        unit: { select: { unitNumber: true, building: { select: { name: true } } } },
      },
    });

    const decrypted = loans.map((l) => this.decryptLoan(l));

    const perLoan = decrypted.map((l: any) => ({
      id: l.id,
      loanType: l.loanType,
      lender: l.lender,
      monthlyPayment: Number(l.monthlyPayment || 0),
      unitNumber: l.unit?.unitNumber || null,
      buildingName: l.unit?.building?.name || null,
    }));

    const total = perLoan.reduce((sum, l) => sum + l.monthlyPayment, 0);

    return { total, annualTotal: total * 12, perLoan };
  }

  // ---- Draw Management ----

  async findDrawsByProject(projectId: string, canViewFinancial: boolean) {
    const draws = await this.prisma.drawRequest.findMany({
      where: { projectId },
      include: {
        loan: { select: { id: true, loanType: true, encryptedFields: true, lender: true } },
      },
      orderBy: { requestDate: 'desc' },
    });
    return draws.map((d) => {
      if (!d.loan) return { ...d, loan: null };
      if (canViewFinancial) {
        return { ...d, loan: this.decryptLoan(d.loan) };
      }
      // Financial-blind roles (e.g. CONSTRUCTION holds draw:view but not financial:view/
      // loan:view): expose only non-financial loan identifiers. Never decrypt the blob
      // (principal/rate/balance) and never ship the raw encryptedFields ciphertext.
      return { ...d, loan: { id: d.loan.id, loanType: d.loan.loanType, lender: d.loan.lender } };
    });
  }

  async createDraw(loanId: string, data: any, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findUnique({ where: { id: loanId } });
      if (!loan) throw new NotFoundException('Loan not found');

      // Read max drawNumber inside transaction to prevent concurrent-create race condition
      const last = await tx.drawRequest.findFirst({
        where: { loanId },
        orderBy: { drawNumber: 'desc' },
        select: { drawNumber: true },
      });
      const drawNumber = (last?.drawNumber ?? 0) + 1;
      const requestedAmt = Number(data.requestedAmount ?? data.amount ?? 0);
      if (!Number.isFinite(requestedAmt) || requestedAmt <= 0) {
        throw new BadRequestException('requestedAmount must be greater than 0');
      }

      return tx.drawRequest.create({
        data: {
          loanId,
          projectId: loan.projectId,
          drawNumber,
          amount: requestedAmt,
          requestedAmount: requestedAmt,
          requestDate: data.requestDate ? new Date(data.requestDate) : new Date(),
          expectedFundingDate: data.expectedFundingDate ? new Date(data.expectedFundingDate) : null,
          status: DrawStatus.DRAFT,
          notes: data.notes,
          createdById: userId,
        },
      });
    });
  }

  /**
   * @deprecated Workflow transitions live in DrawsService (state machine in
   * draws/draw-state-machine.ts). This method is kept ONLY for backwards
   * compatibility with the legacy /loans/draws/:id/status endpoint while UIs
   * migrate to the new /draws/:id/* routes (submit, approve-internal, mark-funded, etc.).
   *
   * Validation here is intentionally minimal — the new state machine enforces
   * required-document gates, fires events, and writes the audit trail. Don't
   * extend this method; deprecate it instead.
   */
  async updateDrawStatus(
    id: string,
    status: DrawStatus,
    userId: string,
    approvedAmount?: number,
    rejectionReason?: string,
  ) {
    const draw = await this.prisma.drawRequest.findUnique({ where: { id } });
    if (!draw) throw new NotFoundException('Draw request not found');

    if (status === DrawStatus.REJECTED && !rejectionReason) {
      throw new BadRequestException('rejectionReason is required when rejecting a draw');
    }

    const updateData: any = { status };
    if (status === DrawStatus.APPROVED) {
      updateData.approvedDate = new Date();
      updateData.approvedById = userId;
      if (approvedAmount !== undefined) updateData.approvedAmount = approvedAmount;
    }
    if (status === DrawStatus.FUNDED) updateData.fundedAt = new Date();
    if (status === DrawStatus.REJECTED) updateData.rejectionReason = rejectionReason;

    const updated = await this.prisma.drawRequest.update({ where: { id }, data: updateData });

    // Split-brain fix: the new state machine (DrawsService.markFunded) emits this so
    // the funded handler posts a budget Actual + invalidates dashboards. This legacy
    // path must do the same, else draws funded via the table silently skip actuals/variance.
    if (status === DrawStatus.FUNDED) {
      this.bus.emit({
        type: 'drawRequest.funded',
        drawId: id,
        loanId: draw.loanId,
        projectId: draw.projectId ?? '',
        amount: Number(draw.approvedAmount ?? draw.amount),
      });
    }

    return updated;
  }

  async updateDraw(id: string, data: { amount?: number; requestedAmount?: number; requestDate?: string; expectedFundingDate?: string; notes?: string }) {
    const draw = await this.prisma.drawRequest.findUnique({ where: { id } });
    if (!draw) throw new NotFoundException('Draw request not found');
    if (draw.status !== DrawStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT draws can be edited');
    }

    const updateData: Prisma.DrawRequestUpdateInput = {};
    if (data.requestedAmount !== undefined) updateData.requestedAmount = data.requestedAmount;
    if (data.amount !== undefined) updateData.amount = data.amount;
    else if (data.requestedAmount !== undefined) updateData.amount = data.requestedAmount;
    if (data.requestDate !== undefined) updateData.requestDate = new Date(data.requestDate);
    if (data.expectedFundingDate !== undefined) {
      updateData.expectedFundingDate = data.expectedFundingDate ? new Date(data.expectedFundingDate) : null;
    }
    if (data.notes !== undefined) updateData.notes = data.notes;

    return this.prisma.drawRequest.update({ where: { id }, data: updateData });
  }

  async deleteDraw(id: string) {
    const draw = await this.prisma.drawRequest.findUnique({ where: { id } });
    if (!draw) throw new NotFoundException('Draw request not found');
    if (draw.status !== DrawStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT draws can be deleted');
    }
    return this.prisma.drawRequest.delete({ where: { id } });
  }

  // ---- Draw Schedule ----

  async findDrawSchedule(loanId: string) {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new NotFoundException('Loan not found');
    return this.prisma.drawSchedule.findMany({
      where: { loanId },
      orderBy: { drawNumber: 'asc' },
    });
  }

  /**
   * Every draw schedule line across a project's loans, in one query.
   *
   * The milestone "Linked Draw" picker used to fetch /loans, then fan out one
   * GET /loans/:id/schedule per loan in a Promise.all. Each of those hits the same route
   * handler, and the throttler allows 10 per second per handler — so a project with 11+
   * loans would 429, and because it was a Promise.all a single rejection emptied the whole
   * picker rather than dropping one loan. One query cannot be rate-limited into a partial
   * answer.
   *
   * The loan label is joined here so the caller does not need the separate /loans read
   * either.
   */
  async findProjectDrawSchedules(projectId: string) {
    const lines = await this.prisma.drawSchedule.findMany({
      where: {
        // Mirrors findByProject exactly, and must keep mirroring it. Loans attach at
        // project OR building level, and legacy building-level rows can have a null
        // projectId of their own (create() only started deriving it later), so matching
        // on loan.projectId alone silently drops them. Soft-deleted loans stay out.
        loan: {
          deletedAt: null,
          OR: [
            { projectId },
            { building: { projectId } },
          ],
        },
      },
      orderBy: [{ loanId: 'asc' }, { drawNumber: 'asc' }],
      // encryptedFields is required, per SENSITIVE_LOAN_FIELDS at the top of this file:
      // `lender` is one of the encrypted columns, so the column itself is null and reading
      // it raw silently labels every line with its loanType instead of the bank's name.
      // Same shape findDrawsByProject uses.
      include: { loan: { select: { id: true, lender: true, loanType: true, encryptedFields: true } } },
    });
    return lines.map((s) => {
      const loan = this.decryptLoan(s.loan);
      return {
        id: s.id,
        drawNumber: s.drawNumber,
        plannedAmount: Number(s.plannedAmount),
        plannedDate: s.plannedDate,
        loanId: s.loanId,
        loanLabel: loan.lender || loan.loanType,
      };
    });
  }

  async upsertDrawScheduleLine(loanId: string, data: {
    drawNumber: number;
    plannedAmount: number;
    plannedDate: string;
    description?: string;
  }) {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new NotFoundException('Loan not found');
    return this.prisma.drawSchedule.upsert({
      where: { loanId_drawNumber: { loanId, drawNumber: data.drawNumber } },
      create: {
        loanId,
        drawNumber: data.drawNumber,
        plannedAmount: data.plannedAmount,
        plannedDate: new Date(data.plannedDate),
        description: data.description,
      },
      update: {
        plannedAmount: data.plannedAmount,
        plannedDate: new Date(data.plannedDate),
        description: data.description,
      },
    });
  }

  async deleteDrawScheduleLine(id: string) {
    const line = await this.prisma.drawSchedule.findUnique({ where: { id } });
    if (!line) throw new NotFoundException('Draw schedule line not found');
    return this.prisma.drawSchedule.delete({ where: { id } });
  }

  private decryptLoan(loan: any) {
    return this.encryption.decryptLoan(loan);
  }
}
