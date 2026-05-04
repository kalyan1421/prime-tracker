import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/utils/audit.service';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(
    dto: { name: string; entityType?: string; description?: string },
    actorId: string,
  ) {
    const baseSlug = slugify(dto.name);
    let slug = baseSlug;
    let suffix = 2;

    // Handle slug collision
    while (
      await this.prisma.organization.findUnique({ where: { slug } })
    ) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        slug,
        entityType: dto.entityType,
        description: dto.description,
      },
    });

    await this.audit.log({
      userId: actorId,
      action: 'CREATE',
      entity: 'Organization',
      entityId: org.id,
      newValues: { name: org.name, entityType: org.entityType },
    });

    return org;
  }

  async findAll(includeInactive = false) {
    const where = includeInactive ? {} : { isActive: true };

    return this.prisma.organization.findMany({
      where,
      include: {
        _count: { select: { memberships: true, projects: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
                role: true,
              },
            },
            manager: { select: { id: true, name: true } },
          },
          orderBy: [{ orgRole: 'asc' }, { joinedAt: 'asc' }],
        },
        _count: { select: { projects: true } },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return org;
  }

  async update(
    id: string,
    dto: { name?: string; entityType?: string; description?: string; isActive?: boolean },
    actorId: string,
  ) {
    const existing = await this.findById(id);

    const data: Record<string, unknown> = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.entityType !== undefined) data.entityType = dto.entityType;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    // Regenerate slug only if name changed
    if (dto.name && dto.name !== existing.name) {
      const baseSlug = slugify(dto.name);
      let slug = baseSlug;
      let suffix = 2;

      while (
        await this.prisma.organization.findUnique({ where: { slug } })
      ) {
        slug = `${baseSlug}-${suffix}`;
        suffix++;
      }

      data.slug = slug;
    }

    const updated = await this.prisma.organization.update({
      where: { id },
      data,
    });

    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      entity: 'Organization',
      entityId: id,
      oldValues: { name: existing.name, entityType: existing.entityType },
      newValues: data,
    });

    return updated;
  }

  async deactivate(id: string, actorId: string) {
    const org = await this.findById(id);

    if (org.isDefault) {
      throw new BadRequestException(
        'Cannot deactivate the default organization',
      );
    }

    const updated = await this.prisma.organization.update({
      where: { id },
      data: { isActive: false },
    });

    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      entity: 'Organization',
      entityId: id,
      newValues: { isActive: false },
    });

    return updated;
  }

  async addMember(
    orgId: string,
    userId: string,
    orgRole: string,
    actorId: string,
  ) {
    // Verify user exists and is not a FOUNDER
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (['SUPER_ADMIN', 'FOUNDER'].includes(user.role)) {
      throw new BadRequestException(
        'Super Admins and Founders cannot be assigned to organizations',
      );
    }

    // Check for duplicate membership
    const existing = await this.prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });

    if (existing) {
      throw new BadRequestException(
        'User is already a member of this organization',
      );
    }

    const membership = await this.prisma.orgMembership.create({
      data: { orgId, userId, orgRole: orgRole as any },
    });

    await this.audit.log({
      userId: actorId,
      action: 'CREATE',
      entity: 'OrgMembership',
      entityId: membership.id,
      newValues: { orgId, userId, orgRole },
    });

    return membership;
  }

  async removeMember(orgId: string, userId: string, actorId: string) {
    const membership = await this.prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    await this.prisma.orgMembership.delete({
      where: { orgId_userId: { orgId, userId } },
    });

    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      entity: 'OrgMembership',
      entityId: membership.id,
      oldValues: { orgId, userId, orgRole: membership.orgRole },
    });
  }
}
