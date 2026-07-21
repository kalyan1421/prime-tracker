import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Validates an optional buildingId/unitId against a project (and each other), and
 * derives buildingId from unitId when only unitId is supplied. Shared by
 * BudgetsService/CommitmentsService/ActualsService — all three attach financial
 * records to a Project and optionally scope them down to a Building or Unit,
 * mirroring the Loan polymorphic pattern.
 */
export async function resolveProjectScope(
  prisma: PrismaService,
  projectId: string,
  buildingId?: string,
  unitId?: string,
): Promise<{ buildingId?: string; unitId?: string }> {
  if (unitId) {
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      select: { id: true, buildingId: true, building: { select: { projectId: true } } },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    if (unit.building.projectId !== projectId) {
      throw new BadRequestException('Unit does not belong to this project');
    }
    if (buildingId && buildingId !== unit.buildingId) {
      throw new BadRequestException('Unit does not belong to the given building');
    }
    return { buildingId: unit.buildingId, unitId };
  }
  if (buildingId) {
    const building = await prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true, projectId: true },
    });
    if (!building) throw new NotFoundException('Building not found');
    if (building.projectId !== projectId) {
      throw new BadRequestException('Building does not belong to this project');
    }
    return { buildingId, unitId: undefined };
  }
  return { buildingId: undefined, unitId: undefined };
}
