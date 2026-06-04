import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadStatus, LeadSource, LeadActivityType, Prisma } from '@prisma/client';

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: {
    projectId?: string;
    status?: LeadStatus;
    assignedTo?: string;
    unitId?: string;
    buildingId?: string;
    campaignId?: string;
    search?: string;
  } = {}) {
    const { projectId, status, assignedTo, unitId, buildingId, campaignId, search } = params;

    const where: Prisma.LeadWhereInput = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (assignedTo) where.assignedTo = assignedTo;
    if (unitId) where.unitId = unitId;
    if (buildingId) where.buildingId = buildingId;
    if (campaignId) where.campaignId = campaignId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.lead.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true, buildingId: true } },
        building: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true, channel: true } },
        assignedUser: { select: { id: true, name: true, avatarUrl: true } },
        createdByUser: { select: { id: true, name: true } },
        _count: { select: { activities: true } },
        // When the caller scopes to a specific unit or building, include the activity
        // feed so the panel can render a merged timeline without N+1 fetches.
        // Skipped for unscoped lists to keep payload lean.
        ...((unitId || buildingId) ? { activities: { orderBy: { createdAt: 'desc' as const }, take: 20, include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } } } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true, buildingId: true } },
        building: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true, channel: true } },
        assignedUser: { select: { id: true, name: true, avatarUrl: true } },
        createdByUser: { select: { id: true, name: true } },
        activities: {
          include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { createdAt: 'desc' },
        },
        unitInterests: {
          include: { unit: { select: { id: true, unitNumber: true, buildingId: true, status: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  // ─────── Multi-unit interest / per-unit waitlist ───────

  /** Record that a lead is interested in a unit (idempotent on lead+unit). */
  async addInterest(leadId: string, unitId: string, note?: string) {
    if (!unitId) throw new BadRequestException('unitId is required');
    const [lead, unit] = await Promise.all([
      this.prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } }),
      this.prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } }),
    ]);
    if (!lead) throw new NotFoundException('Lead not found');
    if (!unit) throw new NotFoundException('Unit not found');
    return this.prisma.leadUnitInterest.upsert({
      where: { leadId_unitId: { leadId, unitId } },
      create: { leadId, unitId, note },
      update: { note },
      include: { unit: { select: { id: true, unitNumber: true, status: true } } },
    });
  }

  /** Remove a lead↔unit interest by the join-row id. */
  async removeInterest(interestId: string) {
    const existing = await this.prisma.leadUnitInterest.findUnique({ where: { id: interestId } });
    if (!existing) throw new NotFoundException('Interest not found');
    return this.prisma.leadUnitInterest.delete({ where: { id: interestId } });
  }

  /** Waitlist / demand for a unit: every lead that has expressed interest, oldest first. */
  async unitWaitlist(unitId: string) {
    if (!unitId) throw new BadRequestException('unitId is required');
    const interests = await this.prisma.leadUnitInterest.findMany({
      // Exclude interests whose unit has been archived/merged away.
      where: { unitId, unit: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      include: {
        lead: {
          select: {
            id: true, name: true, email: true, phone: true, status: true, budget: true,
            assignedUser: { select: { id: true, name: true } },
          },
        },
      },
    });
    return interests.map((i, idx) => ({
      interestId: i.id,
      position: idx + 1,
      note: i.note,
      addedAt: i.createdAt,
      lead: i.lead,
    }));
  }

  async create(data: {
    projectId: string;
    name?: string;
    email?: string;
    phone?: string;
    source: LeadSource;
    status?: LeadStatus;
    unitId?: string;
    buildingId?: string;
    unitInterest?: string;
    budget?: number;
    notes?: string;
    assignedTo?: string;
    createdBy: string;
    // Sprint 2 — campaign attribution
    campaignId?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
  }) {
    const { budget, unitId, buildingId, campaignId, ...rest } = data;
    if (unitId && buildingId) {
      throw new BadRequestException('A lead can attach to either a unit or a building, not both');
    }
    // If campaignId not provided but utmCampaign is, try to resolve to an active
    // campaign matching by name (case-insensitive). Falls back to raw passthrough
    // if no match — utm* fields remain populated for later reconstruction.
    let resolvedCampaignId = campaignId;
    if (!resolvedCampaignId && data.utmCampaign) {
      const match = await this.prisma.campaign.findFirst({
        where: { name: { equals: data.utmCampaign, mode: 'insensitive' }, deletedAt: null },
        select: { id: true },
      });
      if (match) resolvedCampaignId = match.id;
    }
    if (resolvedCampaignId) {
      const campaign = await this.prisma.campaign.findFirst({
        where: { id: resolvedCampaignId, deletedAt: null },
        select: { id: true },
      });
      if (!campaign) throw new BadRequestException('Campaign not found or has been deleted');
    }
    if (unitId) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: unitId, building: { projectId: data.projectId } },
        select: { id: true },
      });
      if (!unit) throw new BadRequestException('Unit does not belong to the specified project');
    }
    if (buildingId) {
      const building = await this.prisma.building.findFirst({
        where: { id: buildingId, projectId: data.projectId },
        select: { id: true },
      });
      if (!building) throw new BadRequestException('Building does not belong to the specified project');
    }
    return this.prisma.lead.create({
      data: {
        ...rest,
        unitId: unitId ?? null,
        buildingId: buildingId ?? null,
        campaignId: resolvedCampaignId ?? null,
        budget: budget !== undefined ? budget : undefined,
        status: data.status ?? 'NEW',
      },
      include: {
        project: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true, buildingId: true } },
        building: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true, channel: true } },
        assignedUser: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: string, data: {
    name?: string;
    email?: string;
    phone?: string;
    source?: LeadSource;
    status?: LeadStatus;
    unitId?: string | null;
    buildingId?: string | null;
    unitInterest?: string;
    budget?: number;
    notes?: string;
    assignedTo?: string;
  }) {
    const existing = await this.findById(id);
    const { budget, unitId, buildingId, ...rest } = data;
    // XOR check: only enforce if BOTH would end up set after this update.
    const effectiveUnitId = unitId === undefined ? existing.unitId : unitId;
    const effectiveBuildingId = buildingId === undefined ? existing.buildingId : buildingId;
    if (effectiveUnitId && effectiveBuildingId) {
      throw new BadRequestException('A lead can attach to either a unit or a building, not both');
    }
    if (unitId) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: unitId, building: { projectId: existing.projectId } },
        select: { id: true },
      });
      if (!unit) throw new BadRequestException('Unit does not belong to this lead\'s project');
    }
    if (buildingId) {
      const building = await this.prisma.building.findFirst({
        where: { id: buildingId, projectId: existing.projectId },
        select: { id: true },
      });
      if (!building) throw new BadRequestException('Building does not belong to this lead\'s project');
    }
    return this.prisma.lead.update({
      where: { id },
      data: {
        ...rest,
        ...(unitId !== undefined ? { unitId } : {}),
        ...(buildingId !== undefined ? { buildingId } : {}),
        budget: budget !== undefined ? budget : undefined,
      },
      include: {
        project: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true, buildingId: true } },
        building: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
      },
    });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.lead.delete({ where: { id } });
  }

  // ---- Dashboard (Sprint 3) ----

  /**
   * Aggregated dashboard payload — pipeline funnel, source breakdown, stale leads,
   * recent activity, and overall conversion rate. One query path per concern so we
   * don't repeat scans; everything filterable by projectId when scoped.
   */
  async dashboard(params: { projectId?: string } = {}) {
    const { projectId } = params;
    const where: Prisma.LeadWhereInput = projectId ? { projectId } : {};

    // Pipeline funnel — count grouped by status.
    const byStatusRows = await this.prisma.lead.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const row of byStatusRows) byStatus[row.status] = row._count._all;

    // Source breakdown — count grouped by source.
    const bySourceRows = await this.prisma.lead.groupBy({
      by: ['source'],
      where,
      _count: { _all: true },
    });
    const bySource = bySourceRows.map((r) => ({ source: r.source, count: r._count._all }))
      .sort((a, b) => b.count - a.count);

    // Conversion rate — CONVERTED count / total non-LOST/DEAD.
    const totalActive = Object.entries(byStatus)
      .filter(([s]) => !['LOST', 'DEAD'].includes(s))
      .reduce((sum, [, n]) => sum + n, 0);
    const converted = byStatus['CONVERTED'] ?? 0;
    const conversionRate = totalActive > 0 ? converted / totalActive : null;

    // Stale leads — no activity (lead.updatedAt is bumped on activity log) in 14+ days
    // and not in a terminal status. Surfaces what's rotting.
    const staleCutoff = new Date(Date.now() - 14 * 86_400_000);
    const staleLeads = await this.prisma.lead.findMany({
      where: {
        ...where,
        updatedAt: { lt: staleCutoff },
        status: { notIn: ['CONVERTED', 'LOST', 'DEAD'] },
      },
      select: {
        id: true,
        name: true,
        status: true,
        source: true,
        updatedAt: true,
        project: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });

    // Recent activity — across all leads in scope, last 15 events.
    const recentActivity = await this.prisma.leadActivity.findMany({
      where: projectId ? { lead: { projectId } } : {},
      select: {
        id: true,
        type: true,
        note: true,
        createdAt: true,
        lead: { select: { id: true, name: true, status: true, projectId: true } },
        createdByUser: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    // Attribution health — how many leads have a unit/building/campaign link.
    // Surfaces the gap when leads aren't connected (the original complaint).
    const totalLeads = Object.values(byStatus).reduce((s, n) => s + n, 0);
    const [withUnit, withBuilding, withCampaign] = await Promise.all([
      this.prisma.lead.count({ where: { ...where, unitId: { not: null } } }),
      this.prisma.lead.count({ where: { ...where, buildingId: { not: null } } }),
      this.prisma.lead.count({ where: { ...where, campaignId: { not: null } } }),
    ]);

    return {
      totalLeads,
      byStatus,
      bySource,
      conversionRate,
      attribution: {
        withUnit, withBuilding, withCampaign,
        unattached: totalLeads - withUnit - withBuilding,
      },
      staleLeads,
      recentActivity,
    };
  }

  // ---- Activities ----

  async getActivities(leadId: string) {
    await this.findById(leadId);
    return this.prisma.leadActivity.findMany({
      where: { leadId },
      include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addActivity(leadId: string, userId: string, type: LeadActivityType, note: string) {
    await this.findById(leadId);
    const activity = await this.prisma.leadActivity.create({
      data: { leadId, createdBy: userId, type, note },
      include: { createdByUser: { select: { id: true, name: true, avatarUrl: true } } },
    });
    await this.prisma.lead.update({ where: { id: leadId }, data: { updatedAt: new Date() } });
    return activity;
  }

  // ---- Convert to Sale ----

  async convertToSale(leadId: string, userId: string, saleData: {
    unitId: string;
    buyer: string;
    salePrice: number;
    contractDate?: string;
    closingDate?: string;
  }) {
    const lead = await this.findById(leadId);

    if (lead.status === 'CONVERTED') {
      throw new BadRequestException('Lead is already converted');
    }

    // Create the sale
    const sale = await this.prisma.sale.create({
      data: {
        projectId: lead.projectId,
        unitId: saleData.unitId,
        buyer: saleData.buyer,
        salePrice: saleData.salePrice,
        contractDate: saleData.contractDate ? new Date(saleData.contractDate) : undefined,
        closingDate: saleData.closingDate ? new Date(saleData.closingDate) : undefined,
        status: 'UNDER_CONTRACT',
      },
    });

    // Mark lead as converted and link to sale
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { status: 'CONVERTED', convertedToSaleId: sale.id },
    });

    // Log the activity
    await this.prisma.leadActivity.create({
      data: {
        leadId,
        createdBy: userId,
        type: 'STATUS_CHANGE',
        note: `Converted to sale (Sale ID: ${sale.id})`,
      },
    });

    return { lead: await this.findById(leadId), sale };
  }
}
