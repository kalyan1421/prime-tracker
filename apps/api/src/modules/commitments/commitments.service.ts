import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CommitmentsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.commitment.findMany({ where: { projectId }, orderBy: { vendor: 'asc' } });
  }

  async findById(id: string) {
    const c = await this.prisma.commitment.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Commitment not found');
    return c;
  }

  async create(data: Prisma.CommitmentUncheckedCreateInput) {
    return this.prisma.commitment.create({ data });
  }

  async update(id: string, data: Prisma.CommitmentUncheckedUpdateInput) {
    await this.findById(id);
    return this.prisma.commitment.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.commitment.delete({ where: { id } });
  }
}
