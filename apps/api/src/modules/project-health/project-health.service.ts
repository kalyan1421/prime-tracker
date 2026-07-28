import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

/**
 * Project Health Score — 0–100, unit-based only.
 *
 * AbsorptionRate = (sold + leased/occupied + 0.5*pipeline) / marketable units
 * (marketable = total units minus UNDER_CONSTRUCTION — not yet sellable/leasable;
 *  pipeline = UNDER_CONTRACT + LEASE_PENDING, counted at half credit since not yet closed)
 *
 * score = clamp(round(AbsorptionRate*100) - stalePenalty, 0, 100)
 * stalePenalty = min(30, staleVacantCount * 5), stale = AVAILABLE >90 days
 *
 * Cached 60s per project. Recomputed on relevant domain events.
 */

const TTL_SECONDS = 60;
const CACHE_TAG = 'projectHealth';

export interface ProjectHealth {
  score: number;
  breakdown: {
    units: { score: number; reason: string };
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
    const units = await this.unitScore(projectId);
    return { score: units.score, breakdown: { units } };
  }

  // ─────── Component: Units (sold / leased / vacant) ───────
  // AbsorptionRate = (sold + leased/occupied + 0.5*pipeline) / marketable units
  // (marketable excludes UNDER_CONSTRUCTION — not yet sellable/leasable)
  // score = clamp(round(AbsorptionRate*100) - stalePenalty, 0, 100)
  // stalePenalty = min(30, staleVacantCount * 5), stale = AVAILABLE >90 days
  private async unitScore(projectId: string) {
    const buildings = await this.prisma.building.findMany({
      where: { projectId },
      select: { units: { where: { deletedAt: null }, select: { status: true, availableSince: true } } },
    });
    const allUnits = buildings.flatMap((b) => b.units);

    const underConstruction = allUnits.filter((u) => u.status === 'UNDER_CONSTRUCTION').length;
    const marketable = allUnits.length - underConstruction;

    if (marketable === 0) {
      return {
        score: 80,
        reason: allUnits.length === 0 ? 'No units yet' : 'All units under construction',
      };
    }

    const sold = allUnits.filter((u) => u.status === 'SOLD').length;
    const leased = allUnits.filter((u) => u.status === 'LEASED' || u.status === 'OCCUPIED').length;
    const pipeline = allUnits.filter((u) => u.status === 'UNDER_CONTRACT' || u.status === 'LEASE_PENDING').length;
    const available = allUnits.filter((u) => u.status === 'AVAILABLE').length;

    const absorptionRate = (sold + leased + 0.5 * pipeline) / marketable;

    // Stale inventory = available > 90 days
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const staleVacant = allUnits.filter(
      (u) => u.status === 'AVAILABLE' && u.availableSince && u.availableSince.getTime() < cutoff,
    ).length;
    const penalty = Math.min(30, staleVacant * 5);

    const score = Math.max(0, Math.min(100, Math.round(absorptionRate * 100) - penalty));
    const reason = `${sold} sold, ${leased} leased, ${available} vacant of ${marketable} marketable`
      + (staleVacant > 0 ? ` (${staleVacant} stale >90d)` : '');

    return { score, reason };
  }
}
