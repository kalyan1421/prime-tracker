import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/utils/audit.service';
import { UserRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/** Identity fields writable by self or by an admin. Never authorization fields. */
type ProfileFields = { name?: string; avatarUrl?: string; phone?: string; jobTitle?: string };

/** One list relation on User that a hard delete would break or quietly rewrite. */
export type GuardedUserRelation = {
  /** Field name on the Prisma `User` model, e.g. `uploadedDocuments`. */
  field: string;
  /** Human form shown to the admin, e.g. "uploaded documents". */
  label: string;
  /** What Postgres would do to the referencing rows: fail, or null the attribution. */
  action: 'Restrict' | 'SetNull';
};

/**
 * Every table that points at a user, minus the ones the schema itself declares disposable.
 *
 * Derived from the Prisma DMMF rather than hand-listed. A hand-listed version is what
 * goes stale — this file would have to be edited every time another module adds a
 * `recordedById`, and it never is: that is precisely how `remove()` came to blow up on
 * `historical_record_deletions_requestedById_fkey`, a table added long after it.
 *
 * Effective referential action = the explicit `onDelete`, else Prisma's default, which is
 * `Restrict` for a required relation and `SetNull` for an optional one. Both are guarded:
 *
 *  - `Restrict` — the delete fails outright at the database (the reported 23503).
 *  - `SetNull`  — worse in practice. The delete *succeeds* and silently erases the
 *                 attribution: who approved the draw, who signed off the photo, who
 *                 recorded the rent correction. Two tables also carry CHECK constraints
 *                 shaped `status = 'PENDING' OR "decidedById" IS NOT NULL`, so the SET
 *                 NULL would trip a check violation on the way out anyway.
 *  - `Cascade`  — NOT guarded. The schema author already declared those rows to belong to
 *                 the account and to die with it (sessions, notifications, notification
 *                 preferences, memberships, the client profile).
 */
export const GUARDED_USER_RELATIONS: readonly GuardedUserRelation[] = buildGuardedUserRelations();

function buildGuardedUserRelations(): GuardedUserRelation[] {
  const datamodel = Prisma.dmmf.datamodel;

  // Relation name -> effective onDelete, read off the side that owns the foreign key.
  const actionByRelation = new Map<string, string>();
  for (const model of datamodel.models) {
    for (const field of model.fields) {
      if (field.kind !== 'object' || field.type !== 'User') continue;
      if (!field.relationFromFields?.length) continue; // back-reference side, no FK here
      const explicit = (field as { relationOnDelete?: string }).relationOnDelete;
      actionByRelation.set(
        field.relationName as string,
        explicit ?? (field.isRequired ? 'Restrict' : 'SetNull'),
      );
    }
  }

  const userModel = datamodel.models.find((m) => m.name === 'User');
  if (!userModel) return [];

  return userModel.fields
    .filter((f) => f.kind === 'object' && f.isList)
    .map((f) => ({ field: f.name, action: actionByRelation.get(f.relationName as string) }))
    .filter((r): r is { field: string; action: 'Restrict' | 'SetNull' } =>
      r.action === 'Restrict' || r.action === 'SetNull',
    )
    .map((r) => ({
      ...r,
      label: r.field.replace(/([A-Z])/g, ' $1').toLowerCase(),
    }));
}

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
  async setPassword(
    targetId: string,
    newPassword: string,
    actor: { id: string; role: string; roles?: string[] },
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, role: true, roles: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const isSuperAdmin = (primary: string, all?: readonly string[] | null) =>
      primary === 'SUPER_ADMIN' || (all ?? []).includes('SUPER_ADMIN');

    // Both sides read roles[], not just the primary role. Permissions are the union over
    // roles[] (jwt.strategy.ts), so someone whose primary role is FOUNDER but who also
    // holds SUPER_ADMIN *is* a super admin — checking `actor.role` alone refused them a
    // reset they are entitled to perform.
    const targetIsSuperAdmin = isSuperAdmin(target.role, target.roles as string[]);
    if (targetIsSuperAdmin && !isSuperAdmin(actor.role, actor.roles)) {
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

  /**
   * Count the rows that still attribute work to this user, heaviest first.
   *
   * One round trip: Prisma's `_count` select takes every guarded relation at once, so
   * adding a table to the schema costs nothing here.
   */
  private async findBlockingReferences(id: string) {
    const countSelect = Object.fromEntries(GUARDED_USER_RELATIONS.map((r) => [r.field, true]));
    // The select is built at runtime from the DMMF, so it cannot be statically typed
    // against Prisma.UserSelect — the shape is correct by construction.
    const select = { _count: { select: countSelect } } as unknown as Prisma.UserSelect;

    const row = (await this.prisma.user.findUnique({ where: { id }, select })) as
      | { _count?: Record<string, number> }
      | null;
    const counts = row?._count ?? {};

    return GUARDED_USER_RELATIONS.map((r) => ({ ...r, count: counts[r.field] ?? 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Hard-delete a user — refused whenever they have left a trace.
   *
   * A user id is the subject of the audit trail: who uploaded the document, who approved
   * the draw, who signed off the milestone photo, who requested the record deletion.
   * Removing the row either fails against a RESTRICT foreign key (an opaque 500 for the
   * admin, which is the bug this replaces) or succeeds and quietly nulls the actor out of
   * history. Both outcomes are worse than the alternative the app already has, which is
   * why Building, Unit, Lease, Sale and Document all moved from hard to soft delete.
   *
   * So: deletion stays available for an account that never did anything — a mistyped
   * invite, a duplicate — and is refused with a specific, countable reason for everyone
   * else, pointing at deactivation. Deactivation revokes sign-in and hides the user from
   * every assignee picker (`findAssignable` filters on `isActive`) while the trail keeps
   * naming a real person.
   */
  async remove(id: string, actorId: string) {
    if (id === actorId) throw new BadRequestException('Cannot delete your own account');

    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const blocking = await this.findBlockingReferences(id);
    if (blocking.length > 0) {
      const total = blocking.reduce((sum, b) => sum + b.count, 0);
      const shown = blocking.slice(0, 5).map((b) => `${b.count} ${b.label}`);
      const hidden = blocking.length - shown.length;
      const listed =
        shown.join(', ') +
        (hidden > 0 ? `, and ${hidden} more record type${hidden === 1 ? '' : 's'}` : '');

      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message:
          `${target.name} cannot be deleted: ${total} record${total === 1 ? '' : 's'} across ` +
          `${blocking.length} type${blocking.length === 1 ? '' : 's'} still credit work to this ` +
          `user (${listed}). Deleting would either fail or erase that attribution. ` +
          `Deactivate ${target.name} instead — that revokes their sign-in and removes them ` +
          `from assignee lists while the history keeps naming them.`,
        references: blocking.map((b) => ({
          relation: b.field,
          label: b.label,
          count: b.count,
          onDelete: b.action,
        })),
      });
    }

    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (err) {
      // Backstop for the race between the census above and the delete, and for any
      // relation the DMMF walk somehow misses. Never let a raw 23503 reach the admin.
      if ((err as { code?: string })?.code === 'P2003') {
        throw new ConflictException(
          `${target.name} cannot be deleted — another record started referencing this user. ` +
            `Deactivate the account instead to revoke access while keeping the history intact.`,
        );
      }
      throw err;
    }

    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      entity: 'User',
      entityId: id,
      oldValues: { email: target.email, name: target.name },
    });
  }
}
