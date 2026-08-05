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
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Number(params.limit) || 50);
    const { userId, entity, action, startDate, endDate } = params;

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

  /**
   * The values that actually occur in the log, for populating the filter controls.
   *
   * Derived rather than hard-coded: the admin UI previously listed a fixed set of
   * actions that included two (MFA_VERIFY, QB_SYNC) which no code path ever writes, so
   * selecting them returned an empty table with no explanation. Entities are worse —
   * there are 25 of them and the list grows with every module.
   *
   * Counts ride along so each option can show its size, which turns the filter into a
   * summary of the log as well as a control.
   */
  async filterOptions() {
    const [actions, entities, actorRows] = await Promise.all([
      this.prisma.auditEvent.groupBy({
        by: ['action'],
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
      }),
      this.prisma.auditEvent.groupBy({
        by: ['entity'],
        _count: { entity: true },
        orderBy: { _count: { entity: 'desc' } },
      }),
      // No `take`: the list is bounded by the user table, not the event table, and a cap
      // silently omitted low-activity people from the filter with no way to tell the
      // options were incomplete — the filter just appeared not to contain them.
      this.prisma.auditEvent.groupBy({
        by: ['userId'],
        _count: { userId: true },
        orderBy: { _count: { userId: 'desc' } },
      }),
    ]);

    const actorIds = actorRows.map((r) => r.userId).filter((id): id is string => !!id);
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return {
      actions: actions.map((a) => ({ value: a.action, count: a._count.action })),
      entities: entities
        .filter((e) => !!e.entity)
        .map((e) => ({ value: e.entity, count: e._count.entity })),
      // Actors whose user row was deleted are dropped: filtering by an id with no name
      // is not something anyone can act on, and the events stay visible unfiltered.
      actors: actorRows
        .filter((r) => r.userId && userById.has(r.userId))
        .map((r) => ({
          value: r.userId as string,
          label: userById.get(r.userId as string)!.name || userById.get(r.userId as string)!.email,
          count: r._count.userId,
        })),
    };
  }
}
