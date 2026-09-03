import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectAccessService } from '../../common/access/project-access.service';
import { Prisma, CampaignChannel, CampaignStatus, CampaignSpendSource } from '@prisma/client';

// Stage probabilities (matches the May 5 walkthrough's sales pipeline weighting).
// Lead status → win-probability used in CPL/CPA calculations. NEGOTIATING is the
// highest active stage; CONVERTED leads are a separate path through sales.
const LEAD_STAGE_PROBABILITY: Record<string, number> = {
  NEW:           0.05,
  CONTACTED:     0.15,
  QUALIFIED:     0.30,
  PROPOSAL_SENT: 0.50,
  NEGOTIATING:   0.75,
  CONVERTED:     1.0,
};

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService, private access: ProjectAccessService) {}

  // ---- CRUD ----

  async findAll(params: { projectId?: string; status?: CampaignStatus; channel?: CampaignChannel; viewer?: { userId: string; role: string; roles?: string[] } } = {}) {
    const where: Prisma.CampaignWhereInput = { deletedAt: null };
    // `project: { deletedAt: null }` alongside the projectId match — a campaign linked
    // only to an archived project otherwise kept showing in the filtered/scoped views.
    // (A campaign with no project link at all, or one also linked to a live project, is
    // unaffected — this only narrows the `some` match itself.)
    if (params.projectId) {
      where.projects = { some: { projectId: params.projectId, project: { deletedAt: null } } };
    } else {
      const scopeIds = await this.access.listProjectScope(params.viewer, params.projectId);
      if (scopeIds) where.projects = { some: { projectId: { in: scopeIds }, project: { deletedAt: null } } };
    }
    if (params.status) where.status = params.status;
    if (params.channel) where.channel = params.channel;

    return this.prisma.campaign.findMany({
      where,
      include: {
        projects: { include: { project: { select: { id: true, name: true } } } },
        createdByUser: { select: { id: true, name: true } },
        _count: { select: { leads: true, spend: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, deletedAt: null },
      include: {
        projects: { include: { project: { select: { id: true, name: true } } } },
        createdByUser: { select: { id: true, name: true } },
        spend: {
          orderBy: { spentOn: 'desc' },
          include: { recordedByUser: { select: { id: true, name: true } } },
        },
        _count: { select: { leads: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async create(data: {
    projectIds?: string[];
    name: string;
    channel: CampaignChannel;
    externalId?: string;
    plannedBudget?: number;
    status?: CampaignStatus;
    startDate?: string;
    endDate?: string;
    notes?: string;
    createdBy: string;
  }) {
    const projectIds = Array.from(new Set(data.projectIds ?? []));
    if (projectIds.length > 0) {
      const found = await this.prisma.project.findMany({
        where: { id: { in: projectIds }, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== projectIds.length) throw new BadRequestException('One or more projects not found');
    }
    return this.prisma.campaign.create({
      data: {
        name: data.name,
        channel: data.channel,
        externalId: data.externalId,
        plannedBudget: data.plannedBudget,
        status: data.status ?? 'PLANNED',
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        notes: data.notes,
        createdBy: data.createdBy,
        projects: { create: projectIds.map((projectId) => ({ projectId })) },
      },
      include: {
        projects: { include: { project: { select: { id: true, name: true } } } },
        createdByUser: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: string, data: {
    projectIds?: string[];
    name?: string;
    channel?: CampaignChannel;
    externalId?: string;
    plannedBudget?: number;
    status?: CampaignStatus;
    startDate?: string;
    endDate?: string;
    notes?: string;
  }) {
    await this.findById(id);

    // projectIds is a full replacement of the link set, not a merge: whatever the
    // caller sends becomes the campaign's projects. `undefined` leaves them alone,
    // `[]` clears them (portfolio-wide). Validated the same way create() does so an
    // unknown or soft-deleted project can't be linked.
    const { projectIds, ...scalars } = data;
    let relinked: string[] | undefined;
    if (projectIds !== undefined) {
      relinked = Array.from(new Set(projectIds));
      if (relinked.length > 0) {
        const found = await this.prisma.project.findMany({
          where: { id: { in: relinked }, deletedAt: null },
          select: { id: true },
        });
        if (found.length !== relinked.length) throw new BadRequestException('One or more projects not found');
      }
    }

    const scalarData = {
      ...scalars,
      startDate: scalars.startDate !== undefined
        ? (scalars.startDate ? new Date(scalars.startDate) : null)
        : undefined,
      endDate: scalars.endDate !== undefined
        ? (scalars.endDate ? new Date(scalars.endDate) : null)
        : undefined,
    };

    // Swap the join rows and the scalars together — a half-applied re-link would
    // leave the campaign attributed to the wrong projects.
    return this.prisma.$transaction(async (tx) => {
      if (relinked !== undefined) {
        await tx.campaignProject.deleteMany({ where: { campaignId: id } });
        if (relinked.length > 0) {
          await tx.campaignProject.createMany({
            data: relinked.map((projectId) => ({ campaignId: id, projectId })),
          });
        }
      }
      return tx.campaign.update({
        where: { id },
        data: scalarData,
        include: {
          projects: { include: { project: { select: { id: true, name: true } } } },
          createdByUser: { select: { id: true, name: true } },
        },
      });
    });
  }

  /**
   * Soft-delete preserves attribution history. Linked leads keep their utm* fields
   * (via Lead.campaignId ON DELETE SET NULL behaviour at the FK level) so the raw
   * marketing signal is never lost.
   */
  async delete(id: string) {
    await this.findById(id);
    return this.prisma.campaign.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ---- Spend ledger (append-only) ----

  async recordSpend(campaignId: string, data: {
    amount: number;
    currency?: string;
    spentOn: string;
    source?: CampaignSpendSource;
    externalRef?: string;
    recordedBy: string;
  }) {
    await this.findById(campaignId); // guards against soft-deleted or missing
    try {
      return await this.prisma.campaignSpend.create({
        data: {
          campaignId,
          amount: data.amount,
          currency: data.currency ?? 'USD',
          spentOn: new Date(data.spentOn),
          source: data.source ?? 'MANUAL',
          externalRef: data.externalRef ?? null,
          recordedBy: data.recordedBy,
        },
        include: { recordedByUser: { select: { id: true, name: true } } },
      });
    } catch (err: any) {
      // P2002: unique constraint violation on (campaignId, source, externalRef)
      // — same external row already imported.
      if (err?.code === 'P2002') {
        throw new ConflictException('This spend entry has already been recorded (duplicate externalRef)');
      }
      throw err;
    }
  }

  async listSpend(campaignId: string) {
    await this.findById(campaignId);
    return this.prisma.campaignSpend.findMany({
      where: { campaignId },
      orderBy: { spentOn: 'desc' },
      include: { recordedByUser: { select: { id: true, name: true } } },
    });
  }

  /**
   * Monthly spend trend grouped by channel. Powers the Ads Dashboard chart —
   * `monthsBack` months of history (default 6), with one row per (month, channel).
   * Months with no spend on a channel are emitted as zero so the line chart has
   * continuous data points instead of gaps.
   */
  async spendTrend(params: { projectId?: string; monthsBack?: number; viewer?: { userId: string; role: string; roles?: string[] } } = {}) {
    const monthsBack = Math.max(1, Math.min(24, params.monthsBack ?? 6));
    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

    const campaignWhere: Prisma.CampaignWhereInput = { deletedAt: null };
    if (params.projectId) campaignWhere.projects = { some: { projectId: params.projectId } };
    else {
      const scopeIds = await this.access.listProjectScope(params.viewer, params.projectId);
      if (scopeIds) campaignWhere.projects = { some: { projectId: { in: scopeIds } } };
    }

    const spend = await this.prisma.campaignSpend.findMany({
      where: {
        spentOn: { gte: startMonth },
        campaign: campaignWhere,
      },
      select: {
        amount: true,
        spentOn: true,
        campaign: { select: { channel: true } },
      },
    });

    // Bucket by (YYYY-MM, channel) summing amounts.
    const buckets = new Map<string, Map<string, number>>(); // month → channel → total
    const channelsSeen = new Set<string>();
    for (let i = 0; i < monthsBack; i++) {
      const m = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, new Map());
    }
    for (const s of spend) {
      const m = `${s.spentOn.getFullYear()}-${String(s.spentOn.getMonth() + 1).padStart(2, '0')}`;
      const ch = s.campaign.channel;
      channelsSeen.add(ch);
      const monthMap = buckets.get(m);
      if (!monthMap) continue; // outside range (shouldn't happen given startMonth filter)
      monthMap.set(ch, (monthMap.get(ch) ?? 0) + Number(s.amount));
    }

    const channels = Array.from(channelsSeen).sort();
    const series = Array.from(buckets.entries()).map(([month, channelMap]) => {
      const row: Record<string, string | number> = { month };
      for (const ch of channels) row[ch] = channelMap.get(ch) ?? 0;
      row['_total'] = channels.reduce((sum, ch) => sum + (channelMap.get(ch) ?? 0), 0);
      return row;
    });

    return { months: monthsBack, channels, series };
  }

  /**
   * Total spend per campaign (all non-deleted campaigns, including $0-spend ones).
   * Powers the "Spend by campaign" bar chart — unlike spendTrend() (channel/month
   * buckets, last N months only), this always includes every campaign so it's
   * visible even before any spend has been logged.
   */
  async spendByCampaign(params: { projectId?: string; viewer?: { userId: string; role: string; roles?: string[] } } = {}) {
    const where: Prisma.CampaignWhereInput = { deletedAt: null };
    // `project: { deletedAt: null }` alongside the projectId match — a campaign linked
    // only to an archived project otherwise kept showing in the filtered/scoped views.
    // (A campaign with no project link at all, or one also linked to a live project, is
    // unaffected — this only narrows the `some` match itself.)
    if (params.projectId) {
      where.projects = { some: { projectId: params.projectId, project: { deletedAt: null } } };
    } else {
      const scopeIds = await this.access.listProjectScope(params.viewer, params.projectId);
      if (scopeIds) where.projects = { some: { projectId: { in: scopeIds }, project: { deletedAt: null } } };
    }

    const campaigns = await this.prisma.campaign.findMany({
      where,
      select: { id: true, name: true, channel: true, status: true, spend: { select: { amount: true } } },
    });

    return campaigns
      .map((c) => ({
        campaignId: c.id,
        name: c.name,
        channel: c.channel,
        status: c.status,
        totalSpend: c.spend.reduce((sum, s) => sum + Number(s.amount), 0),
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }

  // ---- Performance / attribution report ----

  /**
   * Performance summary — leads + qualified + converted + revenue + spend + CPL + CPA + ROI.
   * Optionally scoped to a project and a date range. Spend is summed from the ledger
   * (never overwritten); converted-revenue traces Lead.convertedToSaleId → Sale.salePrice.
   */
  async performance(params: { projectId?: string; from?: string; to?: string; viewer?: { userId: string; role: string; roles?: string[] } } = {}) {
    const where: Prisma.CampaignWhereInput = { deletedAt: null };
    // `project: { deletedAt: null }` alongside the projectId match — a campaign linked
    // only to an archived project otherwise kept showing in the filtered/scoped views.
    // (A campaign with no project link at all, or one also linked to a live project, is
    // unaffected — this only narrows the `some` match itself.)
    if (params.projectId) {
      where.projects = { some: { projectId: params.projectId, project: { deletedAt: null } } };
    } else {
      const scopeIds = await this.access.listProjectScope(params.viewer, params.projectId);
      if (scopeIds) where.projects = { some: { projectId: { in: scopeIds }, project: { deletedAt: null } } };
    }

    const campaigns = await this.prisma.campaign.findMany({
      where,
      include: {
        spend: params.from || params.to ? {
          where: {
            spentOn: {
              ...(params.from ? { gte: new Date(params.from) } : {}),
              ...(params.to ? { lte: new Date(params.to) } : {}),
            },
          },
        } : true,
        leads: {
          select: {
            id: true,
            status: true,
            convertedToSale: { select: { salePrice: true, status: true } },
          },
        },
        projects: { include: { project: { select: { id: true, name: true } } } },
      },
    });

    return campaigns.map((c) => {
      const totalSpend = c.spend.reduce((sum, s) => sum + Number(s.amount), 0);
      const leadCount = c.leads.length;
      const byStatus: Record<string, number> = {};
      let weightedLeads = 0;
      let convertedRevenue = 0;
      let convertedCount = 0;
      for (const l of c.leads) {
        byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
        weightedLeads += LEAD_STAGE_PROBABILITY[l.status] ?? 0;
        if (l.status === 'CONVERTED' && l.convertedToSale && l.convertedToSale.status === 'CLOSED') {
          convertedRevenue += Number(l.convertedToSale.salePrice ?? 0);
          convertedCount += 1;
        }
      }
      return {
        campaignId: c.id,
        name: c.name,
        channel: c.channel,
        status: c.status,
        projects: c.projects.map((cp) => cp.project),
        plannedBudget: c.plannedBudget ? Number(c.plannedBudget) : null,
        totalSpend,
        leadCount,
        byStatus,
        convertedCount,
        convertedRevenue,
        // Cost-per-lead, cost-per-acquisition, return on ad spend.
        // null when denominator is 0 to avoid divide-by-zero in the report UI.
        cpl: leadCount > 0 && totalSpend > 0 ? totalSpend / leadCount : null,
        cpa: convertedCount > 0 && totalSpend > 0 ? totalSpend / convertedCount : null,
        roi: totalSpend > 0 ? convertedRevenue / totalSpend : null,
        weightedLeads: Math.round(weightedLeads * 10) / 10,
      };
    });
  }
}
