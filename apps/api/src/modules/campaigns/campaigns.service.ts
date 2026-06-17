import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectAccessService } from '../../common/access/project-access.service';
import { Prisma, CampaignChannel, CampaignStatus, CampaignSpendSource, LeadStatus } from '@prisma/client';

// Stage probabilities (matches the May 5 walkthrough's sales pipeline weighting).
// Lead status → win-probability used in CPL/CPA calculations. NEGOTIATING is the
// highest active stage; CONVERTED leads are a separate path through sales.
const LEAD_STAGE_PROBABILITY: Partial<Record<LeadStatus, number>> = {
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

  async findAll(params: { projectId?: string; status?: CampaignStatus; channel?: CampaignChannel; viewer?: { userId: string; role: string } } = {}) {
    const where: Prisma.CampaignWhereInput = { deletedAt: null };
    if (params.projectId) where.projectId = params.projectId;
    else {
      const scopeIds = await this.access.listProjectScope(params.viewer, params.projectId);
      if (scopeIds) where.projectId = { in: scopeIds };
    }
    if (params.status) where.status = params.status;
    if (params.channel) where.channel = params.channel;

    return this.prisma.campaign.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
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
        project: { select: { id: true, name: true } },
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
    projectId?: string;
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
    if (data.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: data.projectId, deletedAt: null },
        select: { id: true },
      });
      if (!project) throw new BadRequestException('Project not found');
    }
    return this.prisma.campaign.create({
      data: {
        projectId: data.projectId ?? null,
        name: data.name,
        channel: data.channel,
        externalId: data.externalId,
        plannedBudget: data.plannedBudget,
        status: data.status ?? 'PLANNED',
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        notes: data.notes,
        createdBy: data.createdBy,
      },
      include: {
        project: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: string, data: {
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
    return this.prisma.campaign.update({
      where: { id },
      data: {
        ...data,
        startDate: data.startDate !== undefined
          ? (data.startDate ? new Date(data.startDate) : null)
          : undefined,
        endDate: data.endDate !== undefined
          ? (data.endDate ? new Date(data.endDate) : null)
          : undefined,
      },
      include: {
        project: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
      },
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
  async spendTrend(params: { projectId?: string; monthsBack?: number } = {}) {
    const monthsBack = Math.max(1, Math.min(24, params.monthsBack ?? 6));
    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

    const spend = await this.prisma.campaignSpend.findMany({
      where: {
        spentOn: { gte: startMonth },
        campaign: {
          deletedAt: null,
          ...(params.projectId ? { projectId: params.projectId } : {}),
        },
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

  // ---- Performance / attribution report ----

  /**
   * Performance summary — leads + qualified + converted + revenue + spend + CPL + CPA + ROI.
   * Optionally scoped to a project and a date range. Spend is summed from the ledger
   * (never overwritten); converted-revenue traces Lead.convertedToSaleId → Sale.salePrice.
   */
  async performance(params: { projectId?: string; from?: string; to?: string; viewer?: { userId: string; role: string } } = {}) {
    const where: Prisma.CampaignWhereInput = { deletedAt: null };
    if (params.projectId) where.projectId = params.projectId;
    else {
      const scopeIds = await this.access.listProjectScope(params.viewer, params.projectId);
      if (scopeIds) where.projectId = { in: scopeIds };
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
      },
    });

    return campaigns.map((c) => {
      const totalSpend = c.spend.reduce((sum, s) => sum + Number(s.amount), 0);
      const leadCount = c.leads.length;
      const byStatus: Partial<Record<LeadStatus, number>> = {};
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
