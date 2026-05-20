import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class LeasesService {
  constructor(private prisma: PrismaService) {}

  async findByUnit(unitId: string) {
    return this.prisma.lease.findMany({ where: { unitId }, orderBy: { leaseStart: 'desc' } });
  }

  /** Sprint 1: building-level leases (e.g. Leander Bldg 1 leased as one whole asset). */
  async findByBuilding(buildingId: string) {
    return this.prisma.lease.findMany({ where: { buildingId }, orderBy: { leaseStart: 'desc' } });
  }

  async findByProject(projectId: string) {
    // OR clause to capture both unit-leases (via unit→building→project) and
    // building-leases (via building→project) under one project.
    return this.prisma.lease.findMany({
      where: {
        OR: [
          { unit: { building: { projectId } } },
          { building: { projectId } },
        ],
      },
      include: {
        unit: { include: { building: { select: { name: true } } } },
        building: { select: { id: true, name: true } },
      },
      orderBy: { leaseStart: 'desc' },
    });
  }

  async getRentRoll(projectId: string) {
    const leases = await this.prisma.lease.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { unit: { building: { projectId } } },
          { building: { projectId } },
        ],
      },
      include: {
        unit: { include: { building: { select: { name: true } } } },
        building: { select: { id: true, name: true } },
      },
    });
    const totalRent = leases.reduce((s, l) => s + Number(l.monthlyRent), 0);
    return { leases, totalMonthlyRent: totalRent, leaseCount: leases.length };
  }

  async findById(id: string) {
    const lease = await this.prisma.lease.findUnique({
      where: { id },
      include: { unit: true, building: { select: { id: true, name: true, projectId: true } } },
    });
    if (!lease) throw new NotFoundException('Lease not found');
    return lease;
  }

  async create(data: Prisma.LeaseUncheckedCreateInput) {
    // Sprint 1: leases are polymorphic — exactly one of (unitId, buildingId) required.
    const unitId = data.unitId as string | null | undefined;
    const buildingId = data.buildingId as string | null | undefined;
    if (!unitId && !buildingId) {
      throw new BadRequestException('Lease must reference either a unit or a building');
    }
    if (unitId && buildingId) {
      throw new BadRequestException('Lease cannot reference both a unit and a building');
    }
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
