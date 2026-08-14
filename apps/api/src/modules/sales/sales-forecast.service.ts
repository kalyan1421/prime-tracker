import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_SALE_STAGE_PROBABILITIES } from '@prime-tracker/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Probability-weighted revenue forecast for the sales pipeline.
 *
 * Default probabilities (overridden per-org via OrgSettings.saleStageProbabilities):
 *   PROSPECT:        10%
 *   LOI_SIGNED:      35%
 *   UNDER_CONTRACT:  75%
 *   CLOSED:         100%  (real revenue, included in YTD if you want)
 *   CANCELLED:        0%
 *
 * Forecast = sum(salePrice × probability) for non-CLOSED, non-CANCELLED deals.
 *
 * This is what gets pitched to lenders: "expected pipeline revenue $X.YM."
 * Cleaner than total pipeline value (overstates) or just closed-only (understates).
 *
 * Resolution: the service reaches the org itself (project → orgId → OrgSettings), so
 * callers do not have to know that per-org tuning exists. The `overrides` argument
 * stays as an explicit escape hatch and wins over the stored settings when supplied.
 */

/**
 * Single source of truth for the stage defaults, shared with the settings write path.
 *
 * This was a third local copy of the same map — alongside the shared constant and the
 * Prisma `@default` on OrgSettings.saleStageProbabilities. Three copies of a number that
 * feeds a lender-facing forecast is exactly the kind of drift nobody notices until the
 * settings screen and the forecast disagree.
 */
const DEFAULT_PROBABILITIES: Record<string, number> = DEFAULT_SALE_STAGE_PROBABILITIES;

const KNOWN_STAGES = new Set(Object.keys(DEFAULT_PROBABILITIES));

export interface PipelineForecast {
  totalPipelineValue: number;     // unweighted sum
  weightedForecast: number;       // probability-adjusted
  byStage: Array<{ stage: string; count: number; value: number; weighted: number; probability: number }>;
  closedYtd: number;              // separate — already booked revenue
}

@Injectable()
export class SalesForecastService {
  private readonly logger = new Logger(SalesForecastService.name);

  constructor(private prisma: PrismaService) {}

  async forProject(
    projectId: string,
    overrides?: Record<string, number>,
  ): Promise<PipelineForecast> {
    // An explicit argument wins outright; otherwise go and find the org's own tuning.
    const resolved = overrides ?? (await this.resolveStageProbabilities(projectId));
    const probabilities = { ...DEFAULT_PROBABILITIES, ...resolved };

    const sales = await this.prisma.sale.findMany({
      where: { projectId, deletedAt: null },
      select: { status: true, salePrice: true, closingDate: true },
    });

    // Aggregate per stage
    const byStageMap = new Map<string, { count: number; value: number }>();
    let closedYtd = 0;
    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    for (const s of sales) {
      const value = Number(s.salePrice ?? 0);
      const current = byStageMap.get(s.status) ?? { count: 0, value: 0 };
      byStageMap.set(s.status, { count: current.count + 1, value: current.value + value });

      if (s.status === 'CLOSED' && s.closingDate && s.closingDate >= yearStart) {
        closedYtd += value;
      }
    }

    const byStage = Array.from(byStageMap.entries()).map(([stage, agg]) => {
      const probability = probabilities[stage] ?? 0;
      return {
        stage,
        count: agg.count,
        value: agg.value,
        probability,
        weighted: agg.value * probability,
      };
    });

    // Pipeline = everything except CLOSED (already booked) and CANCELLED (gone)
    const inFlight = byStage.filter((s) => s.stage !== 'CLOSED' && s.stage !== 'CANCELLED');
    const totalPipelineValue = inFlight.reduce((sum, s) => sum + s.value, 0);
    const weightedForecast = inFlight.reduce((sum, s) => sum + s.weighted, 0);

    return { totalPipelineValue, weightedForecast, byStage, closedYtd };
  }

  /**
   * project → its organization → OrgSettings.saleStageProbabilities.
   *
   * Mirrors SalesService.resolveDiscountThreshold so both agree on how an org is
   * reached from a project. Returns only the entries that survive sanitisation —
   * the caller merges them over the defaults, so a partial (or empty) map leaves
   * every other stage untouched.
   *
   * Never throws: a forecast on stale defaults beats a 500 on the endpoint.
   */
  private async resolveStageProbabilities(projectId: string): Promise<Record<string, number>> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { orgId: true },
      });
      if (!project?.orgId) return {};

      const settings = await this.prisma.orgSettings.findUnique({
        where: { orgId: project.orgId },
        select: { saleStageProbabilities: true },
      });
      if (!settings) return {};

      return this.sanitizeProbabilities(settings.saleStageProbabilities, project.orgId);
    } catch (err) {
      this.logger.warn(
        `Could not resolve sale stage probabilities for project ${projectId}; using defaults: ${
          (err as Error)?.message ?? err
        }`,
      );
      return {};
    }
  }

  /**
   * The column is stored JSON, so it is untrusted: it can be null, a scalar, an array,
   * or a hand-edited object with junk in it. Anything that is not a finite number in
   * 0..1 under a known stage key is dropped, which leaves that stage on its default —
   * silently forecasting 0 because someone typed "high" is the worst possible outcome.
   */
  private sanitizeProbabilities(raw: unknown, orgId: string): Record<string, number> {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      if (raw != null) {
        this.logger.warn(
          `OrgSettings.saleStageProbabilities for org ${orgId} is not an object; using defaults`,
        );
      }
      return {};
    }

    const out: Record<string, number> = {};
    for (const [stage, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!KNOWN_STAGES.has(stage)) {
        this.logger.warn(
          `Ignoring unknown sale stage "${stage}" in saleStageProbabilities for org ${orgId}`,
        );
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        this.logger.warn(
          `Ignoring invalid probability ${JSON.stringify(value)} for stage "${stage}" ` +
            `in saleStageProbabilities for org ${orgId}; falling back to the default`,
        );
        continue;
      }
      out[stage] = value;
    }
    return out;
  }
}
