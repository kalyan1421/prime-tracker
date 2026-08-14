import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  DEFAULT_SALE_STAGE_PROBABILITIES,
  WRITABLE_SALE_STAGE_PROBABILITIES,
} from '@prime-tracker/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/utils/audit.service';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Mirrors the `@default(...)` values on `OrgSettings` in schema.prisma.
 *
 * The row is created lazily — nothing has ever written it before this endpoint existed —
 * so most orgs have no row at all and the database defaults never get a chance to apply.
 * GET therefore answers from this map rather than 404ing, which keeps the settings UI
 * renderable on day one and means "no row" and "row holding the defaults" are
 * indistinguishable to a caller, exactly as they should be.
 */
const DEFAULT_ORG_SETTINGS = {
  saleStageProbabilities: DEFAULT_SALE_STAGE_PROBABILITIES,
  unitStaleDaysThreshold: 90,
  budgetVarianceAlertPct: 10,
  saleStageAgeAlertDays: 30,
  saleActivityDroughtDays: 14,
  drawFundingExpectedDays: 14,
  discountApprovalThresholdPct: 5,
} as const;

/** Canonical key order for the persisted JSON — earliest stage first, terminal stages last. */
const STAGE_WRITE_ORDER = [...WRITABLE_SALE_STAGE_PROBABILITIES, 'CLOSED', 'CANCELLED'];

const KNOWN_STAGES = new Set(Object.keys(DEFAULT_SALE_STAGE_PROBABILITIES));
const WRITABLE_STAGES = new Set<string>(WRITABLE_SALE_STAGE_PROBABILITIES);
const WRITABLE_LIST = WRITABLE_SALE_STAGE_PROBABILITIES.join(', ');

/** Every field this endpoint currently knows how to set — used to reject an empty body. */
const UPDATABLE_SETTINGS_FIELDS = ['saleStageProbabilities'];

export interface OrgSettingsView {
  orgId: string;
  saleStageProbabilities: Record<string, number>;
  unitStaleDaysThreshold: number;
  budgetVarianceAlertPct: number;
  saleStageAgeAlertDays: number;
  saleActivityDroughtDays: number;
  drawFundingExpectedDays: number;
  discountApprovalThresholdPct: number;
  /** True when no row exists yet and every value above came from the schema defaults. */
  usingDefaults: boolean;
  updatedAt: string | null;
}

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

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

  // ---- Settings ----

  /**
   * Read an org's settings.
   *
   * Deliberately does NOT create a row: a GET that writes turns "open the settings page"
   * into a mutation, which would also mean every org that anyone ever glanced at ends up
   * with a row pinning today's defaults, freezing them against future schema changes.
   * Absent row → schema defaults plus `usingDefaults: true`.
   *
   * The 404 here is for a missing *organization*, which is a genuine client error.
   */
  async getSettings(orgId: string): Promise<OrgSettingsView> {
    await this.assertOrgExists(orgId);

    const row = await this.prisma.orgSettings.findUnique({ where: { orgId } });

    if (!row) {
      return {
        orgId,
        ...DEFAULT_ORG_SETTINGS,
        saleStageProbabilities: { ...DEFAULT_SALE_STAGE_PROBABILITIES },
        usingDefaults: true,
        updatedAt: null,
      };
    }

    return {
      orgId,
      // Merged over the defaults, not returned raw. Rows predating this endpoint were
      // never validated on the way in, so a stored map can be partial or hold junk; the
      // forecast drops those entries and falls back to the default, and the settings
      // screen must show the number the forecast will actually use, not the dead one.
      saleStageProbabilities: {
        ...DEFAULT_SALE_STAGE_PROBABILITIES,
        ...this.sanitizeStoredProbabilities(row.saleStageProbabilities, orgId),
      },
      unitStaleDaysThreshold: row.unitStaleDaysThreshold,
      budgetVarianceAlertPct: Number(row.budgetVarianceAlertPct),
      saleStageAgeAlertDays: row.saleStageAgeAlertDays,
      saleActivityDroughtDays: row.saleActivityDroughtDays,
      drawFundingExpectedDays: row.drawFundingExpectedDays,
      // Prisma hands Decimal columns back as Decimal objects, which JSON-serialise as
      // strings. Coerced so the shape is identical on both branches of this method.
      discountApprovalThresholdPct: Number(row.discountApprovalThresholdPct),
      usingDefaults: false,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    };
  }

  /**
   * Upsert an org's settings. Partial: anything not supplied keeps its stored value.
   *
   * This is the first write path OrgSettings has ever had, so validation happens here
   * rather than being left to the read-time sanitisation in SalesForecastService. That
   * sanitisation was defence against a hand-edited row and stays where it is; the point
   * of validating on the way in is that bad data never lands in the first place, so the
   * value the admin sees saved is the value the forecast will use.
   */
  async updateSettings(
    orgId: string,
    dto: UpdateOrgSettingsDto,
    actorId: string,
  ): Promise<OrgSettingsView> {
    await this.assertOrgExists(orgId);

    if (!UPDATABLE_SETTINGS_FIELDS.some((f) => (dto as Record<string, unknown>)[f] !== undefined)) {
      throw new BadRequestException(
        `No settings supplied. Provide at least one of: ${UPDATABLE_SETTINGS_FIELDS.join(', ')}.`,
      );
    }

    const current = await this.getSettings(orgId);
    const data: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};

    if (dto.saleStageProbabilities !== undefined) {
      const merged = this.mergeStageProbabilities(
        dto.saleStageProbabilities,
        current.saleStageProbabilities,
      );
      data.saleStageProbabilities = merged;
      changed.saleStageProbabilities = merged;
    }

    // upsert, because "no row" is the normal state rather than an edge case.
    await this.prisma.orgSettings.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    });

    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      entity: 'OrgSettings',
      entityId: orgId,
      oldValues: { saleStageProbabilities: current.saleStageProbabilities },
      newValues: changed,
    });

    return this.getSettings(orgId);
  }

  private async assertOrgExists(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
  }

  /**
   * Validate a submitted stage→probability map and merge it over the current effective map.
   *
   * Merge rather than replace, so a form that only edits PROSPECT does not silently wipe
   * LOI_SIGNED, and so CLOSED/CANCELLED — which callers are not allowed to send — keep
   * whatever they already hold.
   *
   * Every rejection names the offending key or value AND states what is accepted. An
   * admin typing a probability into a form gets one shot at the error message; "invalid
   * saleStageProbabilities" would make them guess whether the problem is the key, the
   * range, the type, or the ordering.
   */
  private mergeStageProbabilities(
    raw: Record<string, unknown>,
    currentEffective: Record<string, number>,
  ): Record<string, number> {
    // The DTO already enforces this at the pipe, but the service is also called directly in
    // tests and could be called from another service later; Object.entries(null) is a 500
    // rather than a 400, which is the wrong failure for a bad request.
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException(
        `saleStageProbabilities must be an object mapping sale stages to probabilities, ` +
          `got ${Array.isArray(raw) ? 'an array' : JSON.stringify(raw) ?? 'undefined'}. ` +
          `Example: { "PROSPECT": 0.1, "LOI_SIGNED": 0.35 }. ` +
          `Configurable stages are: ${WRITABLE_LIST}.`,
      );
    }

    const entries = Object.entries(raw);

    if (entries.length === 0) {
      throw new BadRequestException(
        `saleStageProbabilities was empty. Provide a probability for at least one of: ${WRITABLE_LIST}.`,
      );
    }

    const submitted: Record<string, number> = {};

    for (const [stage, value] of entries) {
      if (!KNOWN_STAGES.has(stage)) {
        throw new BadRequestException(
          `Unknown sale stage "${stage}" in saleStageProbabilities. ` +
            `Configurable stages are: ${WRITABLE_LIST}.`,
        );
      }

      // CLOSED and CANCELLED are real stages but not configurable ones. SalesForecastService
      // .forProject filters both out of `inFlight` before computing totalPipelineValue and
      // weightedForecast, so a probability stored against them changes precisely nothing.
      // Accepting the write would show the admin a saved value that does not move a single
      // number on the forecast — a silent no-op is worse than a refusal that explains itself.
      if (!WRITABLE_STAGES.has(stage)) {
        throw new BadRequestException(
          `Sale stage "${stage}" is not configurable: the forecast excludes CLOSED and ` +
            `CANCELLED deals before weighting, so a probability stored for "${stage}" would ` +
            `have no effect on the forecast at all. Configurable stages are: ${WRITABLE_LIST}.`,
        );
      }

      if (typeof value !== 'number') {
        throw new BadRequestException(
          `Probability for sale stage "${stage}" must be a number, got ${JSON.stringify(value)} ` +
            `(${value === null ? 'null' : typeof value}). ` +
            `Allowed values are finite numbers from 0 to 1 inclusive.`,
        );
      }

      if (!Number.isFinite(value)) {
        throw new BadRequestException(
          `Probability for sale stage "${stage}" must be a finite number, got ${String(value)}. ` +
            `Allowed values are finite numbers from 0 to 1 inclusive.`,
        );
      }

      if (value < 0 || value > 1) {
        throw new BadRequestException(
          `Probability ${value} for sale stage "${stage}" is out of range. ` +
            `Allowed values are finite numbers from 0 to 1 inclusive ` +
            `(0.35 means a 35% chance the deal closes, not 35).`,
        );
      }

      submitted[stage] = value;
    }

    const merged = { ...currentEffective, ...submitted };

    this.assertNonDecreasing(merged);

    // Rewrite in canonical order so the stored JSON reads in pipeline order.
    const ordered: Record<string, number> = {};
    for (const stage of STAGE_WRITE_ORDER) {
      if (merged[stage] !== undefined) ordered[stage] = merged[stage];
    }
    return ordered;
  }

  /**
   * Ordering guard — DECISION: reject, do not merely warn.
   *
   * A probability that falls as a deal advances (PROSPECT 0.5 → LOI_SIGNED 0.2) makes the
   * weighted forecast drop when a deal moves *forward*, which is close to always a typo or
   * a misplaced decimal. This number is a company-wide financial assumption that ends up in
   * lender-facing numbers, and the cost of the two choices is lopsided: refusing costs an
   * admin one retype, while allowing it silently corrupts a headline figure that nobody
   * re-derives by hand. A logged warning would be invisible — no one reads API logs before
   * quoting a forecast.
   *
   * Equal values ARE allowed: an org that genuinely treats LOI and contract as equally
   * likely is unusual but coherent, and only a strict *decrease* is the mistake.
   *
   * Checked on the MERGED map, not on the submitted keys, because a one-field partial
   * update is exactly how a ladder gets broken against values the caller cannot see.
   */
  private assertNonDecreasing(merged: Record<string, number>) {
    for (let i = 1; i < WRITABLE_SALE_STAGE_PROBABILITIES.length; i++) {
      const earlier = WRITABLE_SALE_STAGE_PROBABILITIES[i - 1];
      const later = WRITABLE_SALE_STAGE_PROBABILITIES[i];
      const earlierValue = merged[earlier];
      const laterValue = merged[later];
      if (earlierValue === undefined || laterValue === undefined) continue;

      if (laterValue < earlierValue) {
        throw new BadRequestException(
          `Sale stage probabilities must not decrease as a deal advances: "${later}" (${laterValue}) ` +
            `is lower than "${earlier}" (${earlierValue}), which would make the weighted forecast ` +
            `fall when a deal moves forward. Values must satisfy ` +
            `${WRITABLE_SALE_STAGE_PROBABILITIES.join(' <= ')}. This is checked against the merged ` +
            `result, so a partial update can conflict with values already saved.`,
        );
      }
    }
  }

  /**
   * The stored column is JSON written before this endpoint existed, so it is untrusted:
   * it can be null, a scalar, an array, or hand-edited junk. Anything that is not a finite
   * number in 0..1 under a known stage is dropped so the caller falls back to the default —
   * matching what SalesForecastService.sanitizeProbabilities does at read time, so the
   * settings screen and the forecast never disagree about what is in force.
   */
  private sanitizeStoredProbabilities(raw: unknown, orgId: string): Record<string, number> {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      if (raw != null) {
        this.logger.warn(
          `OrgSettings.saleStageProbabilities for org ${orgId} is not an object; using defaults`,
        );
      }
      return {};
    }

    const out: Record<string, number> = {};
    for (const [stage, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!KNOWN_STAGES.has(stage)) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) continue;
      out[stage] = value;
    }
    return out;
  }
}
