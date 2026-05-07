import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { EventBus } from '../../common/events/event-bus.service';

/**
 * Daily variance check across all budget lines.
 *
 * Fires `budget.varianceExceeded` when actuals + commitments for a category
 * exceed `budget × (1 + threshold/100)` — default 10%.
 *
 * De-dup: a Redis-style cache key per (project, category) with a 24h TTL
 * prevents spamming the same alert each day. The cache invalidates if the
 * spend drops back below threshold (handler clears the dedup key).
 */
@Injectable()
export class VarianceAlertCron {
  private readonly logger = new Logger(VarianceAlertCron.name);

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private bus: EventBus,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { name: 'budget-variance-alerts' })
  async run() {
    // Pull configurable threshold from each project's org settings (fallback 10%).
    // For now: single global default to keep the query simple. Per-org overrides
    // can be a follow-up once we have multi-org users.
    const DEFAULT_THRESHOLD_PCT = 10;

    const projects = await this.prisma.project.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: { id: true },
    });

    let firedCount = 0;
    for (const p of projects) {
      const fired = await this.checkProject(p.id, DEFAULT_THRESHOLD_PCT);
      firedCount += fired;
    }
    this.logger.log(`Variance alerts: fired ${firedCount} new alerts across ${projects.length} projects`);
  }

  /**
   * Check a single project. Returns the number of NEW alerts fired
   * (alerts already de-duped within the 24h window count as 0).
   */
  async checkProject(projectId: string, thresholdPct: number): Promise<number> {
    // Group by category — variance is most useful at the category level.
    const lines = await this.prisma.budgetLine.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, category: true, revisedAmt: true, baselineAmt: true },
    });

    const categoryBudget: Record<string, number> = {};
    const categoryLineIds: Record<string, string[]> = {};
    for (const l of lines) {
      const amt = Number(l.revisedAmt ?? l.baselineAmt);
      categoryBudget[l.category] = (categoryBudget[l.category] ?? 0) + amt;
      (categoryLineIds[l.category] ??= []).push(l.id);
    }

    const [actuals, commits] = await Promise.all([
      this.prisma.actual.groupBy({ by: ['category'], where: { projectId }, _sum: { amount: true } }),
      this.prisma.commitment.groupBy({ by: ['category'], where: { projectId }, _sum: { contractAmt: true } }),
    ]);
    const categoryActual: Record<string, number> = {};
    for (const a of actuals)  categoryActual[a.category]  = Number(a._sum?.amount ?? 0);
    const categoryCommit: Record<string, number> = {};
    for (const c of commits)  categoryCommit[c.category]  = Number(c._sum?.contractAmt ?? 0);

    let fired = 0;
    for (const category of Object.keys(categoryBudget)) {
      const budget = categoryBudget[category];
      if (budget <= 0) continue;
      const spent = (categoryActual[category] ?? 0) + (categoryCommit[category] ?? 0);
      const pct = ((spent - budget) / budget) * 100;

      if (pct > thresholdPct) {
        const dedupKey = `variance:${projectId}:${category}`;
        if (this.cache.get<boolean>(dedupKey)) continue;  // already alerted today
        this.cache.set(dedupKey, true, 24 * 60 * 60);     // 24h dedup window

        // Fire one event per affected budget line in the category
        for (const lineId of categoryLineIds[category]) {
          this.bus.emit({
            type: 'budget.varianceExceeded',
            projectId,
            budgetLineId: lineId,
            pct,
          });
        }
        fired++;
      } else {
        // If we drop back below threshold, clear the dedup so the next overshoot fires
        this.cache.invalidateKey(`variance:${projectId}:${category}`);
      }
    }
    return fired;
  }
}
