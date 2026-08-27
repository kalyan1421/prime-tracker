import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, NotificationType } from '@prisma/client';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService, LEADERSHIP_ROLES } from '../notifications/notifications.service';
import { resolveMentions } from '../comments/mentions';

/**
 * Who may edit/delete somebody ELSE's post. Narrower than `updateBoard:create` (which now
 * every internal role but VIEWER holds) — matches the asymmetry TasksService uses for comment
 * deletion: creating is broader authority than reaching into someone else's item.
 */
const UPDATE_BOARD_ADMIN_ROLES = ['SUPER_ADMIN', 'FOUNDER'];

/** The viewer identity every visibility/authorization check needs. */
type Viewer = { userId: string; role: string };

/** Everything a feed row needs, in one shape so list and detail cannot drift. */
const POST_INCLUDE = {
  project: { select: { id: true, name: true } },
  building: { select: { id: true, name: true } },
  unit: { select: { id: true, unitNumber: true } },
  createdBy: { select: { id: true, name: true, avatarUrl: true } },
  assignments: {
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  },
  _count: { select: { comments: true, attachments: true } },
} satisfies Prisma.UpdateBoardPostInclude;

type LinkInput = { url?: string; label?: string };

@Injectable()
export class UpdateBoardService {
  private readonly logger = new Logger(UpdateBoardService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private notifications: NotificationsService,
  ) {}

  // ---- Post CRUD ----

  async findAll(params: {
    projectId?: string;
    buildingId?: string;
    unitId?: string;
    assignedTo?: string;
    status?: string;
    priority?: string;
    search?: string;
    pinned?: boolean;
  } = {}, viewer: Viewer) {
    const { projectId, buildingId, unitId, assignedTo, status, priority, search, pinned } = params;
    // Not project-scoped: every internal role sees every post regardless of project
    // membership. The three tags below are filters, not an access boundary. Restricted
    // ("Leadership Only") posts ARE an access boundary, applied below via `where.AND` so it
    // composes with the search `where.OR` instead of clobbering it.
    const where: Prisma.UpdateBoardPostWhereInput = { deletedAt: null };

    if (projectId) where.projectId = projectId;
    if (buildingId) where.buildingId = buildingId;
    if (unitId) where.unitId = unitId;
    if (assignedTo) where.assignments = { some: { userId: assignedTo } };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (pinned !== undefined) where.pinned = pinned;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (!LEADERSHIP_ROLES.includes(viewer.role as any)) {
      where.AND = [
        {
          OR: [
            { restricted: false },
            { createdById: viewer.userId },
            { assignments: { some: { userId: viewer.userId } } },
          ],
        },
      ];
    }

    return this.prisma.updateBoardPost.findMany({
      where,
      include: POST_INCLUDE,
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findById(id: string, viewer: Viewer) {
    const post = await this.prisma.updateBoardPost.findUnique({
      where: { id },
      include: {
        ...POST_INCLUDE,
        comments: {
          include: { author: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          include: { uploadedBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!post || post.deletedAt) throw new NotFoundException('Update not found');
    this.assertVisible(post, viewer);
    return this.signAttachments(post);
  }

  /**
   * "Leadership Only" hides a post from everyone except leadership, its own creator, and
   * anyone explicitly tagged on it. Tagged-assignee inclusion is load-bearing, not
   * incidental: notifyAssigned already tells a tagged person "you were tagged on this" with
   * a link, and a link that 404s for them would be a broken notification, not a security
   * feature. NotFoundException (not Forbidden) so existence itself isn't leaked — same
   * pattern ProjectAccessGuard uses for a project a scoped role isn't staffed on.
   */
  private assertVisible(
    post: { restricted: boolean; createdById: string; assignments: Array<{ userId: string }> },
    viewer: Viewer,
  ) {
    if (!post.restricted) return;
    if (LEADERSHIP_ROLES.includes(viewer.role as any)) return;
    if (post.createdById === viewer.userId) return;
    if (post.assignments.some((a) => a.userId === viewer.userId)) return;
    throw new NotFoundException('Update not found');
  }

  async create(data: {
    title: string;
    body?: string;
    status?: string;
    priority?: string;
    dueDate?: string;
    pinned?: boolean;
    restricted?: boolean;
    projectId?: string;
    buildingId?: string;
    unitId?: string;
    links?: LinkInput[];
    assigneeIds?: string[];
  }, createdById: string, actorRole: string) {
    const title = data.title?.trim();
    if (!title) throw new BadRequestException('A title is required');
    if (data.pinned && !LEADERSHIP_ROLES.includes(actorRole as any)) {
      throw new ForbiddenException('Only leadership can pin an update');
    }

    await this.validateTags(data.projectId, data.buildingId, data.unitId);
    const assigneeIds = await this.resolveAssigneeIds(data.assigneeIds);
    const links = this.normalizeLinks(data.links);

    const post = await this.prisma.updateBoardPost.create({
      data: {
        title,
        body: data.body?.trim() || null,
        status: data.status ?? 'TODO',
        priority: data.priority ?? 'MEDIUM',
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        pinned: !!data.pinned,
        restricted: !!data.restricted,
        projectId: data.projectId || null,
        buildingId: data.buildingId || null,
        unitId: data.unitId || null,
        links: links as unknown as Prisma.InputJsonValue,
        createdById,
        assignments: assigneeIds.length
          ? { create: assigneeIds.map((userId) => ({ userId })) }
          : undefined,
      },
      include: POST_INCLUDE,
    });

    await this.notifyPosted(post, createdById);
    await this.notifyAssigned(post.id, assigneeIds, post, createdById);
    return post;
  }

  async update(id: string, data: {
    title?: string;
    body?: string | null;
    status?: string;
    priority?: string;
    dueDate?: string | null;
    pinned?: boolean;
    restricted?: boolean;
    projectId?: string | null;
    buildingId?: string | null;
    unitId?: string | null;
    links?: LinkInput[];
    assigneeIds?: string[];
  }, userId: string, userRole: string) {
    const post = await this.findById(id, { userId, role: userRole });
    this.assertCanManage(post, userId, userRole);

    if (data.title !== undefined && !data.title.trim()) {
      throw new BadRequestException('Title cannot be empty');
    }
    // Only when the value is actually CHANGING — a non-leadership creator saving unrelated
    // edits to an already-pinned post must not be blocked by resending the unchanged field.
    if (data.pinned !== undefined && data.pinned !== post.pinned && !LEADERSHIP_ROLES.includes(userRole as any)) {
      throw new ForbiddenException('Only leadership can pin an update');
    }
    if (data.projectId !== undefined || data.buildingId !== undefined || data.unitId !== undefined) {
      await this.validateTags(
        data.projectId === undefined ? post.projectId ?? undefined : data.projectId ?? undefined,
        data.buildingId === undefined ? post.buildingId ?? undefined : data.buildingId ?? undefined,
        data.unitId === undefined ? post.unitId ?? undefined : data.unitId ?? undefined,
      );
    }

    const reassigning = data.assigneeIds !== undefined;
    const nextAssigneeIds = reassigning ? await this.resolveAssigneeIds(data.assigneeIds) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (nextAssigneeIds) {
        // Removals go, additions arrive, and anyone already on the post KEEPS their row —
        // deleting and recreating would reset notifiedAt and re-alert them on every save
        // once Phase 2 wires notifications. Same pattern as TaskAssignment.
        await tx.updateBoardAssignment.deleteMany({
          where: { postId: id, userId: { notIn: nextAssigneeIds.length ? nextAssigneeIds : ['__none__'] } },
        });
        if (nextAssigneeIds.length) {
          await tx.updateBoardAssignment.createMany({
            data: nextAssigneeIds.map((userId) => ({ postId: id, userId })),
            skipDuplicates: true,
          });
        }
      }

      return tx.updateBoardPost.update({
        where: { id },
        data: {
          ...(data.title !== undefined ? { title: data.title.trim() } : {}),
          ...(data.body !== undefined ? { body: data.body?.trim() || null } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.priority !== undefined ? { priority: data.priority } : {}),
          ...(data.dueDate !== undefined
            ? { dueDate: data.dueDate ? new Date(data.dueDate) : null }
            : {}),
          ...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
          ...(data.restricted !== undefined ? { restricted: data.restricted } : {}),
          ...(data.projectId !== undefined ? { projectId: data.projectId || null } : {}),
          ...(data.buildingId !== undefined ? { buildingId: data.buildingId || null } : {}),
          ...(data.unitId !== undefined ? { unitId: data.unitId || null } : {}),
          ...(data.links !== undefined
            ? { links: this.normalizeLinks(data.links) as unknown as Prisma.InputJsonValue }
            : {}),
        },
        include: POST_INCLUDE,
      });
    });

    // notifyAssigned filters on notifiedAt IS NULL itself, so it is safe to call on every
    // save: only somebody newly added hears about it. Same rule TasksService.update follows.
    if (nextAssigneeIds?.length) {
      await this.notifyAssigned(id, nextAssigneeIds, updated, userId);
    }
    return updated;
  }

  async delete(id: string, userId: string, userRole: string) {
    const post = await this.findById(id, { userId, role: userRole });
    this.assertCanManage(post, userId, userRole);
    // Soft delete, consistent with Project/Building/Unit — a deleted post's chat thread
    // and attachments are not silently destroyed.
    return this.prisma.updateBoardPost.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private assertCanManage(post: { createdById: string }, userId: string, userRole: string) {
    if (post.createdById !== userId && !UPDATE_BOARD_ADMIN_ROLES.includes(userRole)) {
      throw new ForbiddenException('Only the author or a Founder/Super Admin can change this update');
    }
  }

  // ---- Notifications ----
  //
  // Never fatal: a notification failure must not cost someone the post/comment/assignment
  // they just saved. Same rule TasksService and AuditService follow.

  /**
   * Broadcast a new post to every internal user (everyone but CLIENT — the board has no
   * project-membership routing to narrow by). FYI-tier, so this is in-app only by default;
   * see NOTIFICATION_TIERS.UPDATE_BOARD_POSTED for why it does not email the company.
   *
   * A "Leadership Only" post narrows this the same way it narrows visibility: broadcasting
   * its existence to the whole company while hiding everyone from opening it would be a
   * confusing half-restriction, and would leak that a restricted post exists to people who
   * can't see it.
   */
  private async notifyPosted(post: { id: string; title: string; restricted: boolean }, actorId: string) {
    try {
      const recipients = await this.prisma.user.findMany({
        where: post.restricted
          ? { isActive: true, role: { in: LEADERSHIP_ROLES as unknown as string[] } as any, id: { not: actorId } }
          : { isActive: true, role: { not: 'CLIENT' }, id: { not: actorId } },
        select: { id: true },
      });
      if (recipients.length === 0) return;
      await this.notifications.send({
        userIds: recipients.map((r) => r.id),
        type: NotificationType.UPDATE_BOARD_POSTED,
        title: `New update: ${post.title}`,
        body: post.title,
        link: '/updates',
      });
    } catch (err) {
      this.logger.warn(`Update Board post notification failed: ${err}`);
    }
  }

  /**
   * Tell the people now tagged on a post. Same two rules as TasksService.notifyAssigned:
   * only people NEWLY added hear about it (the `notifiedAt IS NULL` query below is what
   * makes that true across edits), and tagging yourself is not news.
   */
  private async notifyAssigned(
    postId: string,
    assigneeIds: string[],
    post: { title: string },
    actorId: string,
  ) {
    const recipients = assigneeIds.filter((id) => id !== actorId);
    if (recipients.length === 0) return;
    try {
      const fresh = await this.prisma.updateBoardAssignment.findMany({
        where: { postId, userId: { in: recipients }, notifiedAt: null },
        select: { userId: true },
      });
      if (fresh.length === 0) return;

      const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
      await this.notifications.send({
        userIds: fresh.map((f) => f.userId),
        type: NotificationType.UPDATE_BOARD_ASSIGNED,
        title: `${actor?.name || 'Someone'} tagged you: ${post.title}`,
        body: post.title,
        link: '/updates',
      });
      await this.prisma.updateBoardAssignment.updateMany({
        where: { postId, userId: { in: fresh.map((f) => f.userId) } },
        data: { notifiedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`Update Board assignment notification failed: ${err}`);
    }
  }

  /**
   * Notify anyone @mentioned in a chat reply. Reuses resolveMentions rather than growing a
   * second mention parser — same reasoning as TasksService.notifyMentions.
   */
  private async notifyMentions(postId: string, content: string, authorId: string) {
    try {
      const post = await this.prisma.updateBoardPost.findUnique({
        where: { id: postId },
        select: { title: true },
      });
      if (!post) return;
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true },
      });
      const mentioned = resolveMentions(content, users).filter((id) => id !== authorId);
      if (mentioned.length === 0) return;

      const author = users.find((u) => u.id === authorId);
      await this.notifications.send({
        userIds: mentioned,
        type: NotificationType.UPDATE_BOARD_COMMENT_MENTION,
        title: `${author?.name || 'Someone'} mentioned you on ${post.title}`,
        body: content.slice(0, 240),
        link: '/updates',
      });
    } catch (err) {
      this.logger.warn(`Update Board mention notification failed: ${err}`);
    }
  }

  /** Reject a tag naming something that does not exist (or is soft-deleted). */
  private async validateTags(projectId?: string, buildingId?: string, unitId?: string) {
    const [project, building, unit] = await Promise.all([
      projectId
        ? this.prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } })
        : null,
      buildingId
        ? this.prisma.building.findFirst({ where: { id: buildingId, deletedAt: null }, select: { id: true } })
        : null,
      unitId
        ? this.prisma.unit.findFirst({ where: { id: unitId, deletedAt: null }, select: { id: true } })
        : null,
    ]);
    if (projectId && !project) throw new BadRequestException('That project does not exist');
    if (buildingId && !building) throw new BadRequestException('That building does not exist');
    if (unitId && !unit) throw new BadRequestException('That unit does not exist');
  }

  private async resolveAssigneeIds(assigneeIds: string[] | undefined): Promise<string[]> {
    const ids = [...new Set((assigneeIds ?? []).filter(Boolean))];
    if (ids.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    if (users.length !== ids.length) {
      throw new BadRequestException('One or more of those people does not exist, or is inactive');
    }
    return ids;
  }

  /** Drop blank/malformed rows rather than rejecting the whole save over one bad link. */
  private normalizeLinks(links: LinkInput[] | undefined): { url: string; label: string }[] {
    if (!links?.length) return [];
    return links
      .map((l) => ({ url: (l.url ?? '').trim(), label: (l.label ?? '').trim() }))
      .filter((l) => l.url.length > 0)
      .slice(0, 20);
  }

  /**
   * Swap bucket keys for signed URLs. A storagePath is not displayable on its own, so
   * returning the raw rows would render every attachment as a broken link. Mirrors
   * TasksService.signPhotos, including the swallow: one unsignable attachment must not
   * take the whole post down with it.
   */
  private async signAttachments<T extends { attachments: Array<{ storagePath: string }> }>(post: T) {
    if (!('attachments' in post) || !Array.isArray((post as any).attachments)) return post;
    const attachments = await Promise.all(
      (post as any).attachments.map(async (a: any) => ({
        ...a,
        url: await this.storage.signedUrl(a.storagePath, 3600).catch(() => ''),
      })),
    );
    return { ...post, attachments };
  }

  // ---- Comments (the "chat") ----

  async getComments(postId: string, viewer: Viewer) {
    await this.findById(postId, viewer);
    return this.prisma.updateBoardComment.findMany({
      where: { postId },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComment(postId: string, authorId: string, viewerRole: string, content: string) {
    await this.findById(postId, { userId: authorId, role: viewerRole });
    const trimmed = content?.trim();
    if (!trimmed) throw new BadRequestException('Comment content is required');
    const comment = await this.prisma.updateBoardComment.create({
      data: { postId, authorId, content: trimmed },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    await this.notifyMentions(postId, trimmed, authorId);
    return comment;
  }

  async deleteComment(commentId: string, userId: string, userRole: string) {
    const comment = await this.prisma.updateBoardComment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId && !UPDATE_BOARD_ADMIN_ROLES.includes(userRole)) {
      throw new ForbiddenException('Only the comment author or a Founder/Super Admin can delete this comment');
    }
    return this.prisma.updateBoardComment.delete({ where: { id: commentId } });
  }

  // ---- Attachments ----

  async addAttachment(postId: string, uploadedById: string, viewerRole: string, input: {
    storagePath: string;
    fileName: string;
    mimeType?: string;
  }) {
    await this.findById(postId, { userId: uploadedById, role: viewerRole });
    if (!input.storagePath) throw new BadRequestException('storagePath is required');
    if (!input.fileName) throw new BadRequestException('fileName is required');
    // Must be a relative bucket key from our own upload flow — not an absolute path, a
    // traversal, or an external URL. Same guard as TasksService.addUpdatePhoto: this
    // value is fed straight to the storage signer.
    const path = input.storagePath;
    if (path.startsWith('/') || path.includes('..') || /^[a-z]+:\/\//i.test(path)) {
      throw new BadRequestException('Invalid storagePath');
    }
    const attachment = await this.prisma.updateBoardAttachment.create({
      data: {
        postId,
        uploadedById,
        storagePath: path,
        fileName: input.fileName,
        mimeType: input.mimeType,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    return {
      ...attachment,
      url: await this.storage.signedUrl(attachment.storagePath, 3600).catch(() => ''),
    };
  }

  async deleteAttachment(attachmentId: string, userId: string, userRole: string) {
    const attachment = await this.prisma.updateBoardAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (attachment.uploadedById !== userId && !UPDATE_BOARD_ADMIN_ROLES.includes(userRole)) {
      throw new ForbiddenException('Only the uploader or a Founder/Super Admin can delete attachments');
    }
    return this.prisma.updateBoardAttachment.delete({ where: { id: attachmentId } });
  }
}
