import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CashFlowType } from '@prisma/client';
import { CashflowEngineService } from './cashflow-engine.service';
import { ProjectAccessService } from '../../common/access/project-access.service';

@Injectable()
export class CashFlowService {
  constructor(
    private prisma: PrismaService,
    private engine: CashflowEngineService,
    private access: ProjectAccessService,
  ) {}

  async findByProject(projectId: string) {
    return this.prisma.cashFlowEntry.findMany({
      where: { projectId },
      orderBy: [{ month: 'asc' }, { entryType: 'asc' }],
    });
  }

  async create(data: any, userId: string) {
    return this.prisma.cashFlowEntry.create({
      data: {
        projectId: data.projectId,
        month: new Date(data.month),
        entryType: data.entryType as CashFlowType,
        category: data.category,
        amount: Number(data.amount),
        isActual: data.isActual !== false,
        notes: data.notes,
      },
    });
  }

  async update(id: string, data: any) {
    const entry = await this.prisma.cashFlowEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Cash flow entry not found');
    return this.prisma.cashFlowEntry.update({
      where: { id },
      data: {
        ...(data.month && { month: new Date(data.month) }),
        ...(data.entryType && { entryType: data.entryType }),
        ...(data.category && { category: data.category }),
        ...(data.amount !== undefined && { amount: Number(data.amount) }),
        ...(data.isActual !== undefined && { isActual: data.isActual }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  }

  async delete(id: string) {
    const entry = await this.prisma.cashFlowEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Cash flow entry not found');
    return this.prisma.cashFlowEntry.delete({ where: { id } });
  }

  /**
   * Per-project forecast — the full unified projection (all inflow sources + the five
   * outflow categories), bucketed monthly over the horizon. Delegates to the engine.
   */
  async getForecast(projectId: string, months?: number) {
    return this.engine.buildTimeline({ projectId, months });
  }

  /**
   * Portfolio forecast across every project the viewer may see. Scoped roles
   * (PM/Construction/Sales/Marketing) are restricted to their member projects.
   */
  async getPortfolioForecast(viewer: { userId: string; role: string; roles?: string[] }, months?: number) {
    const projectIds = this.access.isScoped(viewer.role)
      ? await this.access.accessibleProjectIds(viewer.userId)
      : undefined; // undefined = all projects
    return this.engine.buildTimeline({ projectIds, months });
  }

  /**
   * Budget "cash needs" view — the engine's OUTFLOWS grouped into the client's five
   * budget categories (Loan Payment / Sub-contractor AP / TI / Commissions / Misc),
   * re-bucketed by month, quarter, or year, with outstanding totals per category and
   * the immediate payables ("budget needed now"). Gated on budget:view, so a PM (who
   * keeps the budget but not the financial module) can run it.
   */
  async getObligations(
    viewer: { userId: string; role: string; roles?: string[] },
    opts: { projectId?: string; granularity?: 'month' | 'quarter' | 'year' } = {},
  ) {
    const granularity = opts.granularity ?? 'month';
    const horizonMonths = granularity === 'year' ? 36 : 12;
    const projectIds = opts.projectId
      ? undefined
      : this.access.isScoped(viewer.role)
        ? await this.access.accessibleProjectIds(viewer.userId)
        : undefined;

    const timeline = await this.engine.buildTimeline({
      projectId: opts.projectId,
      projectIds,
      months: horizonMonths,
    });

    const categories = ['loanPayments', 'subcontractorAP', 'interiorTI', 'commissions', 'misc'] as const;
    const periodMap = new Map<string, { label: string; byCategory: Record<string, number> }>();
    const outstandingByCategory: Record<string, number> = Object.fromEntries(categories.map((c) => [c, 0]));

    for (const m of timeline.monthly) {
      const { key, label } = this.periodOf(m.month, granularity);
      if (!periodMap.has(key)) {
        periodMap.set(key, { label, byCategory: Object.fromEntries(categories.map((c) => [c, 0])) });
      }
      const period = periodMap.get(key)!;
      for (const c of categories) {
        const v = (m.outflowsByCategory as Record<string, number>)[c] ?? 0;
        period.byCategory[c] += v;
        outstandingByCategory[c] += v;
      }
    }

    const periods = [...periodMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, p]) => ({
        key,
        label: p.label,
        byCategory: roundRecord(p.byCategory),
        total: round(Object.values(p.byCategory).reduce((s, v) => s + v, 0)),
      }));

    // "Budget needed now" — payables owed immediately (land in the first month).
    const first = timeline.monthly[0]?.outflowsByCategory as Record<string, number> | undefined;
    const immediatePayables = first
      ? round((first.subcontractorAP ?? 0) + (first.interiorTI ?? 0) + (first.commissions ?? 0) + (first.loanPayments ?? 0))
      : 0;

    return {
      granularity,
      horizonMonths,
      categories,
      periods,
      outstandingByCategory: roundRecord(outstandingByCategory),
      outstandingTotal: round(Object.values(outstandingByCategory).reduce((s, v) => s + v, 0)),
      immediatePayables,
    };
  }

  private periodOf(month: string, g: 'month' | 'quarter' | 'year'): { key: string; label: string } {
    const [y, m] = month.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (g === 'year') return { key: y, label: y };
    if (g === 'quarter') {
      const q = Math.floor((parseInt(m, 10) - 1) / 3) + 1;
      return { key: `${y}-Q${q}`, label: `Q${q} ${y}` };
    }
    return { key: month, label: `${monthNames[parseInt(m, 10) - 1]} ${y}` };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function roundRecord(rec: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = round(v);
  return out;
}
