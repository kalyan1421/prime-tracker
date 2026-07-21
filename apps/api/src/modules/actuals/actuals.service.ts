import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { resolveProjectScope } from '../../common/utils/resolve-project-scope';

@Injectable()
export class ActualsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    // Interior/TI actuals are reported in the interior module, not the project cost list.
    return this.prisma.actual.findMany({
      where: { projectId, interiorProjectId: null },
      orderBy: { txnDate: 'desc' },
    });
  }

  async findByBuilding(buildingId: string) {
    return this.prisma.actual.findMany({
      where: { buildingId, interiorProjectId: null },
      orderBy: { txnDate: 'desc' },
    });
  }

  async findByUnit(unitId: string) {
    return this.prisma.actual.findMany({
      where: { unitId, interiorProjectId: null },
      orderBy: { txnDate: 'desc' },
    });
  }

  async findUnmapped() {
    return this.prisma.actual.findMany({
      where: { qbSyncStatus: 'UNMAPPED' },
      orderBy: { txnDate: 'desc' },
    });
  }

  async create(data: Prisma.ActualUncheckedCreateInput) {
    const { buildingId, unitId } = await resolveProjectScope(this.prisma, data.projectId, data.buildingId ?? undefined, data.unitId ?? undefined);
    return this.prisma.actual.create({ data: { ...data, buildingId, unitId } });
  }

  async update(id: string, data: Prisma.ActualUncheckedUpdateInput) {
    if (data.buildingId !== undefined || data.unitId !== undefined) {
      const actual = await this.prisma.actual.findUnique({ where: { id }, select: { projectId: true } });
      if (!actual) throw new NotFoundException('Actual not found');
      const resolved = await resolveProjectScope(
        this.prisma,
        actual.projectId,
        (data.buildingId as string | null | undefined) ?? undefined,
        (data.unitId as string | null | undefined) ?? undefined,
      );
      data.buildingId = resolved.buildingId ?? null;
      data.unitId = resolved.unitId ?? null;
    }
    return this.prisma.actual.update({ where: { id }, data });
  }

  async bulkCreate(data: Prisma.ActualUncheckedCreateInput[]) {
    return this.prisma.actual.createMany({ data, skipDuplicates: true });
  }
}
