import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class KpiService {
  constructor(private prisma: PrismaService) {}

  async getLatest(projectId: string) {
    return this.prisma.kpiSnapshot.findFirst({
      where: { projectId },
      orderBy: { snapshotDate: 'desc' },
    });
  }

  async getHistory(projectId: string, months = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    return this.prisma.kpiSnapshot.findMany({
      where: { projectId, snapshotDate: { gte: since } },
      orderBy: { snapshotDate: 'asc' },
    });
  }

  async createSnapshot(projectId: string) {
    const [budgets, actuals, commitments, leases, units] = await Promise.all([
      this.prisma.budgetLine.findMany({ where: { projectId } }),
      this.prisma.actual.findMany({ where: { projectId, interiorProjectId: null } }),
      this.prisma.commitment.findMany({ where: { projectId } }),
      this.prisma.lease.findMany({ where: { unit: { building: { projectId } }, status: 'ACTIVE' } }),
      this.prisma.unit.findMany({ where: { building: { projectId } } }),
    ]);

    const budgetTotal = budgets.reduce((s, b) => s + Number(b.revisedAmt ?? b.baselineAmt), 0);
    const actualTotal = actuals.reduce((s, a) => s + Number(a.amount), 0);
    const committedTotal = commitments.reduce((s, c) => s + Number(c.contractAmt), 0);
    const leasedSqft = leases.reduce((s, l) => {
      const unit = units.find(u => u.id === l.unitId);
      return s + (unit?.sqft ?? 0);
    }, 0);
    const totalSqft = units.reduce((s, u) => s + (u.sqft ?? 0), 0);
    const soldUnits = units.filter(u => u.status === 'SOLD').length;

    return this.prisma.kpiSnapshot.create({
      data: {
        projectId,
        snapshotDate: new Date(),
        budgetTotal,
        actualTotal,
        committedTotal,
        forecastTotal: Math.max(committedTotal, actualTotal),
        variance: budgetTotal - actualTotal,
        occupancyPct: totalSqft > 0 ? (leasedSqft / totalSqft) * 100 : 0,
        leasedSqft,
        soldUnits,
      },
    });
  }
}
