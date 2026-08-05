import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommentType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveMentions } from './mentions';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Fan out the notifications a new comment produces.
   *
   * Two independent audiences:
   *   - the comment's DEPARTMENT (FINANCIAL -> finance, SALES -> sales, …) via
   *     notifyNewComment. That method has existed since the notifications module was
   *     written and was never called from anywhere, so posting a comment notified nobody.
   *   - anyone @mentioned by name, who is told regardless of department or project
   *     membership.
   *
   * Never allowed to fail the write: the comment is the user's work, a notification is a
   * side effect, and losing the former because the latter threw is not a trade worth
   * making. Failures are logged rather than swallowed silently.
   */
  private async notifyForComment(params: {
    commentType: CommentType;
    content: string;
    authorId: string;
    projectId?: string;
    projectName?: string;
    unit?: any;
    where: string;
    link?: string;
  }) {
    try {
      await this.notifications.notifyNewComment({
        commentType: params.commentType,
        content: params.content,
        projectId: params.projectId,
        projectName: params.projectName,
        unit: params.unit,
      });

      // Only active users are mention candidates — naming a deactivated account should
      // not resurrect it as a recipient.
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true },
      });
      const mentioned = resolveMentions(params.content, users);
      if (mentioned.length === 0) return;

      const author = users.find((u) => u.id === params.authorId);
      await this.notifications.notifyCommentMention({
        mentionedUserIds: mentioned,
        authorId: params.authorId,
        authorName: author?.name || 'Someone',
        content: params.content,
        where: params.where,
        link: params.link,
      });
    } catch (err) {
      this.logger.warn(`Comment notification failed: ${err}`);
    }
  }

  // ---- Unit Comments ----

  async findByUnit(unitId: string) {
    return this.prisma.unitComment.findMany({
      where: { unitId },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createUnitComment(unitId: string, userId: string, content: string, commentType: CommentType = CommentType.MARKETING) {
    const comment = await this.prisma.unitComment.create({
      data: { unitId, userId, content, commentType },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // The project is reached through building, and notifyNewComment needs that shape to
    // scope recipients; a unit whose building or project is missing simply gets no
    // department routing rather than throwing.
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: {
        unitNumber: true,
        building: { select: { project: { select: { id: true, name: true } } } },
      },
    });
    const projectId = unit?.building?.project?.id;
    await this.notifyForComment({
      commentType,
      content,
      authorId: userId,
      projectName: unit?.building?.project?.name,
      unit: unit as any,
      where: `a comment on Unit ${unit?.unitNumber ?? ''}`.trim(),
      link: projectId ? `/projects/${projectId}/units/${unitId}` : undefined,
    });

    return comment;
  }

  async updateUnitComment(id: string, userId: string, content: string) {
    const comment = await this.prisma.unitComment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) throw new ForbiddenException("Cannot edit another user's comment");
    return this.prisma.unitComment.update({
      where: { id },
      data: { content },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async deleteUnitComment(id: string, userId: string, isAdmin: boolean) {
    const comment = await this.prisma.unitComment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId && !isAdmin) throw new ForbiddenException("Cannot delete another user's comment");
    return this.prisma.unitComment.delete({ where: { id } });
  }

  // ---- Project Comments ----

  async findByProject(projectId: string) {
    return this.prisma.projectComment.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createProjectComment(projectId: string, userId: string, content: string, commentType: CommentType = CommentType.MARKETING) {
    const comment = await this.prisma.projectComment.create({
      data: { projectId, userId, content, commentType },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    await this.notifyForComment({
      commentType,
      content,
      authorId: userId,
      projectId,
      projectName: project?.name,
      where: `a comment on ${project?.name ?? 'a project'}`,
      link: `/projects/${projectId}/comments`,
    });

    return comment;
  }

  async updateProjectComment(id: string, userId: string, content: string) {
    const comment = await this.prisma.projectComment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) throw new ForbiddenException("Cannot edit another user's comment");
    return this.prisma.projectComment.update({
      where: { id },
      data: { content },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async deleteProjectComment(id: string, userId: string, isAdmin: boolean) {
    const comment = await this.prisma.projectComment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId && !isAdmin) throw new ForbiddenException("Cannot delete another user's comment");
    return this.prisma.projectComment.delete({ where: { id } });
  }

  // ---- Recent (both types combined, ordered by type: MARKETING first, then SALES, then FINANCIAL) ----

  async findRecent(limit = 20) {
    const TYPE_ORDER = { MARKETING: 0, SALES: 1, FINANCIAL: 2 };

    const [unitComments, projectComments] = await Promise.all([
      this.prisma.unitComment.findMany({
        take: limit,
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          unit: {
            select: {
              id: true,
              unitNumber: true,
              building: {
                select: {
                  id: true,
                  name: true,
                  project: { select: { id: true, name: true, slug: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.projectComment.findMany({
        take: limit,
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          project: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const combined = [
      ...unitComments.map((c) => ({ ...c, source: 'unit' as const })),
      ...projectComments.map((c) => ({ ...c, source: 'project' as const })),
    ];

    // Sort by commentType order (Marketing, Sales, Financial), then by createdAt desc within each group
    combined.sort((a, b) => {
      const typeA = TYPE_ORDER[a.commentType as keyof typeof TYPE_ORDER] ?? 99;
      const typeB = TYPE_ORDER[b.commentType as keyof typeof TYPE_ORDER] ?? 99;
      if (typeA !== typeB) return typeA - typeB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return combined.slice(0, limit);
  }
}
