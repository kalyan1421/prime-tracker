import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadStatus, LeadSource, LeadActivityType, Prisma } from '@prisma/client';

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: {
    projectId?: string;
    status?: LeadStatus;
    assignedTo?: string;
    search?: string;
  } = {}) {
    const { projectId, status, assignedTo, search } = params;

    const where: Prisma.LeadWhereInput = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (assignedTo) where.assignedTo = assignedTo;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.lead.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true, avatarUrl: true } },
        createdByUser: { select: { id: true, name: true } },
        _count: { select: { activities: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true, avatarUrl: true } },
        createdByUser: { select: { id: true, name: true } },
        activities: {
          include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async create(data: {
    projectId: string;
    name?: string;
    email?: string;
    phone?: string;
    source: LeadSource;
    status?: LeadStatus;
    unitInterest?: string;
    budget?: number;
    notes?: string;
    assignedTo?: string;
    createdBy: string;
  }) {
    const { budget, ...rest } = data;
    return this.prisma.lead.create({
      data: {
        ...rest,
        budget: budget !== undefined ? budget : undefined,
        status: data.status ?? 'NEW',
      },
      include: {
        project: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: string, data: {
    name?: string;
    email?: string;
    phone?: string;
    source?: LeadSource;
    status?: LeadStatus;
    unitInterest?: string;
    budget?: number;
    notes?: string;
    assignedTo?: string;
  }) {
    await this.findById(id);
    const { budget, ...rest } = data;
    return this.prisma.lead.update({
      where: { id },
      data: {
        ...rest,
        budget: budget !== undefined ? budget : undefined,
      },
      include: {
        project: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
      },
    });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.lead.delete({ where: { id } });
  }

  // ---- Activities ----

  async getActivities(leadId: string) {
    await this.findById(leadId);
    return this.prisma.leadActivity.findMany({
      where: { leadId },
      include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addActivity(leadId: string, userId: string, type: LeadActivityType, note: string) {
    await this.findById(leadId);
    const activity = await this.prisma.leadActivity.create({
      data: { leadId, createdBy: userId, type, note },
      include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } },
    });
    await this.prisma.lead.update({ where: { id: leadId }, data: { updatedAt: new Date() } });
    return activity;
  }

  // ---- Convert to Sale ----

  async convertToSale(leadId: string, userId: string, saleData: {
    unitId: string;
    buyer: string;
    salePrice: number;
    contractDate?: string;
    closingDate?: string;
  }) {
    const lead = await this.findById(leadId);

    if (lead.status === 'CONVERTED') {
      throw new BadRequestException('Lead is already converted');
    }

    // Create the sale
    const sale = await this.prisma.sale.create({
      data: {
        projectId: lead.projectId,
        unitId: saleData.unitId,
        buyer: saleData.buyer,
        salePrice: saleData.salePrice,
        contractDate: saleData.contractDate ? new Date(saleData.contractDate) : undefined,
        closingDate: saleData.closingDate ? new Date(saleData.closingDate) : undefined,
        status: 'UNDER_CONTRACT',
      },
    });

    // Mark lead as converted and link to sale
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { status: 'CONVERTED', convertedToSaleId: sale.id },
    });

    // Log the activity
    await this.prisma.leadActivity.create({
      data: {
        leadId,
        createdBy: userId,
        type: 'STATUS_CHANGE',
        note: `Converted to sale (Sale ID: ${sale.id})`,
      },
    });

    return { lead: await this.findById(leadId), sale };
  }
}
