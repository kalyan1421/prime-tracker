import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class MilestonesService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.milestone.findMany({
      where: { projectId },
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findById(id: string) {
    const m = await this.prisma.milestone.findUnique({ where: { id }, include: { owner: true } });
    if (!m) throw new NotFoundException('Milestone not found');
    return m;
  }

  async create(data: Prisma.MilestoneUncheckedCreateInput) {
    return this.prisma.milestone.create({ data });
  }

  async update(id: string, data: Prisma.MilestoneUncheckedUpdateInput) {
    const existing = await this.findById(id);
    // Only auto-set completedAt on first completion — never overwrite an existing timestamp
    if (data.status === 'COMPLETED' && !existing.completedAt && !data.completedAt) {
      data.completedAt = new Date();
    }
    return this.prisma.milestone.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.milestone.delete({ where: { id } });
  }
}
