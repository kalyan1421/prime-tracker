import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChangeOrderStatus, ContractStatus } from '@prisma/client';
import { CreateContractDto, UpdateContractDto, CreateChangeOrderDto, CreateContractPaymentDto } from './dto/create-contract.dto';

@Injectable()
export class ContractsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.contract.findMany({
      where: { projectId },
      include: {
        vendor: true,
        changeOrders: { orderBy: { number: 'asc' } },
        payments: { orderBy: { paidDate: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProjectSummary(projectId: string) {
    const contracts = await this.findByProject(projectId);
    const totalOriginal = contracts.reduce((s, c) => s + c.originalAmount, 0);
    const totalCurrent = contracts.reduce((s, c) => s + c.currentAmount, 0);
    const totalPaid = contracts.reduce((s, c) => s + c.payments.reduce((ps, p) => ps + p.amount, 0), 0);
    const pctComplete = totalCurrent > 0 ? (totalPaid / totalCurrent) * 100 : 0;
    return { totalOriginal, totalCurrent, totalPaid, pctComplete };
  }

  async create(data: CreateContractDto) {
    return this.prisma.contract.create({
      data: {
        projectId: data.projectId,
        vendorId: data.vendorId,
        description: data.description,
        originalAmount: Number(data.originalAmount),
        currentAmount: Number(data.originalAmount),
        status: (data.status as ContractStatus) || ContractStatus.DRAFT,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
      },
      include: { vendor: true },
    });
  }

  async update(id: string, data: UpdateContractDto) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) throw new NotFoundException('Contract not found');
    return this.prisma.contract.update({
      where: { id },
      data: {
        ...(data.description && { description: data.description }),
        ...(data.status && { status: data.status }),
        ...(data.startDate !== undefined && { startDate: data.startDate ? new Date(data.startDate) : null }),
        ...(data.endDate !== undefined && { endDate: data.endDate ? new Date(data.endDate) : null }),
      },
      include: { vendor: true },
    });
  }

  async delete(id: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) throw new NotFoundException('Contract not found');
    return this.prisma.contract.delete({ where: { id } });
  }

  async addChangeOrder(contractId: string, data: CreateChangeOrderDto) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('Contract not found');

    const count = await this.prisma.changeOrder.count({ where: { contractId } });
    const co = await this.prisma.changeOrder.create({
      data: {
        contractId,
        number: count + 1,
        description: data.description,
        amount: Number(data.amount),
        status: ChangeOrderStatus.PENDING,
      },
    });
    return co;
  }

  async updateChangeOrderStatus(id: string, status: ChangeOrderStatus) {
    const co = await this.prisma.changeOrder.findUnique({
      where: { id },
      include: { contract: true },
    });
    if (!co) throw new NotFoundException('Change order not found');

    const updated = await this.prisma.changeOrder.update({
      where: { id },
      data: {
        status,
        ...(status === ChangeOrderStatus.APPROVED && { approvedAt: new Date() }),
      },
    });

    // If approved, recalculate contract currentAmount
    if (status === ChangeOrderStatus.APPROVED) {
      const approvedCOs = await this.prisma.changeOrder.findMany({
        where: { contractId: co.contractId, status: ChangeOrderStatus.APPROVED },
      });
      const coTotal = approvedCOs.reduce((s, c) => s + c.amount, 0);
      await this.prisma.contract.update({
        where: { id: co.contractId },
        data: { currentAmount: co.contract.originalAmount + coTotal },
      });
    }

    return updated;
  }

  async addPayment(contractId: string, data: CreateContractPaymentDto) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('Contract not found');
    // The date input sends a plain yyyy-mm-dd string; parsing that directly reads as UTC
    // midnight, which formats back as the prior day in any timezone behind UTC. Anchor to
    // noon so the calendar date survives the round trip regardless of viewer timezone.
    const paidDate = new Date(`${data.paidDate}T12:00:00`);
    if (isNaN(paidDate.getTime())) throw new BadRequestException('Invalid payment date');
    return this.prisma.contractPayment.create({
      data: {
        contractId,
        amount: Number(data.amount),
        paidDate,
        notes: data.notes,
      },
    });
  }
}
