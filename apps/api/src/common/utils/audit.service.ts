import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditPayload {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(payload: AuditPayload): Promise<void> {
    try {
      // Verify userId exists before setting FK
      let userId = payload.userId;
      if (userId) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) userId = undefined;
      }

      await this.prisma.auditEvent.create({
        data: {
          userId,
          action: payload.action,
          entity: payload.entity,
          entityId: payload.entityId,
          oldValues: (payload.oldValues as any) ?? undefined,
          newValues: (payload.newValues as any) ?? undefined,
          ipAddress: payload.ipAddress,
          userAgent: payload.userAgent,
          metadata: (payload.metadata as any) ?? undefined,
        },
      });
    } catch (err) {
      console.error('Audit log failed:', err);
    }
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    userId?: string;
    entity?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    const { page = 1, limit = 50, userId, entity, action, startDate, endDate } = params;

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (entity) where.entity = entity;
    if (action) where.action = action;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, Date>).gte = startDate;
      if (endDate) (where.createdAt as Record<string, Date>).lte = endDate;
    }

    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { events, total, page, limit };
  }
}
