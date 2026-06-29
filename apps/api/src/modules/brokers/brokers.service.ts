import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Broker / referral tracking — internal-only (brokers have no login). Brokers bring
 * leads; commission is earned when an attributed sale closes (the SalesService stamps
 * Sale.brokerCommissionAmt on close). This service owns broker CRUD + the performance report.
 */
@Injectable()
export class BrokersService {
  constructor(private prisma: PrismaService) {}

  findAll(includeInactive = false) {
    return this.prisma.broker.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
      include: { _count: { select: { leads: true, sales: true } } },
    });
  }

  async findById(id: string) {
    const broker = await this.prisma.broker.findFirst({
      where: { id, deletedAt: null },
      include: {
        leads: {
          select: { id: true, name: true, status: true, projectId: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        sales: {
          select: { id: true, buyer: true, salePrice: true, status: true, brokerCommissionAmt: true, closingDate: true },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!broker) throw new NotFoundException('Broker not found');
    return broker;
  }

  async create(input: {
    name: string;
    company?: string;
    email?: string;
    phone?: string;
    commissionRate?: number;
    commissionFlat?: number;
    notes?: string;
  }) {
    if (!input.name?.trim()) throw new BadRequestException('Broker name is required');
    return this.prisma.broker.create({
      data: {
        name: input.name.trim(),
        company: input.company,
        email: input.email,
        phone: input.phone,
        commissionRate: input.commissionRate ?? null,
        commissionFlat: input.commissionFlat ?? null,
        notes: input.notes,
      },
    });
  }

  async update(
    id: string,
    input: {
      name?: string;
      company?: string;
      email?: string;
      phone?: string;
      commissionRate?: number;
      commissionFlat?: number;
      notes?: string;
      isActive?: boolean;
    },
  ) {
    await this.findById(id);
    return this.prisma.broker.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        company: input.company,
        email: input.email,
        phone: input.phone,
        commissionRate: input.commissionRate,
        commissionFlat: input.commissionFlat,
        notes: input.notes,
        isActive: input.isActive,
      },
    });
  }

  async remove(id: string) {
    await this.findById(id);
    // Soft-delete; leads/sales keep their brokerId for historical reporting.
    return this.prisma.broker.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Per-broker performance: leads brought, closed sales, closed value, commission earned,
   * and lead→close conversion. Powers the broker report screen.
   */
  async report() {
    // Four grouped queries — aggregate per broker, then join in memory.
    const [brokers, leadGroups, saleGroups, paidGroups, pipelineGroups] = await Promise.all([
      this.prisma.broker.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      this.prisma.lead.groupBy({
        by: ['brokerId'],
        where: { brokerId: { not: null } },
        _count: true,
      }),
      this.prisma.sale.groupBy({
        by: ['brokerId'],
        where: { brokerId: { not: null }, status: 'CLOSED', deletedAt: null },
        _count: true,
        _sum: { salePrice: true, brokerCommissionAmt: true },
      }),
      // Paid: CLOSED sales where brokerCommissionPaidAt IS NOT NULL
      this.prisma.sale.groupBy({
        by: ['brokerId'],
        where: {
          brokerId: { not: null },
          status: 'CLOSED',
          deletedAt: null,
          brokerCommissionPaidAt: { not: null },
        },
        _sum: { brokerCommissionAmt: true },
      }),
      // Pipeline: UNDER_CONTRACT and LOI_SIGNED sales
      this.prisma.sale.groupBy({
        by: ['brokerId'],
        where: {
          brokerId: { not: null },
          status: { in: ['UNDER_CONTRACT', 'LOI_SIGNED'] },
          deletedAt: null,
        },
        _sum: { salePrice: true },
      }),
    ]);

    const leadsByBroker = new Map(leadGroups.map((g) => [g.brokerId, g._count]));
    const salesByBroker = new Map(saleGroups.map((g) => [g.brokerId, g]));
    const paidByBroker = new Map(paidGroups.map((g) => [g.brokerId, Number(g._sum.brokerCommissionAmt ?? 0)]));
    const pipelineByBroker = new Map(pipelineGroups.map((g) => [g.brokerId, Number(g._sum.salePrice ?? 0)]));

    return brokers.map((b) => {
      const leads = leadsByBroker.get(b.id) ?? 0;
      const closed = salesByBroker.get(b.id);
      const closedSales = closed?._count ?? 0;
      const commissionEarned = Number(closed?._sum.brokerCommissionAmt ?? 0);
      const commissionPaid = paidByBroker.get(b.id) ?? 0;
      const pipelineValue = pipelineByBroker.get(b.id) ?? 0;
      const rate = b.commissionRate != null ? Number(b.commissionRate) : null;
      return {
        brokerId: b.id,
        name: b.name,
        company: b.company,
        commissionRate: rate,
        commissionFlat: b.commissionFlat != null ? Number(b.commissionFlat) : null,
        leads,
        closedSales,
        closedValue: Number(closed?._sum.salePrice ?? 0),
        commissionEarned,
        conversionPct: leads > 0 ? Math.round((closedSales / leads) * 100) : 0,
        commissionPaid,
        commissionOwed: commissionEarned - commissionPaid,
        pipelineValue,
        pipelineCommissionEst: rate != null ? Math.round(pipelineValue * rate / 100 * 100) / 100 : null,
      };
    });
  }

  /**
   * Per-broker sale drilldown — up to 100 sales attributed to the given broker,
   * with unit/building context. Used by the broker detail view.
   */
  async getSalesByBroker(brokerId: string) {
    const broker = await this.prisma.broker.findFirst({ where: { id: brokerId, deletedAt: null } });
    if (!broker) throw new NotFoundException('Broker not found');

    return this.prisma.sale.findMany({
      where: { brokerId, deletedAt: null },
      select: {
        id: true,
        buyer: true,
        salePrice: true,
        status: true,
        brokerCommissionAmt: true,
        brokerCommissionPct: true,
        brokerCommissionPaidAt: true,
        closingDate: true,
        projectId: true,
        unit: {
          select: {
            unitNumber: true,
            building: { select: { name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Mark broker commission as paid on a given sale (sets brokerCommissionPaidAt = now).
   * Throws if the sale is not found or has no broker attached.
   */
  async markCommissionPaid(saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, deletedAt: null },
      select: { id: true, brokerId: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    if (!sale.brokerId) throw new NotFoundException('Sale has no broker assigned');

    return this.prisma.sale.update({
      where: { id: saleId },
      data: { brokerCommissionPaidAt: new Date() },
      select: {
        id: true,
        brokerId: true,
        brokerCommissionAmt: true,
        brokerCommissionPaidAt: true,
      },
    });
  }
}
