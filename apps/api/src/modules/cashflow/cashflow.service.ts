import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CashFlowType } from '@prisma/client';

@Injectable()
export class CashFlowService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.cashFlowEntry.findMany({
      where: { projectId },
      orderBy: [{ month: 'asc' }, { entryType: 'asc' }],
    });
  }

  async create(data: any, userId: string) {
    return this.prisma.cashFlowEntry.create({
      data: {
        projectId: data.projectId,
        month: new Date(data.month),
        entryType: data.entryType as CashFlowType,
        category: data.category,
        amount: Number(data.amount),
        isActual: data.isActual !== false,
        notes: data.notes,
      },
    });
  }

  async update(id: string, data: any) {
    const entry = await this.prisma.cashFlowEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Cash flow entry not found');
    return this.prisma.cashFlowEntry.update({
      where: { id },
      data: {
        ...(data.month && { month: new Date(data.month) }),
        ...(data.entryType && { entryType: data.entryType }),
        ...(data.category && { category: data.category }),
        ...(data.amount !== undefined && { amount: Number(data.amount) }),
        ...(data.isActual !== undefined && { isActual: data.isActual }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  }

  async delete(id: string) {
    const entry = await this.prisma.cashFlowEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Cash flow entry not found');
    return this.prisma.cashFlowEntry.delete({ where: { id } });
  }

  async getForecast(projectId: string) {
    const entries = await this.findByProject(projectId);

    // Group by month
    const monthMap = new Map<string, { inflows: number; outflows: number; isActual: boolean }>();

    for (const entry of entries) {
      const key = entry.month.toISOString().slice(0, 7); // YYYY-MM
      if (!monthMap.has(key)) {
        monthMap.set(key, { inflows: 0, outflows: 0, isActual: entry.isActual });
      }
      const m = monthMap.get(key)!;
      if (entry.entryType === 'INFLOW') m.inflows += entry.amount;
      else m.outflows += Math.abs(entry.amount);
    }

    // Sort and compute cumulative
    const sorted = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let cumulative = 0;
    const result = sorted.map(([month, data]) => {
      const net = data.inflows - data.outflows;
      cumulative += net;
      return { month, inflows: data.inflows, outflows: data.outflows, net, cumulative, isActual: data.isActual };
    });

    // Totals
    const totalInflows = result.reduce((s, r) => s + r.inflows, 0);
    const totalOutflows = result.reduce((s, r) => s + r.outflows, 0);
    const netCashFlow = totalInflows - totalOutflows;
    const burnRate = result.length > 0 ? totalOutflows / result.length : 0;

    return { summary: { totalInflows, totalOutflows, netCashFlow, burnRate }, monthly: result };
  }
}
