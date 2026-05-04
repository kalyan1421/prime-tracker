import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BuildingType } from '@prisma/client';

@Injectable()
export class BuildingsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    if (!projectId) {
      throw new BadRequestException('projectId query parameter is required');
    }
    // Verify project exists — surfaces 404 instead of silently returning [].
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    return this.prisma.building.findMany({
      where: { projectId },
      include: { _count: { select: { units: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const building = await this.prisma.building.findUnique({
      where: { id },
      include: {
        units: true,
        _count: { select: { units: true } },
        project: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!building) throw new NotFoundException('Building not found');
    return building;
  }

  async create(input: {
    projectId: string;
    name: string;
    totalSqft?: number;
    stories?: number;
    buildingType?: BuildingType;
  }) {
    // Verify project exists before creating — better than letting Prisma throw a generic FK error.
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, status: true },
    });
    if (!project) throw new NotFoundException(`Project ${input.projectId} not found`);
    if (project.status === 'CANCELLED') {
      throw new ConflictException('Cannot add buildings to an archived project');
    }

    return this.prisma.building.create({
      data: input,
      include: { _count: { select: { units: true } } },
    });
  }

  async update(id: string, input: {
    name?: string;
    totalSqft?: number;
    stories?: number;
    buildingType?: BuildingType;
  }) {
    await this.findById(id);
    return this.prisma.building.update({
      where: { id },
      data: input,
      include: { _count: { select: { units: true } } },
    });
  }

  async delete(id: string, force = false) {
    const building = await this.findById(id);
    const unitCount = building._count.units;

    if (unitCount > 0 && !force) {
      throw new ConflictException(
        `Building '${building.name}' has ${unitCount} unit${unitCount === 1 ? '' : 's'}. ` +
        `Delete the units first, or pass ?force=true to delete the building and all its units.`,
      );
    }

    return this.prisma.building.delete({ where: { id } });
  }
}
