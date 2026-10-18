import {
  Injectable, NotFoundException, BadRequestException, Logger, Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { loadSiteUnitContext } from '../site-tracker/site-unit-context';
import { assertMayDelete, type DeleteActor } from '../site-tracker/site-delete-rule';
import { resolveMentions } from '../comments/mentions';
import { CreateDailyLogDto, UpdateDailyLogDto, AddDailyLogPhotoDto } from './dto/create-daily-log.dto';

/**
 * How an update arrived. Fixed, not org-configurable: each value corresponds to a code path
 * that can produce it, so adding one here would not create a way for updates to arrive.
 *
 * Only WEB and MOBILE are listed because only those two are reachable. Inbound email
 * ingestion was built on 2026-08-27 and removed the same day at the client's direction; its
 * 'EMAIL' value went with it, and 'WHATSAPP' was never wired. Listing a value nothing can
 * produce would make `?source=EMAIL` accept the filter and always return nothing, which
 * reads as "no email updates" rather than "that channel does not exist". Restoring
 * ingestion means adding the string back here — that is the whole change on this side.
 */
export const DAILY_LOG_SOURCES = ['WEB', 'MOBILE'] as const;
export type DailyLogSource = (typeof DAILY_LOG_SOURCES)[number];

@Injectable()
export class DailyLogsService {
  private readonly logger = new Logger(DailyLogsService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    @Optional() private notifications?: NotificationsService,
  ) {}

  private async signPhotos(photos: Array<{ storagePath: string }>) {
    return Promise.all(photos.map(async (p) => ({
      ...p,
      url: await this.storage.signedUrl(p.storagePath, 3600).catch(() => ''),
    })));
  }

  /**
   * Signs the log's photos and, when the log carries a thread, its replies' photos too —
   * a reply's photo is as unreadable without a signed URL as the parent's.
   */
  private async enrichPhotos<T extends { photos: Array<{ storagePath: string }>; replies?: any[] }>(log: T) {
    const photos = await this.signPhotos(log.photos);
    if (!log.replies?.length) return { ...log, photos };
    const replies = await Promise.all(
      log.replies.map(async (r: any) => ({ ...r, photos: await this.signPhotos(r.photos ?? []) })),
    );
    return { ...log, photos, replies };
  }

  async findAll(filter: { projectId?: string; buildingId?: string; unitId?: string; source?: string }) {
    if (!filter.projectId && !filter.buildingId && !filter.unitId) {
      throw new BadRequestException('A projectId, buildingId or unitId filter is required');
    }
    if (filter.source && !(DAILY_LOG_SOURCES as readonly string[]).includes(filter.source)) {
      throw new BadRequestException(`Unknown source '${filter.source}'.`);
    }
    const logs = await this.prisma.dailyLog.findMany({
      where: {
        projectId: filter.projectId, buildingId: filter.buildingId, unitId: filter.unitId,
        source: filter.source,
        // Top-level only. Replies come back nested under their parent below, so a thread
        // reads as one item rather than scattering its answers through the day.
        parentId: null,
      },
      orderBy: [{ logDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        building: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true } },
        stage: { select: { id: true, label: true, sortOrder: true } },
        photos: { orderBy: { uploadedAt: 'asc' } },
        // Oldest first: a thread is read in the order it was said.
        replies: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { id: true, name: true, avatarUrl: true } },
            photos: { orderBy: { uploadedAt: 'asc' } },
          },
        },
        _count: { select: { photos: true, replies: true } },
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

  /**
   * `source` is a SERVER-STAMPED parameter, not a DTO field. The controller derives WEB or
   * MOBILE from the request; nothing a caller sends can influence it. Kept as a parameter
   * rather than folded into the DTO precisely so that a future ingestion path can stamp its
   * own channel without the value ever being client-supplied.
   */
  async create(input: CreateDailyLogDto & { authorId: string }, source: DailyLogSource = 'WEB') {
    if (!input.projectId) throw new BadRequestException('projectId is required');
    if (!input.notes?.trim()) throw new BadRequestException('notes are required');
    // A re-send of a post that already landed (written with no signal, retried later):
    // hand back the original, and do not notify anyone twice.
    const clientRef = input.clientRef?.trim() || null;
    if (clientRef) {
      const existing = await this.prisma.dailyLog.findUnique({
        where: { authorId_clientRef: { authorId: input.authorId, clientRef } },
      });
      if (existing) return existing;
    }
    // Parent FIRST. A reply inherits its parent's placement wholesale, so validating a
    // unitId the caller sent would reject a perfectly good reply for naming the wrong unit —
    // a value that is about to be discarded anyway.
    const thread = await this.resolveParent(input.parentId ?? null);
    const buildingId = thread
      ? thread.buildingId
      : await this.resolveUnit(input.unitId ?? null, input.projectId, input.buildingId ?? null);
    await this.assertStageBelongsToUnit(input.stageId ?? null, thread?.unitId ?? input.unitId ?? null);

    let log;
    try {
      log = await this.prisma.dailyLog.create({
        data: {
          projectId: thread?.projectId ?? input.projectId,
          buildingId,
          unitId: thread ? thread.unitId : (input.unitId ?? null),
          parentId: thread?.id ?? null,
          stageId: input.stageId ?? null,
          logDate: input.logDate ? new Date(input.logDate) : new Date(),
          notes: input.notes.trim(),
          weather: input.weather,
          crewCount: input.crewCount,
          authorId: input.authorId,
          clientRef,
          source,
        },
      });
    } catch (e: any) {
      // Two copies of the same re-send racing each other: the loser returns the winner's post.
      if (clientRef && e?.code === 'P2002') {
        const won = await this.prisma.dailyLog.findUnique({
          where: { authorId_clientRef: { authorId: input.authorId, clientRef } },
        });
        if (won) return won;
      }
      throw e;
    }
    // After the write, and never awaited into the response: a mail server being slow must
    // not make posting from site feel slow, and a failed notification must not fail a post
    // that has already been saved.
    if (log.unitId) {
      void this.notifyPosted(log, thread?.id ?? null)
        .catch((e) => this.logger.warn(`Site update notification failed: ${e}`));
    }
    return log;
  }

  private async notifyPosted(
    log: { unitId: string | null; authorId: string; notes: string },
    parentId: string | null,
  ) {
    if (!this.notifications || !log.unitId) return;
    const ctx = await loadSiteUnitContext(this.prisma, log.unitId);
    if (!ctx) return;
    const parentAuthorId = parentId
      ? (await this.prisma.dailyLog.findUnique({ where: { id: parentId }, select: { authorId: true } }))?.authorId ?? null
      : null;
    const actor = await this.prisma.user.findUnique({ where: { id: log.authorId }, select: { name: true } });
    // ST-10: @mentions. A named person gets the specific "mentioned you" alert and NOT the
    // general "posted on" one as well — one post, one notification each.
    const mentioned = (await this.mentionsIn(log.notes)).filter((id) => id !== log.authorId);
    const base = {
      unitId: ctx.unitId, unitLabel: ctx.label, projectId: ctx.projectId, projectName: ctx.projectName,
      actorId: log.authorId, actorName: actor?.name ?? null, notes: log.notes,
    };
    if (mentioned.length) await this.notifications.notifySiteUpdateMention({ ...base, mentionedUserIds: mentioned });
    await this.notifications.notifySiteUpdatePosted({ ...base, parentAuthorId, skipUserIds: mentioned });
  }

  /** Active users named in `text` — the same resolveMentions() the comments use. */
  private async mentionsIn(text: string): Promise<string[]> {
    if (!text.includes('@')) return [];
    const users = await this.prisma.user.findMany({
      where: { isActive: true }, select: { id: true, name: true, email: true },
    });
    return resolveMentions(text, users);
  }

  /**
   * An edit that names somebody new tells that person — and only them. Re-saving a post
   * must not re-alert everyone it already mentioned.
   */
  private async notifyNewMentions(
    log: { unitId: string | null; authorId: string; notes: string },
    before: string,
  ) {
    if (!this.notifications || !log.unitId) return;
    const [now, was] = await Promise.all([this.mentionsIn(log.notes), this.mentionsIn(before)]);
    const fresh = now.filter((id) => !was.includes(id) && id !== log.authorId);
    if (!fresh.length) return;
    const ctx = await loadSiteUnitContext(this.prisma, log.unitId);
    if (!ctx) return;
    const actor = await this.prisma.user.findUnique({ where: { id: log.authorId }, select: { name: true } });
    await this.notifications.notifySiteUpdateMention({
      unitId: ctx.unitId, unitLabel: ctx.label, projectId: ctx.projectId, projectName: ctx.projectName,
      actorId: log.authorId, actorName: actor?.name ?? null, notes: log.notes, mentionedUserIds: fresh,
    });
  }

  /**
   * Validates that a unit belongs to the log's project, and derives the building from it so
   * a unit-level log can never be filed under a building the unit is not in.
   * Returns the buildingId to store.
   */
  /**
   * Validates the parent of a reply and returns its placement.
   *
   * One level only: replying to a reply is refused. Site updates are a conversation about
   * one event, not a forum — arbitrary nesting buys indentation and costs the ability to
   * read a day at a glance, and it makes the "top-level only" list query recursive.
   */
  private async resolveParent(parentId: string | null) {
    if (!parentId) return null;
    const parent = await this.prisma.dailyLog.findUnique({
      where: { id: parentId },
      select: { id: true, projectId: true, buildingId: true, unitId: true, parentId: true },
    });
    if (!parent) throw new NotFoundException('The update being replied to no longer exists');
    if (parent.parentId) {
      throw new BadRequestException('Replies are one level deep — reply to the original update instead.');
    }
    return parent;
  }

  /** A pinned stage has to belong to the unit the update is filed against. */
  private async assertStageBelongsToUnit(stageId: string | null, unitId: string | null) {
    if (!stageId) return;
    if (!unitId) throw new BadRequestException('Only a unit-level update can be pinned to a stage.');
    const stage = await this.prisma.unitConstructionStage.findUnique({
      where: { id: stageId }, select: { unitId: true },
    });
    if (!stage) throw new NotFoundException('Checklist stage not found');
    if (stage.unitId !== unitId) {
      throw new BadRequestException('That checklist stage belongs to a different unit.');
    }
  }

  private async resolveUnit(unitId: string | null, projectId: string, buildingId: string | null) {
    if (!unitId) return buildingId;
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { deletedAt: true, buildingId: true, building: { select: { projectId: true } } },
    });
    if (!unit || unit.deletedAt) throw new NotFoundException('Unit not found');
    if (unit.building.projectId !== projectId) {
      throw new BadRequestException('That unit does not belong to this project.');
    }
    return unit.buildingId;
  }

  async update(id: string, input: UpdateDailyLogDto) {
    const existing = await this.findById(id);
    if (input.stageId !== undefined) {
      await this.assertStageBelongsToUnit(
        input.stageId ?? null,
        input.unitId === undefined ? existing.unitId : (input.unitId ?? null),
      );
    }
    const updated = await this.prisma.dailyLog.update({
      where: { id },
      data: {
        logDate: input.logDate ? new Date(input.logDate) : undefined,
        notes: input.notes?.trim(),
        weather: input.weather,
        crewCount: input.crewCount,
        buildingId: input.buildingId === undefined ? undefined : input.buildingId,
        unitId: input.unitId === undefined ? undefined : input.unitId,
        stageId: input.stageId === undefined ? undefined : input.stageId,
      },
    });
    if (input.notes !== undefined && updated.notes !== existing.notes) {
      void this.notifyNewMentions(updated, existing.notes ?? '')
        .catch((e) => this.logger.warn(`Site mention notification failed: ${e}`));
    }
    return updated;
  }

  async remove(id: string, actor?: DeleteActor) {
    const log = await this.findById(id);
    assertMayDelete(actor, log.authorId, 'update');
    return this.prisma.dailyLog.delete({ where: { id } });
  }

  async addPhoto(dailyLogId: string, input: AddDailyLogPhotoDto) {
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

  /** A photo belongs to whoever wrote the update it is attached to. */
  async removePhoto(photoId: string, actor?: DeleteActor) {
    const photo = await this.prisma.dailyLogPhoto.findUnique({
      where: { id: photoId },
      select: { id: true, dailyLog: { select: { authorId: true } } },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    assertMayDelete(actor, photo.dailyLog.authorId, 'photo');
    return this.prisma.dailyLogPhoto.delete({ where: { id: photoId } });
  }
}
