import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

@Injectable()
export class DailyLogsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  private async enrichPhotos<T extends { photos: Array<{ storagePath: string }> }>(log: T) {
    const photos = await Promise.all(
      log.photos.map(async (p) => ({
        ...p,
        url: await this.storage.signedUrl(p.storagePath, 3600).catch(() => ''),
      })),
    );
    return { ...log, photos };
  }

  async findAll(filter: { projectId?: string; buildingId?: string }) {
    if (!filter.projectId && !filter.buildingId) {
      throw new BadRequestException('A projectId or buildingId filter is required');
    }
    const logs = await this.prisma.dailyLog.findMany({
      where: { projectId: filter.projectId, buildingId: filter.buildingId },
      orderBy: [{ logDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        building: { select: { id: true, name: true } },
        photos: { orderBy: { uploadedAt: 'asc' } },
        _count: { select: { photos: true } },
      },
    });
    return Promise.all(logs.map((l) => this.enrichPhotos(l)));
  }

  async findById(id: string) {
    const log = await this.prisma.dailyLog.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        building: { select: { id: true, name: true } },
        photos: { orderBy: { uploadedAt: 'asc' } },
      },
    });
    if (!log) throw new NotFoundException('Daily log not found');
    return this.enrichPhotos(log);
  }

  async create(input: {
    projectId: string;
    buildingId?: string;
    logDate?: string;
    notes: string;
    weather?: string;
    crewCount?: number;
    authorId: string;
  }) {
    if (!input.projectId) throw new BadRequestException('projectId is required');
    if (!input.notes?.trim()) throw new BadRequestException('notes are required');
    return this.prisma.dailyLog.create({
      data: {
        projectId: input.projectId,
        buildingId: input.buildingId ?? null,
        logDate: input.logDate ? new Date(input.logDate) : new Date(),
        notes: input.notes.trim(),
        weather: input.weather,
        crewCount: input.crewCount,
        authorId: input.authorId,
      },
    });
  }

  async update(
    id: string,
    input: { logDate?: string; notes?: string; weather?: string; crewCount?: number; buildingId?: string | null },
  ) {
    await this.findById(id);
    return this.prisma.dailyLog.update({
      where: { id },
      data: {
        logDate: input.logDate ? new Date(input.logDate) : undefined,
        notes: input.notes?.trim(),
        weather: input.weather,
        crewCount: input.crewCount,
        buildingId: input.buildingId === undefined ? undefined : input.buildingId,
      },
    });
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.dailyLog.delete({ where: { id } });
  }

  async addPhoto(dailyLogId: string, input: { storagePath: string; caption?: string }) {
    await this.findById(dailyLogId);
    if (!input.storagePath) throw new BadRequestException('storagePath is required');
    // Defensive: storagePath must be a relative bucket key from our presigned-upload flow,
    // not an absolute path, traversal, or external URL.
    const path = input.storagePath;
    if (path.startsWith('/') || path.includes('..') || /^[a-z]+:\/\//i.test(path)) {
      throw new BadRequestException('Invalid storagePath');
    }
    return this.prisma.dailyLogPhoto.create({
      data: { dailyLogId, storagePath: input.storagePath, caption: input.caption },
    });
  }

  removePhoto(photoId: string) {
    return this.prisma.dailyLogPhoto.delete({ where: { id: photoId } });
  }
}
