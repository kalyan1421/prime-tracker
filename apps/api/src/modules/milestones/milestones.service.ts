import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { EventBus } from '../../common/events/event-bus.service';
import { MilestoneDepsService } from './milestone-deps.service';
import { StorageService } from '../../common/storage/storage.service';

@Injectable()
export class MilestonesService {
  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
    private deps: MilestoneDepsService,
    private storage: StorageService,
  ) {}

  private async enrichPhotos<T extends { photos: Array<{ storagePath: string }> }>(item: T) {
    const photos = await Promise.all(
      item.photos.map(async (p) => ({
        ...p,
        url: await this.storage.signedUrl(p.storagePath, 3600).catch(() => ''),
      })),
    );
    return { ...item, photos };
  }

  async findByProject(projectId: string) {
    const milestones = await this.prisma.milestone.findMany({
      where: { projectId },
      include: {
        owner: { select: { id: true, name: true } },
        dependsOn: { select: { id: true, title: true, status: true } },
        photos: { orderBy: { uploadedAt: 'desc' }, take: 5 },
        _count: { select: { photos: true, dependents: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
    return Promise.all(milestones.map((m) => this.enrichPhotos(m)));
  }

  async findById(id: string) {
    const m = await this.prisma.milestone.findUnique({
      where: { id },
      include: {
        owner: true,
        dependsOn: { select: { id: true, title: true, status: true, dueDate: true } },
        dependents: { select: { id: true, title: true, status: true, dueDate: true } },
        photos: { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { uploadedAt: 'desc' } },
        linkedDrawSchedule: true,
      },
    });
    if (!m) throw new NotFoundException('Milestone not found');
    return this.enrichPhotos(m);
  }

  async create(data: Prisma.MilestoneUncheckedCreateInput) {
    // class-validator's @IsDateString() accepts a bare "YYYY-MM-DD" date, but Prisma's
    // DateTime column needs a full ISO-8601 datetime — pass a Date object so Prisma
    // serializes it correctly instead of erroring "premature end of input".
    if (typeof data.dueDate === 'string') data.dueDate = new Date(data.dueDate);
    return this.prisma.milestone.create({ data });
  }

  async update(id: string, data: Prisma.MilestoneUncheckedUpdateInput) {
    const existing = await this.findById(id);
    const wasCompleted = existing.status === 'COMPLETED';
    if (typeof data.dueDate === 'string') data.dueDate = new Date(data.dueDate);

    // Auto-stamp completedAt the first time a milestone is marked COMPLETED.
    if (data.status === 'COMPLETED' && !existing.completedAt && !data.completedAt) {
      data.completedAt = new Date();
    }

    // Slippage detection: a non-completed milestone whose due date moves later
    // should propagate the delta to its dependents.
    let daysSlipped = 0;
    if (data.dueDate && existing.status !== 'COMPLETED') {
      const newDate = new Date(data.dueDate as Date);
      const oldDate = existing.dueDate;
      daysSlipped = Math.floor(
        (newDate.getTime() - oldDate.getTime()) / (1000 * 60 * 60 * 24),
      );
    }

    const updated = await this.prisma.milestone.update({ where: { id }, data });

    // Fire-and-forget post-write side effects — wrapped in setImmediate via EventBus
    if (data.status === 'COMPLETED' && !wasCompleted) {
      this.bus.emit({
        type: 'milestone.completed',
        milestoneId: id,
        projectId: existing.projectId,
        completedAt: updated.completedAt ?? new Date(),
      });
    }
    if (daysSlipped > 0) {
      // Fire and forget — don't block the response
      this.deps.propagateSlippage(id, daysSlipped).catch(() => {});
    }
    return updated;
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.milestone.delete({ where: { id } });
  }
}
