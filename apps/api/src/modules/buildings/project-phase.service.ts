import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Derives Project.phase from its buildings.
 *
 * Rule: Project.phase = max(buildings.phase) by phase order.
 *   PRE_DEVELOPMENT < PERMITTING < CONSTRUCTION < LEASE_UP < STABILIZED < SOLD_REFI
 *
 * Why this matters: a project may have Building A in CONSTRUCTION and Building B
 * in LEASE_UP. The "project phase" should reflect the most-advanced building
 * (typically the one driving the next milestone), not the least advanced.
 *
 * Project.phase is still stored as a column for fast queries; this service
 * keeps it in sync whenever a building's phase changes.
 */

const PHASE_ORDER: Record<string, number> = {
  PRE_DEVELOPMENT: 0,
  PERMITTING: 1,
  CONSTRUCTION: 2,
  LEASE_UP: 3,
  STABILIZED: 4,
  SOLD_REFI: 5,
};

@Injectable()
export class ProjectPhaseService {
  constructor(private prisma: PrismaService) {}

  /** Recompute Project.phase from buildings. Call after any building update. */
  async recompute(projectId: string): Promise<string> {
    const buildings = await this.prisma.building.findMany({
      where: { projectId },
      select: { phase: true },
    });

    let maxPhase: string = 'PRE_DEVELOPMENT';
    for (const b of buildings) {
      if (PHASE_ORDER[b.phase] > PHASE_ORDER[maxPhase]) maxPhase = b.phase;
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: { phase: maxPhase },
    });
    return maxPhase;
  }
}
