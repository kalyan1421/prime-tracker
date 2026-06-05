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
    // Two grouped queries instead of 1+2N — aggregate per broker, then join in memory.
    const [brokers, leadGroups, saleGroups] = await Promise.all([
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
    ]);

    const leadsByBroker = new Map(leadGroups.map((g) => [g.brokerId, g._count]));
    const salesByBroker = new Map(saleGroups.map((g) => [g.brokerId, g]));

    return brokers.map((b) => {
      const leads = leadsByBroker.get(b.id) ?? 0;
      const closed = salesByBroker.get(b.id);
      const closedSales = closed?._count ?? 0;
      return {
        brokerId: b.id,
        name: b.name,
        company: b.company,
        commissionRate: b.commissionRate != null ? Number(b.commissionRate) : null,
        commissionFlat: b.commissionFlat != null ? Number(b.commissionFlat) : null,
        leads,
        closedSales,
        closedValue: Number(closed?._sum.salePrice ?? 0),
        commissionEarned: Number(closed?._sum.brokerCommissionAmt ?? 0),
        conversionPct: leads > 0 ? Math.round((closedSales / leads) * 100) : 0,
      };
    });
  }
}
