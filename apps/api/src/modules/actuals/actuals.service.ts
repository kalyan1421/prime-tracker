import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

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

  async findUnmapped() {
    return this.prisma.actual.findMany({
      where: { qbSyncStatus: 'UNMAPPED' },
      orderBy: { txnDate: 'desc' },
    });
  }

  async create(data: Prisma.ActualUncheckedCreateInput) {
    return this.prisma.actual.create({ data });
  }

  async update(id: string, data: Prisma.ActualUncheckedUpdateInput) {
    return this.prisma.actual.update({ where: { id }, data });
  }

  async bulkCreate(data: Prisma.ActualUncheckedCreateInput[]) {
    return this.prisma.actual.createMany({ data, skipDuplicates: true });
  }
}
