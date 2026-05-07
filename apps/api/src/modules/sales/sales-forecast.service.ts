import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { SaleStatus } from '@prisma/client';

/**
 * Probability-weighted revenue forecast for the sales pipeline.
 *
 * Default probabilities (override per-org via OrgSettings.saleStageProbabilities):
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
 */

const DEFAULT_PROBABILITIES: Record<string, number> = {
  PROSPECT: 0.10,
  LOI_SIGNED: 0.35,
  UNDER_CONTRACT: 0.75,
  CLOSED: 1.0,
  CANCELLED: 0.0,
};

export interface PipelineForecast {
  totalPipelineValue: number;     // unweighted sum
  weightedForecast: number;       // probability-adjusted
  byStage: Array<{ stage: SaleStatus; count: number; value: number; weighted: number; probability: number }>;
  closedYtd: number;              // separate — already booked revenue
}

@Injectable()
export class SalesForecastService {
  constructor(private prisma: PrismaService) {}

  async forProject(
    projectId: string,
    overrides?: Record<string, number>,
  ): Promise<PipelineForecast> {
    const probabilities = { ...DEFAULT_PROBABILITIES, ...(overrides ?? {}) };

    const sales = await this.prisma.sale.findMany({
      where: { projectId },
      select: { status: true, salePrice: true, closingDate: true },
    });

    // Aggregate per stage
    const byStageMap = new Map<SaleStatus, { count: number; value: number }>();
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
}
