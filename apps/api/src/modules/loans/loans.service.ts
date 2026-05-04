import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Prisma, DrawStatus } from '@prisma/client';

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async findByProject(projectId: string) {
    const loans = await this.prisma.loan.findMany({
      where: { projectId },
      include: {
        drawRequests: { orderBy: { drawNumber: 'asc' } },
        unit: { select: { unitNumber: true, building: { select: { name: true } } } },
      },
    });
    return loans.map((l) => this.decryptLoan(l));
  }

  async findById(id: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: { drawRequests: { orderBy: { drawNumber: 'asc' } } },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    return this.decryptLoan(loan);
  }

  async create(data: Prisma.LoanUncheckedCreateInput) {
    const encrypted = this.encryption.encryptFields(data as any, ['lender', 'principalAmt', 'interestRate', 'currentBalance']);
    return this.prisma.loan.create({ data: { ...data, encryptedFields: encrypted.encryptedFields } });
  }

  async update(id: string, data: Prisma.LoanUncheckedUpdateInput) {
    await this.findById(id);
    const sensitiveFields = ['lender', 'principalAmt', 'interestRate', 'currentBalance'];
    const hasSensitive = sensitiveFields.some((f) => (data as any)[f] !== undefined);
    if (hasSensitive) {
      const encrypted = this.encryption.encryptFields(data as any, sensitiveFields);
      (data as any).encryptedFields = encrypted.encryptedFields;
    }
    return this.prisma.loan.update({ where: { id }, data });
  }

  async getMonthlyPayments(projectId: string) {
    const loans = await this.prisma.loan.findMany({
      where: { projectId },
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

  async findDrawsByProject(projectId: string) {
    return this.prisma.drawRequest.findMany({
      where: { projectId },
      include: {
        loan: { select: { id: true, loanType: true, encryptedFields: true, lender: true } },
      },
      orderBy: { requestDate: 'desc' },
    }).then(draws => draws.map(d => ({
      ...d,
      loan: d.loan ? this.decryptLoan(d.loan) : null,
    })));
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
      const requestedAmt = data.requestedAmount ?? data.amount ?? 0;

      return tx.drawRequest.create({
        data: {
          loanId,
          projectId: loan.projectId,
          drawNumber,
          amount: requestedAmt,
          requestedAmount: requestedAmt,
          requestDate: new Date(),
          status: DrawStatus.DRAFT,
          notes: data.notes,
          createdById: userId,
        },
      });
    });
  }

  async updateDrawStatus(
    id: string,
    status: DrawStatus,
    userId: string,
    approvedAmount?: number,
    rejectionReason?: string,
  ) {
    const draw = await this.prisma.drawRequest.findUnique({ where: { id } });
    if (!draw) throw new NotFoundException('Draw request not found');

    const transitions: Record<DrawStatus, DrawStatus[]> = {
      DRAFT: [DrawStatus.SUBMITTED, DrawStatus.REJECTED],
      SUBMITTED: [DrawStatus.APPROVED, DrawStatus.REJECTED],
      APPROVED: [DrawStatus.FUNDED, DrawStatus.REJECTED],
      FUNDED: [],
      REJECTED: [],
    };

    const currentStatus = draw.status as DrawStatus;
    if (!transitions[currentStatus]?.includes(status)) {
      throw new BadRequestException(`Cannot transition from ${currentStatus} to ${status}`);
    }
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
    if (loan.encryptedFields) {
      return this.encryption.decryptFields(loan);
    }
    return loan;
  }
}
