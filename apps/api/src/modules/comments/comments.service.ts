import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommentType } from '@prisma/client';

@Injectable()
export class CommentsService {
  constructor(private prisma: PrismaService) {}

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
    return this.prisma.unitComment.create({
      data: { unitId, userId, content, commentType },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
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
    return this.prisma.projectComment.create({
      data: { projectId, userId, content, commentType },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
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
