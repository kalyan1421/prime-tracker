import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The unified cash-flow projection engine. Builds a forward monthly timeline that merges
 * every money-movement source into one view, for a single project or a portfolio:
 *
 *   INFLOWS   salePayments · leaseIncome · drawSchedule · manual
 *   OUTFLOWS  loanPayments · subcontractorAP · interiorTI · commissions · misc
 *
 * The five OUTFLOW categories are exactly the client's budget categories (Monthly Loan
 * Payment / Sub-contractor AP / TI / Commissions / Miscellaneous), so the budget
 * "cash needs" view re-buckets this same data by quarter/year.
 *
 * Timing model: recurring sources (lease income, loan payments) spread across each month
 * in range; dated sources (sale installments, planned draws) land on their date; and
 * "owed now" obligations (vendor commitments, interior invoices, unpaid commissions) land
 * in the first month as near-term cash needs — which is what drives "budget needed next
 * 2/4 weeks". Lease escalation (escalationPct/Freq) is applied when configured.
 */

export const INFLOW_SOURCES = ['salePayments', 'leaseIncome', 'drawSchedule', 'manual'] as const;
export const OUTFLOW_CATEGORIES = ['loanPayments', 'subcontractorAP', 'interiorTI', 'commissions', 'misc'] as const;
export type InflowSource = (typeof INFLOW_SOURCES)[number];
export type OutflowCategory = (typeof OUTFLOW_CATEGORIES)[number];

export interface CashflowMonth {
  month: string; // YYYY-MM
  inflows: number;
  outflows: number;
  net: number;
  cumulative: number;
  inflowsBySource: Record<InflowSource, number>;
  outflowsByCategory: Record<OutflowCategory, number>;
}

export interface CashflowTimeline {
  horizonMonths: number;
  startMonth: string;
  summary: {
    totalInflows: number;
    totalOutflows: number;
    netCashFlow: number;
    burnRate: number;
    endingCumulative: number;
  };
  monthly: CashflowMonth[];
}

interface BuildOpts {
  projectId?: string;
  projectIds?: string[]; // portfolio scope; undefined = all projects
  months?: number; // horizon, default 12
  now?: Date; // injectable for tests
}

const DEFAULT_HORIZON = 12;

@Injectable()
export class CashflowEngineService {
  constructor(private prisma: PrismaService) {}

  async buildTimeline(opts: BuildOpts): Promise<CashflowTimeline> {
    const months = Math.min(60, Math.max(1, opts.months ?? DEFAULT_HORIZON));
    const now = opts.now ?? new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const keys = this.monthKeys(start, months);
    const inRange = new Set(keys);
    const firstKey = keys[0];

    // Empty buckets for every month in the horizon (so the chart is continuous).
    const buckets = new Map<string, { inflow: Record<string, number>; outflow: Record<string, number> }>();
    for (const k of keys) {
      buckets.set(k, {
        inflow: { salePayments: 0, leaseIncome: 0, drawSchedule: 0, manual: 0 },
        outflow: { loanPayments: 0, subcontractorAP: 0, interiorTI: 0, commissions: 0, misc: 0 },
      });
    }

    const projectFilter = this.projectFilter(opts);
    const addInflow = (key: string, src: InflowSource, amt: number) => {
      if (amt > 0 && buckets.has(key)) buckets.get(key)!.inflow[src] += amt;
    };
    const addOutflow = (key: string, cat: OutflowCategory, amt: number) => {
      if (amt > 0 && buckets.has(key)) buckets.get(key)!.outflow[cat] += amt;
    };

    await Promise.all([
      this.addSalePayments(projectFilter, inRange, addInflow),
      this.addLeaseIncome(projectFilter, keys, addInflow),
      this.addDrawSchedule(projectFilter, inRange, addInflow),
      this.addManualEntries(projectFilter, inRange, addInflow, addOutflow),
      this.addLoanPayments(projectFilter, keys, addOutflow),
      this.addCommitments(projectFilter, firstKey, addOutflow),
      this.addInteriorTI(projectFilter, firstKey, addOutflow),
      this.addCommissions(projectFilter, firstKey, addOutflow),
    ]);

    let cumulative = 0;
    const monthly: CashflowMonth[] = keys.map((month) => {
      const b = buckets.get(month)!;
      const inflows = sum(b.inflow);
      const outflows = sum(b.outflow);
      const net = inflows - outflows;
      cumulative += net;
      return {
        month,
        inflows: round(inflows),
        outflows: round(outflows),
        net: round(net),
        cumulative: round(cumulative),
        inflowsBySource: roundMap(b.inflow) as Record<InflowSource, number>,
        outflowsByCategory: roundMap(b.outflow) as Record<OutflowCategory, number>,
      };
    });

    const totalInflows = round(monthly.reduce((s, m) => s + m.inflows, 0));
    const totalOutflows = round(monthly.reduce((s, m) => s + m.outflows, 0));
    return {
      horizonMonths: months,
      startMonth: firstKey,
      summary: {
        totalInflows,
        totalOutflows,
        netCashFlow: round(totalInflows - totalOutflows),
        burnRate: round(totalOutflows / months),
        endingCumulative: monthly.length ? monthly[monthly.length - 1].cumulative : 0,
      },
      monthly,
    };
  }

  // ---- Sources ----

  private async addSalePayments(pf: any, inRange: Set<string>, add: AddInflow) {
    const rows = await this.prisma.salePayment.findMany({
      where: { sale: { ...pf, deletedAt: null }, status: { in: ['SCHEDULED', 'DUE', 'PARTIALLY_PAID', 'OVERDUE'] } },
      select: { amount: true, paidAmount: true, dueDate: true, effectiveDueDate: true },
    });
    for (const p of rows) {
      const due = p.effectiveDueDate ?? p.dueDate;
      if (!due) continue;
      const key = monthKey(due);
      if (!inRange.has(key)) continue;
      add(key, 'salePayments', Number(p.amount) - Number(p.paidAmount));
    }
  }

  private async addLeaseIncome(pf: any, keys: string[], add: AddInflow) {
    const leases = await this.prisma.lease.findMany({
      where: { status: 'ACTIVE', deletedAt: null, ...this.assetProjectFilter(pf) },
      select: { monthlyRent: true, leaseStart: true, leaseEnd: true, escalationPct: true, escalationFreq: true },
    });
    for (const l of leases) {
      const base = Number(l.monthlyRent);
      if (base <= 0) continue;
      const escPct = l.escalationPct ? Number(l.escalationPct) : 0;
      const escFreq = l.escalationFreq ?? 0;
      for (const key of keys) {
        const monthStart = monthStartFromKey(key);
        if (monthStart < startOfMonth(l.leaseStart) || monthStart > startOfMonth(l.leaseEnd)) continue;
        let rent = base;
        if (escPct > 0 && escFreq > 0) {
          const elapsed = monthsBetween(l.leaseStart, monthStart);
          rent = base * Math.pow(1 + escPct / 100, Math.floor(elapsed / escFreq));
        }
        add(key, 'leaseIncome', rent);
      }
    }
  }

  private async addDrawSchedule(pf: any, inRange: Set<string>, add: AddInflow) {
    const draws = await this.prisma.drawSchedule.findMany({
      where: { loan: { ...this.loanProjectFilter(pf), deletedAt: null } },
      select: { plannedAmount: true, plannedDate: true },
    });
    for (const d of draws) {
      const key = monthKey(d.plannedDate);
      if (!inRange.has(key)) continue;
      add(key, 'drawSchedule', Number(d.plannedAmount));
    }
  }

  private async addManualEntries(pf: any, inRange: Set<string>, addIn: AddInflow, addOut: AddOutflow) {
    const entries = await this.prisma.cashFlowEntry.findMany({
      where: { ...pf },
      select: { month: true, entryType: true, amount: true },
    });
    for (const e of entries) {
      const key = monthKey(e.month);
      if (!inRange.has(key)) continue;
      if (e.entryType === 'INFLOW') addIn(key, 'manual', Math.abs(e.amount));
      else addOut(key, 'misc', Math.abs(e.amount));
    }
  }

  private async addLoanPayments(pf: any, keys: string[], add: AddOutflow) {
    const loans = await this.prisma.loan.findMany({
      where: { ...this.loanProjectFilter(pf), deletedAt: null, monthlyPayment: { not: null } },
      select: { monthlyPayment: true, maturityDate: true },
    });
    for (const loan of loans) {
      const pmt = Number(loan.monthlyPayment);
      if (pmt <= 0) continue;
      const maturityKey = loan.maturityDate ? monthKey(loan.maturityDate) : null;
      for (const key of keys) {
        if (maturityKey && key > maturityKey) break;
        add(key, 'loanPayments', pmt);
      }
    }
  }

  private async addCommitments(pf: any, firstKey: string, add: AddOutflow) {
    const rows = await this.prisma.commitment.findMany({
      where: { ...pf },
      select: { contractAmt: true, paidToDate: true, retainage: true },
    });
    for (const c of rows) {
      // Outstanding payable = contract − paid − retainage held back. Owed near-term.
      const outstanding = Number(c.contractAmt) - Number(c.paidToDate) - Number(c.retainage);
      add(firstKey, 'subcontractorAP', outstanding);
    }
  }

  private async addInteriorTI(pf: any, firstKey: string, add: AddOutflow) {
    const invoices = await this.prisma.interiorInvoice.findMany({
      where: { paidAt: null, status: { not: 'PAID' }, interiorProject: { ...this.interiorProjectFilter(pf), deletedAt: null } },
      select: { amount: true },
    });
    for (const inv of invoices) add(firstKey, 'interiorTI', Number(inv.amount));
  }

  private async addCommissions(pf: any, firstKey: string, add: AddOutflow) {
    const sales = await this.prisma.sale.findMany({
      where: { ...pf, deletedAt: null, status: 'CLOSED', brokerCommissionAmt: { not: null } },
      select: { brokerCommissionAmt: true },
    });
    for (const s of sales) add(firstKey, 'commissions', Number(s.brokerCommissionAmt));
  }

  // ---- Project-scope filters (shapes differ per model's relation to Project) ----

  /** For models with a direct projectId (Sale, Commitment, CashFlowEntry). */
  private projectFilter(opts: BuildOpts) {
    if (opts.projectId) return { projectId: opts.projectId };
    if (opts.projectIds) return { projectId: { in: opts.projectIds } };
    return {};
  }

  /** For models anchored polymorphically to unit/building (Lease). */
  private assetProjectFilter(pf: any) {
    const idClause = pf.projectId;
    if (!idClause) return {};
    return {
      OR: [
        { unit: { building: { projectId: idClause } } },
        { building: { projectId: idClause } },
      ],
    };
  }

  /** Loan is projectId? or building.projectId. */
  private loanProjectFilter(pf: any) {
    const idClause = pf.projectId;
    if (!idClause) return {};
    return { OR: [{ projectId: idClause }, { building: { projectId: idClause } }] };
  }

  /** InteriorProject is anchored to unit/building/sale. */
  private interiorProjectFilter(pf: any) {
    const idClause = pf.projectId;
    if (!idClause) return {};
    return {
      OR: [
        { unit: { building: { projectId: idClause } } },
        { building: { projectId: idClause } },
        { sale: { projectId: idClause } },
      ],
    };
  }

  private monthKeys(start: Date, months: number): string[] {
    const keys: string[] = [];
    const d = new Date(start);
    for (let i = 0; i < months; i++) {
      keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return keys;
  }
}

// ---- helpers ----
type AddInflow = (key: string, src: InflowSource, amt: number) => void;
type AddOutflow = (key: string, cat: OutflowCategory, amt: number) => void;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthStartFromKey(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}
function sum(rec: Record<string, number>): number {
  return Object.values(rec).reduce((s, v) => s + v, 0);
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function roundMap(rec: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = round(v);
  return out;
}
