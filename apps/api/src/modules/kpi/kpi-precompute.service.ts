import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

/**
 * Nightly precomputation of KPI snapshots.
 *
 * Why this exists:
 *   Finance Dashboard, Founder Dashboard, and Reports all aggregate over the same
 *   underlying data (budget vs actuals, occupancy %, leased sqft, units sold).
 *   Computing on every dashboard load is wasteful and slow at scale. This job runs
 *   at 02:00 server time, computes per-project KPI snapshots, and writes them to
 *   the kpi_snapshots table. The dashboards then read pre-aggregated rows.
 *
 * Runs daily; can be triggered manually via POST /api/kpi/recompute.
 */
@Injectable()
export class KpiPrecomputeService {
  private readonly logger = new Logger(KpiPrecomputeService.name);

  constructor(private prisma: PrismaService, private cache: CacheService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'kpi-nightly-precompute' })
  async nightly() {
    this.logger.log('Starting nightly KPI precomputation');
    await this.recomputeAll();
  }

  async recomputeAll() {
    // deletedAt: null alongside the status check — archiving sets deletedAt without
    // touching status, so an archived project was still getting a nightly snapshot
    // recomputed for no reader (KpiSnapshot has no cross-project consumer today, but
    // there's no reason to keep spending the compute on a project nobody's looking at).
    const projects = await this.prisma.project.findMany({
      where: { status: { not: 'CANCELLED' }, deletedAt: null },
      select: { id: true, name: true },
    });

    let success = 0;
    let failed = 0;
    for (const p of projects) {
      try {
        await this.recomputeForProject(p.id);
        success++;
      } catch (err) {
        failed++;
        this.logger.error(`KPI precompute failed for project ${p.id} (${p.name})`, err as Error);
      }
    }

    // Drop dashboard cache so the next read picks up fresh aggregates
    this.cache.invalidateTag('dashboard');
    this.logger.log(`KPI precompute done: ${success} ok, ${failed} failed`);
    return { success, failed, total: projects.length };
  }

  /** Compute and persist a KPI snapshot for one project. */
  async recomputeForProject(projectId: string) {
    const [budget, actuals, committed, units, leasedUnits, soldUnits] = await Promise.all([
      this.prisma.budgetLine.aggregate({ where: { projectId }, _sum: { baselineAmt: true } }),
      this.prisma.actual.aggregate({ where: { projectId, interiorProjectId: null }, _sum: { amount: true } }),
      this.prisma.commitment.aggregate({ where: { projectId }, _sum: { contractAmt: true } }),
      this.prisma.unit.count({ where: { building: { projectId } } }),
      this.prisma.unit.count({ where: { building: { projectId }, status: 'LEASED' } }),
      this.prisma.unit.count({ where: { building: { projectId }, status: 'SOLD' } }),
    ]);

    const budgetAmt = Number(budget._sum?.baselineAmt ?? 0);
    const actualsAmt = Number(actuals._sum?.amount ?? 0);
    const committedAmt = Number(committed._sum?.contractAmt ?? 0);
    const variance = budgetAmt - actualsAmt - committedAmt;
    const occupancyPct = units > 0 ? ((leasedUnits + soldUnits) / units) * 100 : 0;

    // snapshotDate is the start of today — unique constraint guarantees one row/day/project
    const snapshotDate = new Date();
    snapshotDate.setHours(0, 0, 0, 0);

    await this.prisma.kpiSnapshot.upsert({
      where: { projectId_snapshotDate: { projectId, snapshotDate } },
      create: {
        projectId,
        snapshotDate,
        budgetTotal: budgetAmt,
        actualTotal: actualsAmt,
        committedTotal: committedAmt,
        forecastTotal: actualsAmt + committedAmt,
        variance,
        occupancyPct,
        soldUnits,
        data: { unitsTotal: units, unitsLeased: leasedUnits },
      },
      update: {
        budgetTotal: budgetAmt,
        actualTotal: actualsAmt,
        committedTotal: committedAmt,
        forecastTotal: actualsAmt + committedAmt,
        variance,
        occupancyPct,
        soldUnits,
        data: { unitsTotal: units, unitsLeased: leasedUnits },
      },
    });
  }
}
