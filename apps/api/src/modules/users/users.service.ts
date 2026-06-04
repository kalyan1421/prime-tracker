import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/utils/audit.service';
import { UserRole, Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(data: { email: string; name: string; role?: UserRole }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictException('User with this email already exists');
    return this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        role: data.role || 'VIEWER',
      },
    });
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateRole(id: string, role: UserRole, actorId: string) {
    const user = await this.findById(id);
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: actorId } });
    const oldRole = user.role;

    // SUPER_ADMIN can only be assigned by another SUPER_ADMIN
    if (role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can assign the Super Admin role');
    }

    // Prevent non-SUPER_ADMIN from modifying a SUPER_ADMIN's role
    if (user.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can modify another Super Admin');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role },
    });

    await this.audit.log({
      userId: actorId,
      action: 'ROLE_CHANGE',
      entity: 'User',
      entityId: id,
      oldValues: { role: oldRole },
      newValues: { role },
    });

    return updated;
  }

  async getRoleCounts(): Promise<Record<string, number>> {
    const result = await this.prisma.user.groupBy({
      by: ['role'],
      _count: { id: true },
    });
    const counts: Record<string, number> = {};
    for (const r of result) {
      counts[r.role] = r._count.id;
    }
    return counts;
  }

  async toggleActive(id: string, isActive: boolean, actorId: string) {
    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive },
    });

    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      newValues: { isActive },
    });

    return updated;
  }

  /**
   * Self-service profile edit. Any authenticated user may update their own
   * display name / avatar — but NOT their email (the OAuth identity key),
   * role, or active status. The actor is always the target (id === actorId).
   */
  async updateSelf(id: string, data: { name?: string; avatarUrl?: string }) {
    const patch: Prisma.UserUpdateInput = {};
    if (typeof data.name === 'string' && data.name.trim().length > 0) {
      patch.name = data.name.trim();
    }
    if (typeof data.avatarUrl === 'string') {
      patch.avatarUrl = data.avatarUrl.trim() || null;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Provide a name or avatarUrl to update');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: patch,
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    await this.audit.log({
      userId: id,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      newValues: patch,
    });
    return user;
  }

  async update(id: string, data: { name?: string; email?: string }, actorId: string) {
    if (data.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
      if (existing && existing.id !== id) throw new ConflictException('Email already in use');
    }
    const user = await this.prisma.user.update({ where: { id }, data });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      newValues: data,
    });
    return user;
  }

  async remove(id: string, actorId: string) {
    if (id === actorId) throw new BadRequestException('Cannot delete your own account');
    await this.prisma.user.delete({ where: { id } });
    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      entity: 'User',
      entityId: id,
    });
  }
}
