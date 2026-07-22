import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { resolveProjectScope } from '../../common/utils/resolve-project-scope';

@Injectable()
export class CommitmentsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.commitment.findMany({ where: { projectId }, orderBy: { vendor: 'asc' } });
  }

  async findByBuilding(buildingId: string) {
    return this.prisma.commitment.findMany({ where: { buildingId }, orderBy: { vendor: 'asc' } });
  }

  async findByUnit(unitId: string) {
    return this.prisma.commitment.findMany({ where: { unitId }, orderBy: { vendor: 'asc' } });
  }

  async findById(id: string) {
    const c = await this.prisma.commitment.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Commitment not found');
    return c;
  }

  async create(data: Prisma.CommitmentUncheckedCreateInput) {
    const { buildingId, unitId } = await resolveProjectScope(this.prisma, data.projectId, data.buildingId ?? undefined, data.unitId ?? undefined);
    // class-validator's @IsDateString() accepts a bare "YYYY-MM-DD" date, but Prisma's
    // DateTime column needs a full ISO-8601 datetime — pass a Date object so Prisma
    // serializes it correctly instead of erroring "premature end of input".
    if (typeof data.contractDate === 'string') {
      data.contractDate = new Date(data.contractDate);
    }
    return this.prisma.commitment.create({ data: { ...data, buildingId, unitId } });
  }

  async update(id: string, data: Prisma.CommitmentUncheckedUpdateInput) {
    const c = await this.findById(id);
    if (data.buildingId !== undefined || data.unitId !== undefined) {
      const resolved = await resolveProjectScope(
        this.prisma,
        c.projectId,
        (data.buildingId as string | null | undefined) ?? undefined,
        (data.unitId as string | null | undefined) ?? undefined,
      );
      data.buildingId = resolved.buildingId ?? null;
      data.unitId = resolved.unitId ?? null;
    }
    if (typeof data.contractDate === 'string') {
      data.contractDate = new Date(data.contractDate);
    }
    return this.prisma.commitment.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.commitment.delete({ where: { id } });
  }
}
