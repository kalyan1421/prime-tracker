import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/utils/audit.service';
import { UserRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/** Identity fields writable by self or by an admin. Never authorization fields. */
type ProfileFields = { name?: string; avatarUrl?: string; phone?: string; jobTitle?: string };

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(data: { email: string; name: string; role?: UserRole; roles?: UserRole[]; password?: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictException('User with this email already exists');

    // roles[] takes precedence when both are sent (Add User modal sends roles[] via
    // MultiRolePicker); primary role is the first entry, matching updateRoles() below.
    const roles = data.roles?.length ? data.roles : [data.role || ('VIEWER' as UserRole)];
    const primaryRole = roles[0];

    // Password is optional — leaving it unset keeps the user Google-OAuth-only (today's
    // default). Setting one additionally enables POST /auth/login for accounts without a
    // Workspace Google account (vendors, and eventually buyer-portal CLIENT users).
    if (data.password !== undefined && data.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : undefined;

    return this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        role: primaryRole,
        roles,
        passwordHash,
      },
      // Never return passwordHash/mfaSecret/googleId to the client (this row is sent
      // straight back to the Add-User modal). See userSelect below.
      select: this.userSelect,
    });
  }

  private userSelect = {
    id: true,
    email: true,
    name: true,
    avatarUrl: true,
    phone: true,
    jobTitle: true,
    role: true,
    roles: true,
    isActive: true,
    mfaEnabled: true,
    lastLoginAt: true,
    createdAt: true,
  } as const;

  async findAll() {
    return this.prisma.user.findMany({
      select: this.userSelect,
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.userSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateRole(id: string, role: UserRole, actorId: string) {
    const user = await this.findById(id);
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: actorId } });
    const oldRole = user.role;

    if (role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can assign the Super Admin role');
    }
    if (user.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can modify another Super Admin');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role, roles: [role] },
      select: this.userSelect,
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

  async updateRoles(id: string, roles: UserRole[], actorId: string) {
    if (!roles.length) throw new BadRequestException('At least one role is required');

    const user = await this.findById(id);
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: actorId } });

    const hasSuperAdmin = roles.includes('SUPER_ADMIN' as UserRole);
    if (hasSuperAdmin && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can assign the Super Admin role');
    }
    if (user.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a Super Admin can modify another Super Admin');
    }

    // Primary role = first in the list (determines groupBy / display)
    const primaryRole = roles[0];
    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: primaryRole, roles },
      select: this.userSelect,
    });

    await this.audit.log({
      userId: actorId,
      action: 'ROLE_CHANGE',
      entity: 'User',
      entityId: id,
      oldValues: { roles: user.roles },
      newValues: { roles },
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
      select: this.userSelect,
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
  async updateSelf(id: string, data: ProfileFields) {
    return this.updateProfile(id, data, id);
  }

  /**
   * Identity-only update, used by BOTH `PATCH /users/me` (self) and `PATCH /users/:id`
   * (admin). One method so the two can never drift on what is writable.
   *
   * `actorId` is who performed it, for the audit trail — it differs from `id` when an
   * admin edits someone else. Nothing here can touch role/roles/isActive/email; those
   * are separate admin-only routes, and UpdateProfileDto has no such fields, so the
   * ValidationPipe rejects them before this runs.
   */
  async updateProfile(id: string, data: ProfileFields, actorId: string) {
    const patch: Prisma.UserUpdateInput = {};
    if (typeof data.name === 'string' && data.name.trim().length > 0) {
      patch.name = data.name.trim();
    }
    if (typeof data.avatarUrl === 'string') {
      patch.avatarUrl = data.avatarUrl.trim() || null;
    }
    // Blank clears the field rather than being ignored — otherwise a wrong phone
    // number could never be removed, only replaced.
    if (typeof data.phone === 'string') {
      patch.phone = data.phone.trim() || null;
    }
    if (typeof data.jobTitle === 'string') {
      patch.jobTitle = data.jobTitle.trim() || null;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Provide a name, avatarUrl, phone or jobTitle to update');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: patch,
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        phone: true,
        jobTitle: true,
        role: true,
        roles: true,
        isActive: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      newValues: patch,
    });
    return user;
  }

  async update(
    id: string,
    data: { name?: string; email?: string; phone?: string; jobTitle?: string },
    actorId: string,
  ) {
    if (data.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
      if (existing && existing.id !== id) throw new ConflictException('Email already in use');
    }
    // Build the patch field by field rather than spreading the body. The DTO already
    // rejects unknown keys, but constructing it explicitly means a future field added
    // to the DTO cannot silently reach Prisma without someone deciding it should.
    const patch: Prisma.UserUpdateInput = {};
    if (typeof data.name === 'string' && data.name.trim()) patch.name = data.name.trim();
    if (typeof data.email === 'string' && data.email.trim()) patch.email = data.email.trim();
    if (typeof data.phone === 'string') patch.phone = data.phone.trim() || null;
    if (typeof data.jobTitle === 'string') patch.jobTitle = data.jobTitle.trim() || null;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Provide a field to update');
    }
    const user = await this.prisma.user.update({ where: { id }, data: patch, select: this.userSelect });
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      newValues: patch,
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
