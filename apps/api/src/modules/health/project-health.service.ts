import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

/**
 * Project Health Score — 0–100, composite of four weighted components.
 *
 * Why a single number: founders need triage at a glance across 7+ projects.
 * The breakdown is what you click into when the number is low.
 *
 * Components and weights:
 *   - Budget (30%): how much over/under projected spend pace
 *   - Schedule (30%): % of milestones overdue or blocked
 *   - Cashflow (20%): stuck draw requests aging in DRAFT/SUBMITTED
 *   - Sales (20%): % of unsold inventory + activity
 *
 * Each component returns a 0–100 sub-score; final = weighted sum.
 *
 * Cached 5min per project. Recomputed on relevant domain events.
 */

const WEIGHTS = { budget: 0.30, schedule: 0.30, cashflow: 0.20, sales: 0.20 };
// Match dashboard TTL — same staleness budget across the fleet
const TTL_SECONDS = 60;
const CACHE_TAG = 'projectHealth';

export interface ProjectHealth {
  score: number;
  breakdown: {
    budget:   { score: number; reason: string };
    schedule: { score: number; reason: string };
    cashflow: { score: number; reason: string };
    sales:    { score: number; reason: string };
  };
}

@Injectable()
export class ProjectHealthService {
  constructor(private prisma: PrismaService, private cache: CacheService) {}

  invalidate(projectId?: string) {
    if (projectId) this.cache.invalidateKey(`projectHealth:${projectId}`);
    else this.cache.invalidateTag(CACHE_TAG);
  }

  async score(projectId: string): Promise<ProjectHealth> {
    return this.cache.wrap(
      `projectHealth:${projectId}`,
      TTL_SECONDS,
      () => this.compute(projectId),
      { tags: [CACHE_TAG] },
    );
  }

  /** Compute scores for many projects — serialised in batches to avoid connection storms. */
  async scoreMany(projectIds: string[]): Promise<Record<string, ProjectHealth>> {
    const out: Record<string, ProjectHealth> = {};
    const BATCH = 3;
    for (let i = 0; i < projectIds.length; i += BATCH) {
      const batch = projectIds.slice(i, i + BATCH);
      await Promise.all(batch.map(async (id) => {
        out[id] = await this.score(id);
      }));
    }
    return out;
  }

  private async compute(projectId: string): Promise<ProjectHealth> {
    const [budget, schedule, cashflow, sales] = await Promise.all([
      this.budgetScore(projectId),
      this.scheduleScore(projectId),
      this.cashflowScore(projectId),
      this.salesScore(projectId),
    ]);

    const score = Math.round(
      budget.score * WEIGHTS.budget +
      schedule.score * WEIGHTS.schedule +
      cashflow.score * WEIGHTS.cashflow +
      sales.score * WEIGHTS.sales,
    );

    return { score, breakdown: { budget, schedule, cashflow, sales } };
  }

  // ─────── Component: Budget ───────
  // Healthy:    actuals + commitments ≤ 95% of budget        → 100
  // Watch:      ≤ 105%                                       → 70
  // Critical:   > 110%                                       → 30 or lower
  private async budgetScore(projectId: string) {
    const [b, a, c] = await Promise.all([
      this.prisma.budgetLine.aggregate({ where: { projectId }, _sum: { revisedAmt: true, baselineAmt: true } }),
      this.prisma.actual.aggregate({ where: { projectId }, _sum: { amount: true } }),
      this.prisma.commitment.aggregate({ where: { projectId }, _sum: { contractAmt: true } }),
    ]);

    const budget = Number(b._sum?.revisedAmt ?? b._sum?.baselineAmt ?? 0);
    const actuals = Number(a._sum?.amount ?? 0);
    const committed = Number(c._sum?.contractAmt ?? 0);

    if (budget === 0) {
      return { score: 80, reason: 'No budget set yet' };
    }

    const utilization = (actuals + committed) / budget;
    let score: number;
    let reason: string;
    if (utilization <= 0.95) {
      score = 100;
      reason = `${Math.round(utilization * 100)}% of budget committed`;
    } else if (utilization <= 1.05) {
      score = 70;
      reason = `Near budget: ${Math.round(utilization * 100)}% committed`;
    } else if (utilization <= 1.10) {
      score = 50;
      reason = `Over budget: ${Math.round(utilization * 100)}% committed`;
    } else {
      score = Math.max(10, Math.round(50 - (utilization - 1.10) * 200));
      reason = `${Math.round(utilization * 100)}% — significantly over`;
    }
    return { score, reason };
  }

  // ─────── Component: Schedule ───────
  // Sub-score = 100 - (overdue + blocked) / total * 200, floored at 0.
  private async scheduleScore(projectId: string) {
    const milestones = await this.prisma.milestone.findMany({
      where: { projectId },
      select: { status: true },
    });
    if (milestones.length === 0) {
      return { score: 80, reason: 'No milestones tracked' };
    }
    const total = milestones.length;
    const overdue = milestones.filter((m) => m.status === 'OVERDUE').length;
    const blocked = milestones.filter((m) => m.status === 'BLOCKED').length;
    const issuePct = (overdue + blocked) / total;
    const score = Math.max(0, Math.round(100 - issuePct * 200));
    const reason = overdue + blocked === 0
      ? `All ${total} milestones on track`
      : `${overdue} overdue, ${blocked} blocked of ${total}`;
    return { score, reason };
  }

  // ─────── Component: Cashflow / Draws ───────
  // Penalize draws stuck in DRAFT or SUBMITTED for >7 days.
  private async cashflowScore(projectId: string) {
    const draws = await this.prisma.drawRequest.findMany({
      where: { projectId, status: { in: ['DRAFT', 'SUBMITTED'] } },
      select: { id: true, status: true, createdAt: true, requestDate: true },
    });
    if (draws.length === 0) {
      return { score: 100, reason: 'No pending draws' };
    }
    const now = Date.now();
    const stuck = draws.filter((d) => {
      const reference = d.requestDate ?? d.createdAt;
      const ageDays = (now - reference.getTime()) / (1000 * 60 * 60 * 24);
      return ageDays > 7;
    }).length;
    if (stuck === 0) {
      return { score: 90, reason: `${draws.length} draw${draws.length === 1 ? '' : 's'} in flight, all fresh` };
    }
    const score = Math.max(20, 100 - stuck * 20);
    return { score, reason: `${stuck} draw${stuck === 1 ? '' : 's'} stuck >7 days` };
  }

  // ─────── Component: Sales ───────
  // Healthy: <30% units available + recent sales activity. Critical: stale inventory.
  private async salesScore(projectId: string) {
    const buildings = await this.prisma.building.findMany({
      where: { projectId },
      select: { units: { select: { status: true, availableSince: true } } },
    });
    const allUnits = buildings.flatMap((b) => b.units);

    if (allUnits.length === 0) {
      return { score: 80, reason: 'No units yet' };
    }

    const available = allUnits.filter((u) => u.status === 'AVAILABLE').length;
    const availablePct = available / allUnits.length;

    // Stale inventory = available > 90 days
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const stale = allUnits.filter(
      (u) => u.status === 'AVAILABLE' && u.availableSince && u.availableSince.getTime() < cutoff,
    ).length;

    let score: number;
    let reason: string;
    if (availablePct < 0.3 && stale === 0) {
      score = 95;
      reason = `${available}/${allUnits.length} available — selling well`;
    } else if (availablePct < 0.5 && stale <= 2) {
      score = 75;
      reason = `${available} available, ${stale} stale`;
    } else if (stale > 5) {
      score = 30;
      reason = `${stale} units stale (>90 days)`;
    } else {
      score = 50;
      reason = `${available} available, ${stale} stale`;
    }
    return { score, reason };
  }
}
