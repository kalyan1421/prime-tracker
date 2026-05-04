import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class LeasesService {
  constructor(private prisma: PrismaService) {}

  async findByUnit(unitId: string) {
    return this.prisma.lease.findMany({ where: { unitId }, orderBy: { leaseStart: 'desc' } });
  }

  async findByProject(projectId: string) {
    return this.prisma.lease.findMany({
      where: { unit: { building: { projectId } } },
      include: { unit: { include: { building: { select: { name: true } } } } },
      orderBy: { leaseStart: 'desc' },
    });
  }

  async getRentRoll(projectId: string) {
    const leases = await this.prisma.lease.findMany({
      where: { unit: { building: { projectId } }, status: 'ACTIVE' },
      include: { unit: { include: { building: { select: { name: true } } } } },
    });
    const totalRent = leases.reduce((s, l) => s + Number(l.monthlyRent), 0);
    return { leases, totalMonthlyRent: totalRent, leaseCount: leases.length };
  }

  async findById(id: string) {
    const lease = await this.prisma.lease.findUnique({ where: { id }, include: { unit: true } });
    if (!lease) throw new NotFoundException('Lease not found');
    return lease;
  }

  async create(data: Prisma.LeaseUncheckedCreateInput) {
    return this.prisma.lease.create({ data });
  }

  async update(id: string, data: Prisma.LeaseUncheckedUpdateInput) {
    await this.findById(id);
    return this.prisma.lease.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.lease.delete({ where: { id } });
  }
}
