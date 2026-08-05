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

  /**
   * The people a task / lead / snag / fit-out can be assigned to.
   *
   * Every assignee picker in the app was calling findAll(), which is `user:manage` —
   * an admin permission. Non-admins got "Missing permissions: user:manage" and an empty
   * dropdown, so they could not assign work at all. Choosing a colleague from a list is
   * not user administration, so this is deliberately a separate, narrower read:
   * active users only, and only the fields a picker renders — no email verification
   * state, no MFA flags, no timestamps.
   */
  async findAssignable() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, avatarUrl: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

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

  /**
   * Admin reset of another user's password.
   *
   * Two rules that are not obvious:
   *
   * 1. Only a SUPER_ADMIN may reset a SUPER_ADMIN. `user:manage` is held by FOUNDER as
   *    well, and without this a founder could set a super-admin's password and then sign
   *    in as them — a full takeover of the only role that can grant permissions. Admins
   *    resetting their peers downward is the intended use; resetting upward is not.
   * 2. Every one of the target's sessions is revoked. A reset is used when an account is
   *    locked out or possibly compromised, so leaving live refresh tokens behind would
   *    defeat the reason for doing it. The self-service path revokes for the same reason.
   *
   * The new password is never logged — the audit row records that a reset happened, by
   * whom, and how many sessions it killed.
   */
  async setPassword(targetId: string, newPassword: string, actor: { id: string; role: string }) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, role: true, roles: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const targetIsSuperAdmin =
      target.role === 'SUPER_ADMIN' || (target.roles ?? []).includes('SUPER_ADMIN' as UserRole);
    if (targetIsSuperAdmin && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException("Only a super admin can reset a super admin's password");
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const [, revoked] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: targetId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE',
      entity: 'User',
      entityId: targetId,
      metadata: { event: 'PASSWORD_RESET_BY_ADMIN', sessionsRevoked: revoked.count },
    });

    return { success: true, sessionsRevoked: revoked.count };
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
