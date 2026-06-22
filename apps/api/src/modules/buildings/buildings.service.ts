import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BuildingType, ProjectPhase } from '@prisma/client';
import { ProjectPhaseService } from './project-phase.service';
import { StorageService } from '../../common/storage/storage.service';

@Injectable()
export class BuildingsService {
  constructor(
    private prisma: PrismaService,
    private projectPhase: ProjectPhaseService,
    private storage: StorageService,
  ) {}

  private async withCoverUrl<T extends { coverPhotoPath?: string | null }>(b: T) {
    const coverPhotoUrl = b.coverPhotoPath
      ? await this.storage.signedUrl(b.coverPhotoPath, 3600).catch(() => '')
      : null;
    return { ...b, coverPhotoUrl };
  }

  async findByProject(projectId: string) {
    if (!projectId) {
      throw new BadRequestException('projectId query parameter is required');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const buildings = await this.prisma.building.findMany({
      where: { projectId },
      include: { _count: { select: { units: true } } },
      orderBy: { name: 'asc' },
    });
    return Promise.all(buildings.map((b) => this.withCoverUrl(b)));
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
    return this.withCoverUrl(building);
  }

  async create(input: {
    projectId: string;
    name: string;
    totalSqft?: number;
    stories?: number;
    buildingType?: BuildingType;
    phase?: ProjectPhase;
    coverPhotoPath?: string;
  }) {
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, status: true },
    });
    if (!project) throw new NotFoundException(`Project ${input.projectId} not found`);
    if (project.status === 'CANCELLED') {
      throw new ConflictException('Cannot add buildings to an archived project');
    }

    const building = await this.prisma.building.create({
      data: input,
      include: { _count: { select: { units: true } } },
    });
    // Recompute project phase since a new building changes the max
    await this.projectPhase.recompute(input.projectId);
    return building;
  }

  async update(id: string, input: {
    name?: string;
    totalSqft?: number;
    stories?: number;
    buildingType?: BuildingType;
    phase?: ProjectPhase;
    coverPhotoPath?: string;
  }) {
    const existing = await this.findById(id);
    const updated = await this.prisma.building.update({
      where: { id },
      data: input,
      include: { _count: { select: { units: true } } },
    });
    // If phase changed, project phase may shift up or down
    if (input.phase && input.phase !== existing.phase) {
      await this.projectPhase.recompute(existing.projectId);
    }
    return updated;
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

    const result = await this.prisma.building.delete({ where: { id } });
    await this.projectPhase.recompute(building.projectId);
    return result;
  }
}
