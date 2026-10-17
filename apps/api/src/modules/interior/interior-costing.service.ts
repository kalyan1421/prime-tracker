import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { computeBudget, codesOverBudget, fitOutBudget, leftOnCode, lineValue, type BudgetInput } from './interior-budget';

/**
 * Interiors costing (client, 2026-10-17) — the estimate, its lock, the job-costing budget,
 * change orders, purchase orders and bills, replacing BuilderTrend's screens for interiors.
 *
 * WHO may do each step is not hard-coded: OrgSettings holds a role list per step, which only
 * SUPER_ADMIN can change. The client's starting answer is "Founder and PM have every power",
 * so every list defaults to those two. SUPER_ADMIN always passes.
 */

export const PAYERS = ['PRIME', 'TENANT'] as const;
export const COST_TYPES = ['Subcontractor', 'Material', 'Labor', 'Equipment', 'Other'] as const;
export const CO_REASONS = ['Tenant request', 'Scope add', 'Cost increase', 'Plan change', 'Credit', 'Other'] as const;

export interface CostingActor {
  userId: string;
  role: string;
  roles?: string[];
  permissions: string[];
}

export interface InteriorSettings {
  lockRoles: string[];
  unlockRoles: string[];
  coLimit: number;
  coApproverRoles: string[];
  coAboveLimitRoles: string[];
  poApproverRoles: string[];
  varianceRoles: string[];
  billApproverRoles: string[];
}

const DEFAULT_ROLES = ['FOUNDER', 'PROJECT_MANAGER'];
export const DEFAULT_SETTINGS: InteriorSettings = {
  lockRoles: DEFAULT_ROLES, unlockRoles: DEFAULT_ROLES, coLimit: 60000,
  coApproverRoles: DEFAULT_ROLES, coAboveLimitRoles: DEFAULT_ROLES, poApproverRoles: DEFAULT_ROLES,
  varianceRoles: DEFAULT_ROLES, billApproverRoles: DEFAULT_ROLES,
};

const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v)) || 0;
const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** "Centro 805 Luxyn" -> "LUX". Letters of the last word, three of them. */
export function derivePoPrefix(name: string) {
  const word = (name.trim().split(/\s+/).pop() ?? '').replace(/[^a-z]/gi, '').toUpperCase();
  return (word.slice(0, 3) || 'FIT');
}

export function codeLabel(c?: { code: string | null; name: string } | null) {
  if (!c) return 'No cost code';
  return c.code ? `${c.code} - ${c.name}` : c.name;
}

@Injectable()
export class InteriorCostingService {
  constructor(private prisma: PrismaService) {}

  // ───────────────────────────── settings ─────────────────────────────

  async settings(): Promise<InteriorSettings> {
    const row = await this.prisma.orgSettings.findFirst();
    if (!row) return DEFAULT_SETTINGS;
    return {
      lockRoles: row.interiorLockRoles,
      unlockRoles: row.interiorUnlockRoles,
      coLimit: num(row.interiorCoLimit),
      coApproverRoles: row.interiorCoApproverRoles,
      coAboveLimitRoles: row.interiorCoAboveLimitRoles,
      poApproverRoles: row.interiorPoApproverRoles,
      varianceRoles: row.interiorVarianceRoles,
      billApproverRoles: row.interiorBillApproverRoles,
    };
  }

  /** SUPER_ADMIN only — enforced at the route (system:config). */
  async updateSettings(input: Partial<InteriorSettings>) {
    const roleLists: (keyof InteriorSettings)[] = [
      'lockRoles', 'unlockRoles', 'coApproverRoles', 'coAboveLimitRoles', 'poApproverRoles', 'varianceRoles', 'billApproverRoles',
    ];
    const data: Record<string, unknown> = {};
    const col = (k: string) => `interior${k[0].toUpperCase()}${k.slice(1)}`;
    for (const k of roleLists) {
      const v = input[k];
      if (v === undefined) continue;
      if (!Array.isArray(v) || v.some((r) => typeof r !== 'string')) throw new BadRequestException(`${k} must be a list of roles`);
      data[col(k)] = [...new Set(v as string[])];
    }
    if (input.coLimit !== undefined) {
      const n = Number(input.coLimit);
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException('The change order limit must be zero or more');
      data.interiorCoLimit = n;
    }
    const org = await this.prisma.organization.findFirst({ select: { id: true } });
    if (!org) throw new BadRequestException('No organization to attach settings to');
    await this.prisma.orgSettings.upsert({
      where: { orgId: org.id },
      create: { orgId: org.id, ...(data as any) },
      update: data as any,
    });
    return this.settings();
  }

  private hasRole(actor: CostingActor, allowed: string[]) {
    const mine = new Set([actor.role, ...(actor.roles ?? [])]);
    if (mine.has('SUPER_ADMIN')) return true;
    return allowed.some((r) => mine.has(r));
  }

  private requireRole(actor: CostingActor, allowed: string[], what: string) {
    if (!this.hasRole(actor, allowed)) {
      throw new ForbiddenException(`${what} needs one of: ${allowed.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ') || 'Super Admin'}.`);
    }
  }

  // ───────────────────────────── cost codes ─────────────────────────────

  listCostCodes(includeInactive = false) {
    return this.prisma.interiorCostCode.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCostCode(input: { code?: string | null; name: string; groupCode?: string | null; groupName: string; sortOrder?: number }) {
    const name = input.name?.trim(); const groupName = input.groupName?.trim();
    if (!name || !groupName) throw new BadRequestException('A cost code needs a name and a group');
    const clash = await this.prisma.interiorCostCode.findFirst({ where: { groupName, name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw new ConflictException(`"${name}" already exists under ${groupName}`);
    const last = await this.prisma.interiorCostCode.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    return this.prisma.interiorCostCode.create({
      data: {
        code: input.code?.trim() || null, name, groupCode: input.groupCode?.trim() || null, groupName,
        sortOrder: input.sortOrder ?? (last?.sortOrder ?? 0) + 10,
      },
    });
  }

  async updateCostCode(id: string, input: { code?: string | null; name?: string; groupCode?: string | null; groupName?: string; sortOrder?: number; active?: boolean }) {
    const c = await this.prisma.interiorCostCode.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Cost code not found');
    return this.prisma.interiorCostCode.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code?.trim() || null } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() || c.name } : {}),
        ...(input.groupCode !== undefined ? { groupCode: input.groupCode?.trim() || null } : {}),
        ...(input.groupName !== undefined ? { groupName: input.groupName.trim() || c.groupName } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
  }

  // ───────────────────────────── loading ─────────────────────────────

  private async load(id: string) {
    const p = await this.prisma.interiorProject.findFirst({
      where: { id, deletedAt: null },
      include: {
        unit: { select: { id: true, unitNumber: true, sqft: true, buildingId: true, building: { select: { id: true, name: true, projectId: true } } } },
        building: { select: { id: true, name: true, projectId: true } },
        lease: { select: { id: true, tenantName: true, tiAllowance: true } },
        extraUnits: { include: { unit: { select: { id: true, unitNumber: true, sqft: true } } } },
        estimateSubmittedBy: { select: { id: true, name: true } },
        estimateLockedBy: { select: { id: true, name: true } },
        scopeItems: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { costCode: true } },
        budgetSnapshot: true,
        changeOrders: {
          orderBy: { number: 'asc' },
          include: {
            costCode: true,
            requestedBy: { select: { id: true, name: true } },
            decidedBy: { select: { id: true, name: true } },
          },
        },
        purchaseOrders: {
          orderBy: { number: 'desc' },
          include: {
            vendor: { select: { id: true, name: true } },
            lines: { orderBy: { sortOrder: 'asc' }, include: { costCode: true } },
            createdBy: { select: { id: true, name: true } },
            approvedBy: { select: { id: true, name: true } },
          },
        },
        invoices: { orderBy: { createdAt: 'desc' }, include: { vendor: { select: { id: true, name: true } } } },
        activity: { orderBy: { createdAt: 'desc' }, take: 200, include: { actor: { select: { id: true, name: true } } } },
      },
    });
    if (!p) throw new NotFoundException('Interior project not found');
    return p;
  }

  private budgetInput(p: Awaited<ReturnType<InteriorCostingService['load']>>): BudgetInput {
    return {
      locked: p.estimateStatus === 'LOCKED',
      snapshot: p.budgetSnapshot.map((s) => ({ costCodeId: s.costCodeId, paidBy: s.paidBy, amount: s.amount })),
      lines: p.scopeItems.map((l) => ({ costCodeId: l.costCodeId, paidBy: l.paidBy, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total })),
      changeOrders: p.changeOrders.map((c) => ({ costCodeId: c.costCodeId, paidBy: c.paidBy, amount: c.amount, status: c.status })),
      purchaseOrders: p.purchaseOrders.map((po) => ({
        id: po.id, status: po.status,
        lines: po.lines.map((l) => ({ costCodeId: l.costCodeId, paidBy: l.paidBy, amount: l.amount })),
      })),
      bills: p.invoices.map((b) => ({ purchaseOrderId: b.purchaseOrderId, amount: b.amount, status: b.status })),
    };
  }

  private async log(tx: Prisma.TransactionClient | PrismaService, interiorProjectId: string, actorId: string | null, text: string) {
    await tx.interiorActivity.create({ data: { interiorProjectId, actorId, text } });
  }

  private poNumber(p: { poPrefix: string | null; name: string }, n: number) {
    return `${p.poPrefix || derivePoPrefix(p.name)}-${pad(n, 4)}`;
  }

  /**
   * Everything the fit-out's money screens need, in one call: estimate, budget, change
   * orders, purchase orders, bills, activity, the TI split — and what THIS caller may do.
   *
   * A viewer without interior:finance (CONSTRUCTION) gets the work side only: each PO's
   * number, title, supplier and work status, and no amounts anywhere.
   */
  async costing(id: string, actor: CostingActor) {
    const p = await this.load(id);
    const settings = await this.settings();
    const finance = actor.permissions.includes('interior:finance');
    const codes = await this.listCostCodes(true);
    const units = [
      ...(p.unit ? [{ id: p.unit.id, unitNumber: p.unit.unitNumber, sqft: p.unit.sqft }] : []),
      ...p.extraUnits.map((x) => ({ id: x.unit.id, unitNumber: x.unit.unitNumber, sqft: x.unit.sqft })),
    ];
    const prefix = p.poPrefix || derivePoPrefix(p.name);
    const purchaseOrdersWork = p.purchaseOrders.map((po) => ({
      id: po.id, number: this.poNumber(p, po.number), title: po.title, vendor: po.vendor, status: po.status,
      workCompletedAt: po.workCompletedAt, scheduledCompletion: po.scheduledCompletion, materialsOnly: po.materialsOnly,
    }));

    const can = {
      seeMoney: finance,
      editEstimate: actor.permissions.includes('interior:edit') && p.estimateStatus !== 'LOCKED',
      submitEstimate: actor.permissions.includes('interior:edit') && p.estimateStatus === 'DRAFT',
      // edit OR finance at the route — the role list is the real gate, and Super Admin may
      // hand these powers to a finance role.
      lockEstimate: (actor.permissions.includes('interior:edit') || finance) && p.estimateStatus !== 'LOCKED' && this.hasRole(actor, settings.lockRoles),
      unlockEstimate: (actor.permissions.includes('interior:edit') || finance) && p.estimateStatus === 'LOCKED' && this.hasRole(actor, settings.unlockRoles),
      raiseChangeOrder: actor.permissions.includes('interior:edit') && p.estimateStatus === 'LOCKED',
      approveChangeOrderUpToLimit: this.hasRole(actor, settings.coApproverRoles),
      approveChangeOrderAboveLimit: this.hasRole(actor, settings.coAboveLimitRoles),
      createPurchaseOrder: finance && p.estimateStatus === 'LOCKED',
      approvePurchaseOrder: finance && this.hasRole(actor, settings.poApproverRoles),
      approveVariance: finance && this.hasRole(actor, settings.varianceRoles),
      addBill: finance,
      approveBill: finance && this.hasRole(actor, settings.billApproverRoles),
      payBill: finance,
      markWorkComplete: actor.permissions.includes('interior:view'),
    };

    const base = {
      id: p.id, name: p.name, area: num(p.area), units, poPrefix: prefix, priority: p.priority,
      estimateStatus: p.estimateStatus, settings: { coLimit: settings.coLimit }, can,
    };
    if (!finance) return { ...base, purchaseOrders: purchaseOrdersWork, activity: [] as unknown[] };

    const input = this.budgetInput(p);
    const budget = computeBudget(input);
    const codeById = new Map(codes.map((c) => [c.id, c]));
    const tiAllowance = p.tiAllowance !== null ? num(p.tiAllowance) : p.lease?.tiAllowance != null ? num(p.lease.tiAllowance) : null;

    return {
      ...base,
      estimate: {
        status: p.estimateStatus,
        submittedAt: p.estimateSubmittedAt, submittedBy: p.estimateSubmittedBy,
        lockedAt: p.estimateLockedAt, lockedBy: p.estimateLockedBy,
        total: p.scopeItems.reduce((t, l) => t + lineValue(l), 0),
        lines: p.scopeItems.map((l) => ({
          id: l.id, costCodeId: l.costCodeId, costCode: l.costCode ? { id: l.costCode.id, code: l.costCode.code, name: l.costCode.name } : null,
          description: l.description, quantity: l.quantity === null ? null : num(l.quantity), unit: l.unit,
          unitPrice: l.unitPrice === null ? null : num(l.unitPrice), total: lineValue(l),
          costType: l.costType, supplier: l.supplier, paidBy: l.paidBy,
        })),
      },
      budget: {
        rows: budget.rows.map((r) => {
          const c = r.costCodeId ? codeById.get(r.costCodeId) : null;
          return {
            ...r, label: codeLabel(c), code: c?.code ?? null, name: c?.name ?? 'No cost code',
            groupName: c?.groupName ?? 'Other', groupCode: c?.groupCode ?? null, sortOrder: c?.sortOrder ?? 9999,
          };
        }).sort((a, b) => a.sortOrder - b.sortOrder),
        totals: budget.totals,
      },
      ti: {
        allowance: tiAllowance,
        allowanceSource: p.tiAllowance !== null ? 'FIT_OUT' : p.lease?.tiAllowance != null ? 'LEASE' : null,
        primePays: budget.totals.revisedPrime,
        tenantPays: budget.totals.revisedTenant,
        // Positive = Prime's share is over the allowance by that much.
        overAllowance: tiAllowance === null ? null : Math.round((budget.totals.revisedPrime - tiAllowance) * 100) / 100,
      },
      changeOrders: p.changeOrders.map((c) => ({
        id: c.id, number: `CO-${pad(c.number, 3)}`, costCodeId: c.costCodeId, costCode: c.costCode ? codeLabel(c.costCode) : 'No cost code',
        amount: num(c.amount), reason: c.reason, note: c.note, paidBy: c.paidBy, status: c.status,
        requestedBy: c.requestedBy, createdAt: c.createdAt, decidedBy: c.decidedBy, decidedAt: c.decidedAt,
        needsAboveLimit: Math.abs(num(c.amount)) > settings.coLimit,
      })),
      purchaseOrders: p.purchaseOrders.map((po) => {
        const bills = p.invoices.filter((b) => b.purchaseOrderId === po.id);
        const cost = po.lines.reduce((t, l) => t + num(l.amount), 0);
        return {
          id: po.id, number: this.poNumber(p, po.number), title: po.title, vendor: po.vendor, scope: po.scope,
          scheduledCompletion: po.scheduledCompletion, materialsOnly: po.materialsOnly, status: po.status,
          variance: po.variance, workCompletedAt: po.workCompletedAt, createdBy: po.createdBy, approvedBy: po.approvedBy,
          approvedAt: po.approvedAt, createdAt: po.createdAt,
          lines: po.lines.map((l) => ({
            id: l.id, costCodeId: l.costCodeId, costCode: l.costCode ? codeLabel(l.costCode) : 'No cost code',
            description: l.description, amount: num(l.amount), paidBy: l.paidBy,
          })),
          cost,
          billed: bills.reduce((t, b) => t + num(b.amount), 0),
          paid: bills.filter((b) => b.status === 'PAID').reduce((t, b) => t + num(b.amount), 0),
        };
      }),
      bills: p.invoices.map((b) => {
        const po = b.purchaseOrderId ? p.purchaseOrders.find((x) => x.id === b.purchaseOrderId) : null;
        return {
          id: b.id, invoiceNo: b.invoiceNo, invoiceDate: b.invoiceDate, amount: num(b.amount), status: b.status,
          paidAt: b.paidAt, vendor: b.vendor, purchaseOrderId: b.purchaseOrderId,
          purchaseOrderNumber: po ? this.poNumber(p, po.number) : null,
        };
      }),
      activity: p.activity.map((a) => ({ id: a.id, text: a.text, createdAt: a.createdAt, actor: a.actor })),
      leftByCode: Object.fromEntries(
        budget.rows.map((r) => [r.costCodeId ?? '', leftOnCode(input, r.costCodeId)]),
      ),
    };
  }

  /**
   * Totals per fit-out for the portfolio board, the project tab and the unit card — plus
   * `budget` / `budgetBasis` from fitOutBudget(), the one number those screens show.
   * Money only for interior:finance (the callers gate it).
   */
  async portfolioTotals(ids: string[]) {
    if (!ids.length) return new Map<string, any>();
    const projects = await this.prisma.interiorProject.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, estimateStatus: true, status: true,
        contractType: true, ratePerSqft: true, area: true, contractValue: true,
        scopeItems: { select: { costCodeId: true, paidBy: true, quantity: true, unitPrice: true, total: true } },
        budgetSnapshot: { select: { costCodeId: true, paidBy: true, amount: true } },
        changeOrders: { select: { costCodeId: true, paidBy: true, amount: true, status: true } },
        purchaseOrders: { select: { id: true, status: true, lines: { select: { costCodeId: true, paidBy: true, amount: true } } } },
        invoices: { select: { purchaseOrderId: true, amount: true, status: true } },
      },
    });
    const out = new Map<string, any>();
    for (const p of projects) {
      const { totals } = computeBudget({
        locked: p.estimateStatus === 'LOCKED', snapshot: p.budgetSnapshot, lines: p.scopeItems,
        changeOrders: p.changeOrders, purchaseOrders: p.purchaseOrders, bills: p.invoices.map((b) => ({ ...b })),
      });
      const fb = fitOutBudget({
        status: p.status, estimateStatus: p.estimateStatus, revised: totals.revised,
        estimateTotal: p.scopeItems.reduce((t, l) => t + lineValue(l), 0),
        contractType: p.contractType, ratePerSqft: p.ratePerSqft, area: p.area, contractValue: p.contractValue,
      });
      out.set(p.id, { ...totals, estimateStatus: p.estimateStatus, budget: fb.amount, budgetBasis: fb.basis });
    }
    return out;
  }

  // ───────────────────────────── estimate ─────────────────────────────

  private async assertEditable(id: string) {
    const p = await this.prisma.interiorProject.findFirst({ where: { id, deletedAt: null }, select: { estimateStatus: true } });
    if (!p) throw new NotFoundException('Interior project not found');
    if (p.estimateStatus === 'LOCKED') {
      throw new ConflictException('The estimate is locked. Raise a change order, or unlock the estimate first.');
    }
  }

  private async assertCode(costCodeId?: string | null) {
    if (!costCodeId) return;
    const c = await this.prisma.interiorCostCode.findUnique({ where: { id: costCodeId }, select: { id: true } });
    if (!c) throw new BadRequestException('Unknown cost code');
  }

  private assertPayer(paidBy?: string) {
    if (paidBy !== undefined && !(PAYERS as readonly string[]).includes(paidBy)) throw new BadRequestException('paidBy must be PRIME or TENANT');
  }

  async addLine(id: string, input: {
    costCodeId?: string | null; description: string; quantity?: number | null; unit?: string | null; unitPrice?: number | null;
    costType?: string | null; supplier?: string | null; paidBy?: string;
  }) {
    await this.assertEditable(id);
    await this.assertCode(input.costCodeId);
    this.assertPayer(input.paidBy);
    if (!input.description?.trim()) throw new BadRequestException('Describe the line');
    const last = await this.prisma.interiorScopeItem.findFirst({ where: { interiorProjectId: id }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const qty = input.quantity ?? 1; const price = input.unitPrice ?? 0;
    return this.prisma.interiorScopeItem.create({
      data: {
        interiorProjectId: id, costCodeId: input.costCodeId || null, description: input.description.trim(),
        quantity: qty, unit: input.unit ?? 'ls', unitPrice: price, total: qty * price,
        costType: input.costType ?? null, supplier: input.supplier?.trim() || null, paidBy: input.paidBy ?? 'PRIME',
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
  }

  async updateLine(id: string, lineId: string, input: {
    costCodeId?: string | null; description?: string; quantity?: number | null; unit?: string | null; unitPrice?: number | null;
    costType?: string | null; supplier?: string | null; paidBy?: string;
  }) {
    await this.assertEditable(id);
    const line = await this.prisma.interiorScopeItem.findUnique({ where: { id: lineId } });
    if (!line || line.interiorProjectId !== id) throw new NotFoundException('Estimate line not found');
    if (input.costCodeId !== undefined) await this.assertCode(input.costCodeId);
    this.assertPayer(input.paidBy);
    const quantity = input.quantity !== undefined ? input.quantity : (line.quantity === null ? null : num(line.quantity));
    const unitPrice = input.unitPrice !== undefined ? input.unitPrice : (line.unitPrice === null ? null : num(line.unitPrice));
    return this.prisma.interiorScopeItem.update({
      where: { id: lineId },
      data: {
        ...(input.costCodeId !== undefined ? { costCodeId: input.costCodeId || null } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || line.description } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.costType !== undefined ? { costType: input.costType } : {}),
        ...(input.supplier !== undefined ? { supplier: input.supplier?.trim() || null } : {}),
        ...(input.paidBy !== undefined ? { paidBy: input.paidBy } : {}),
        quantity, unitPrice,
        total: quantity !== null && unitPrice !== null ? quantity * unitPrice : null,
      },
    });
  }

  async removeLine(id: string, lineId: string) {
    await this.assertEditable(id);
    const line = await this.prisma.interiorScopeItem.findUnique({ where: { id: lineId } });
    if (!line || line.interiorProjectId !== id) throw new NotFoundException('Estimate line not found');
    return this.prisma.interiorScopeItem.delete({ where: { id: lineId } });
  }

  async submitEstimate(id: string, actor: CostingActor) {
    const p = await this.load(id);
    if (p.estimateStatus !== 'DRAFT') throw new ConflictException('Only a draft estimate can be sent for approval');
    if (!p.scopeItems.length) throw new BadRequestException('Add at least one line first');
    const total = p.scopeItems.reduce((t, l) => t + lineValue(l), 0);
    await this.prisma.$transaction(async (tx) => {
      await tx.interiorProject.update({ where: { id }, data: { estimateStatus: 'SUBMITTED', estimateSubmittedAt: new Date(), estimateSubmittedById: actor.userId } });
      await this.log(tx, id, actor.userId, `Sent the estimate for approval (${money(total)}).`);
    });
    return { status: 'SUBMITTED' };
  }

  async sendBackEstimate(id: string, actor: CostingActor) {
    const settings = await this.settings();
    this.requireRole(actor, settings.lockRoles, 'Sending an estimate back');
    const p = await this.prisma.interiorProject.findFirst({ where: { id, deletedAt: null }, select: { estimateStatus: true } });
    if (!p) throw new NotFoundException('Interior project not found');
    if (p.estimateStatus !== 'SUBMITTED') throw new ConflictException('Only an estimate waiting for approval can be sent back');
    await this.prisma.$transaction(async (tx) => {
      await tx.interiorProject.update({ where: { id }, data: { estimateStatus: 'DRAFT' } });
      await this.log(tx, id, actor.userId, 'Sent the estimate back to draft.');
    });
    return { status: 'DRAFT' };
  }

  /** Approve and lock: the estimate becomes the ORIGINAL budget, snapshotted per code and payer. */
  async lockEstimate(id: string, actor: CostingActor) {
    const settings = await this.settings();
    this.requireRole(actor, settings.lockRoles, 'Locking the estimate');
    const p = await this.load(id);
    if (p.estimateStatus === 'LOCKED') throw new ConflictException('The estimate is already locked');
    if (!p.scopeItems.length) throw new BadRequestException('There is nothing to lock — add estimate lines first');
    const groups = new Map<string, { costCodeId: string | null; paidBy: string; amount: number }>();
    for (const l of p.scopeItems) {
      const k = `${l.costCodeId ?? ''}|${l.paidBy}`;
      const g = groups.get(k) ?? { costCodeId: l.costCodeId, paidBy: l.paidBy, amount: 0 };
      g.amount += lineValue(l);
      groups.set(k, g);
    }
    const total = p.scopeItems.reduce((t, l) => t + lineValue(l), 0);
    await this.prisma.$transaction(async (tx) => {
      await tx.interiorBudgetSnapshot.deleteMany({ where: { interiorProjectId: id } });
      await tx.interiorBudgetSnapshot.createMany({ data: [...groups.values()].map((g) => ({ interiorProjectId: id, ...g })) });
      await tx.interiorProject.update({
        where: { id },
        data: {
          estimateStatus: 'LOCKED', estimateLockedAt: new Date(), estimateLockedById: actor.userId,
          poPrefix: p.poPrefix || derivePoPrefix(p.name),
        },
      });
      await this.log(tx, id, actor.userId, `Approved and locked the estimate at ${money(total)}.`);
    });
    return { status: 'LOCKED' };
  }

  async unlockEstimate(id: string, reason: string, actor: CostingActor) {
    const settings = await this.settings();
    this.requireRole(actor, settings.unlockRoles, 'Unlocking the estimate');
    if (!reason?.trim()) throw new BadRequestException('Say why the estimate is being unlocked');
    const p = await this.prisma.interiorProject.findFirst({ where: { id, deletedAt: null }, select: { estimateStatus: true } });
    if (!p) throw new NotFoundException('Interior project not found');
    if (p.estimateStatus !== 'LOCKED') throw new ConflictException('The estimate is not locked');
    await this.prisma.$transaction(async (tx) => {
      await tx.interiorBudgetSnapshot.deleteMany({ where: { interiorProjectId: id } });
      await tx.interiorProject.update({ where: { id }, data: { estimateStatus: 'DRAFT', estimateLockedAt: null, estimateLockedById: null } });
      await this.log(tx, id, actor.userId, `Unlocked the estimate: "${reason.trim()}"`);
    });
    return { status: 'DRAFT' };
  }

  // ───────────────────────────── change orders ─────────────────────────────

  async createChangeOrder(id: string, input: { costCodeId?: string | null; amount: number; reason: string; note: string; paidBy?: string }, actor: CostingActor) {
    const p = await this.prisma.interiorProject.findFirst({ where: { id, deletedAt: null }, select: { estimateStatus: true } });
    if (!p) throw new NotFoundException('Interior project not found');
    if (p.estimateStatus !== 'LOCKED') throw new ConflictException('Change orders start once the estimate is locked — until then, edit the estimate');
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount === 0) throw new BadRequestException('Enter the change order amount');
    if (!input.note?.trim()) throw new BadRequestException('Say what changed');
    if (!(CO_REASONS as readonly string[]).includes(input.reason)) throw new BadRequestException('Unknown reason');
    await this.assertCode(input.costCodeId);
    this.assertPayer(input.paidBy);
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.interiorChangeOrder.findFirst({ where: { interiorProjectId: id }, orderBy: { number: 'desc' }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;
      const co = await tx.interiorChangeOrder.create({
        data: {
          interiorProjectId: id, number, costCodeId: input.costCodeId || null, amount, reason: input.reason,
          note: input.note.trim(), paidBy: input.paidBy ?? (input.reason === 'Tenant request' ? 'TENANT' : 'PRIME'),
          requestedById: actor.userId,
        },
      });
      await this.log(tx, id, actor.userId, `Raised CO-${pad(number, 3)} for ${money(amount)}.`);
      return co;
    });
  }

  async decideChangeOrder(id: string, coId: string, decision: 'APPROVE' | 'REJECT', actor: CostingActor) {
    const co = await this.prisma.interiorChangeOrder.findUnique({ where: { id: coId } });
    if (!co || co.interiorProjectId !== id) throw new NotFoundException('Change order not found');
    if (co.status !== 'PENDING') throw new ConflictException('This change order has already been decided');
    const settings = await this.settings();
    const above = Math.abs(num(co.amount)) > settings.coLimit;
    this.requireRole(actor, above ? settings.coAboveLimitRoles : settings.coApproverRoles,
      above ? `A change order over ${money(settings.coLimit)}` : 'Deciding a change order');
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.prisma.$transaction(async (tx) => {
      await tx.interiorChangeOrder.update({ where: { id: coId }, data: { status, decidedById: actor.userId, decidedAt: new Date() } });
      await this.log(tx, id, actor.userId, `${status === 'APPROVED' ? 'Approved' : 'Rejected'} CO-${pad(co.number, 3)} (${money(num(co.amount))}).`);
    });
    return { status };
  }

  // ───────────────────────────── purchase orders ─────────────────────────────

  private async resolveVendor(tx: Prisma.TransactionClient, vendorId?: string, vendorName?: string) {
    if (vendorId) {
      const v = await tx.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
      if (!v) throw new BadRequestException('Unknown supplier');
      return v.id;
    }
    const name = vendorName?.trim();
    if (!name) throw new BadRequestException('Name the supplier or sub-contractor');
    const existing = await tx.vendor.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (existing) return existing.id;
    return (await tx.vendor.create({ data: { name } })).id;
  }

  async createPurchaseOrder(id: string, input: {
    title: string; vendorId?: string; vendorName?: string; scope?: string; scheduledCompletion?: string | null;
    materialsOnly?: boolean; variance?: boolean; status?: 'DRAFT' | 'PENDING';
    lines: { costCodeId?: string | null; description?: string; amount: number; paidBy?: string }[];
  }, actor: CostingActor) {
    const p = await this.load(id);
    if (p.estimateStatus !== 'LOCKED') throw new ConflictException('Purchase orders start once the estimate is locked — every PO is checked against the budget');
    if (!input.title?.trim()) throw new BadRequestException('Give the purchase order a title');
    if (!input.lines?.length) throw new BadRequestException('Add at least one cost line');
    for (const l of input.lines) {
      if (!(Number(l.amount) > 0)) throw new BadRequestException('Every cost line needs an amount above zero');
      await this.assertCode(l.costCodeId);
      this.assertPayer(l.paidBy);
    }
    const status = input.status === 'PENDING' ? 'PENDING' : 'DRAFT';
    const over = codesOverBudget(this.budgetInput(p), input.lines.map((l) => ({ costCodeId: l.costCodeId || null, amount: l.amount })));
    if (status === 'PENDING' && over.length && !input.variance) {
      throw new ConflictException(`Over budget on ${await this.labels(over)}. Add a change order first, or mark it as a variance PO.`);
    }
    return this.prisma.$transaction(async (tx) => {
      const vendorId = await this.resolveVendor(tx, input.vendorId, input.vendorName);
      const last = await tx.interiorPurchaseOrder.findFirst({ where: { interiorProjectId: id }, orderBy: { number: 'desc' }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;
      if (!p.poPrefix) await tx.interiorProject.update({ where: { id }, data: { poPrefix: derivePoPrefix(p.name) } });
      const po = await tx.interiorPurchaseOrder.create({
        data: {
          interiorProjectId: id, number, title: input.title.trim(), vendorId, scope: input.scope?.trim() || null,
          scheduledCompletion: input.scheduledCompletion ? new Date(input.scheduledCompletion) : null,
          materialsOnly: !!input.materialsOnly, variance: !!input.variance, status, createdById: actor.userId,
          lines: {
            create: input.lines.map((l, i) => ({
              costCodeId: l.costCodeId || null, description: l.description?.trim() || null, amount: Number(l.amount),
              paidBy: l.paidBy ?? 'PRIME', sortOrder: i,
            })),
          },
        },
      });
      const total = input.lines.reduce((t, l) => t + Number(l.amount), 0);
      await this.log(tx, id, actor.userId,
        `${status === 'DRAFT' ? 'Saved draft' : 'Sent for approval'} ${this.poNumber(p, number)} ${input.title.trim()} (${money(total)}).`);
      return po;
    });
  }

  private async labels(codeIds: (string | null)[]) {
    const codes = await this.prisma.interiorCostCode.findMany({ where: { id: { in: codeIds.filter(Boolean) as string[] } } });
    return codeIds.map((id) => codeLabel(codes.find((c) => c.id === id))).join(', ');
  }

  private async po(id: string, poId: string) {
    const po = await this.prisma.interiorPurchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
    if (!po || po.interiorProjectId !== id) throw new NotFoundException('Purchase order not found');
    return po;
  }

  async sendPurchaseOrder(id: string, poId: string, actor: CostingActor) {
    const po = await this.po(id, poId);
    if (po.status !== 'DRAFT') throw new ConflictException('Only a draft can be sent for approval');
    const p = await this.load(id);
    const over = codesOverBudget(this.budgetInput(p), po.lines, po.id);
    if (over.length && !po.variance) throw new ConflictException(`Over budget on ${await this.labels(over)}. Add a change order first, or void it and raise a variance PO.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.interiorPurchaseOrder.update({ where: { id: poId }, data: { status: 'PENDING' } });
      await this.log(tx, id, actor.userId, `Sent ${this.poNumber(p, po.number)} for approval.`);
    });
    return { status: 'PENDING' };
  }

  async approvePurchaseOrder(id: string, poId: string, actor: CostingActor) {
    const settings = await this.settings();
    this.requireRole(actor, settings.poApproverRoles, 'Approving a purchase order');
    const po = await this.po(id, poId);
    if (po.status !== 'PENDING' && po.status !== 'DRAFT') throw new ConflictException('This purchase order is not waiting for approval');
    const p = await this.load(id);
    const over = codesOverBudget(this.budgetInput(p), po.lines, po.id);
    if (over.length) {
      if (!po.variance) throw new ConflictException(`Over budget on ${await this.labels(over)}. Approve a change order first, or void it and raise a variance PO.`);
      this.requireRole(actor, settings.varianceRoles, 'Approving a variance PO');
    }
    const total = po.lines.reduce((t, l) => t + num(l.amount), 0);
    await this.prisma.$transaction(async (tx) => {
      await tx.interiorPurchaseOrder.update({ where: { id: poId }, data: { status: 'APPROVED', approvedById: actor.userId, approvedAt: new Date() } });
      await this.log(tx, id, actor.userId, `Approved ${this.poNumber(p, po.number)} (${money(total)})${po.variance ? ' as a variance PO' : ''}.`);
    });
    return { status: 'APPROVED' };
  }

  async voidPurchaseOrder(id: string, poId: string, actor: CostingActor) {
    const po = await this.po(id, poId);
    if (po.status === 'VOID') return { status: 'VOID' };
    const bills = await this.prisma.interiorInvoice.count({ where: { purchaseOrderId: poId } });
    if (bills) throw new ConflictException('This purchase order has bills against it. Void the bills first.');
    const p = await this.prisma.interiorProject.findUniqueOrThrow({ where: { id }, select: { poPrefix: true, name: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.interiorPurchaseOrder.update({ where: { id: poId }, data: { status: 'VOID' } });
      await this.log(tx, id, actor.userId, `Voided ${this.poNumber(p, po.number)}.`);
    });
    return { status: 'VOID' };
  }

  async completePurchaseOrder(id: string, poId: string, complete: boolean, actor: CostingActor) {
    const po = await this.po(id, poId);
    if (po.status !== 'APPROVED') throw new ConflictException('Only an approved purchase order can be marked complete');
    const p = await this.prisma.interiorProject.findUniqueOrThrow({ where: { id }, select: { poPrefix: true, name: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.interiorPurchaseOrder.update({ where: { id: poId }, data: { workCompletedAt: complete ? new Date() : null } });
      await this.log(tx, id, actor.userId, `${complete ? 'Marked' : 'Reopened'} ${this.poNumber(p, po.number)} work ${complete ? 'complete' : ''}`.trim() + '.');
    });
    return { workComplete: complete };
  }

  // ───────────────────────────── bills ─────────────────────────────

  /**
   * Checks a bill against its purchase order before InteriorService records it: the PO must
   * be approved and on this fit-out, and the bill cannot exceed what has not been billed on
   * it yet — the extra is a change order and a new PO, not a bigger bill.
   */
  async checkBill(id: string, purchaseOrderId: string, amount: number) {
    const po = await this.prisma.interiorPurchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { lines: { select: { amount: true } }, invoices: { select: { amount: true } } },
    });
    if (!po || po.interiorProjectId !== id) throw new NotFoundException('Purchase order not found');
    if (po.status !== 'APPROVED') throw new ConflictException('Bills go against an approved purchase order');
    const cost = po.lines.reduce((t, l) => t + num(l.amount), 0);
    const billed = po.invoices.reduce((t, b) => t + num(b.amount), 0);
    if (amount > cost - billed + 0.005) {
      throw new ConflictException(`More than is left on this purchase order (${money(Math.round((cost - billed) * 100) / 100)} not yet billed). The extra needs a change order and a new PO.`);
    }
    return { vendorId: po.vendorId };
  }

  async assertBillApprover(actor: CostingActor) {
    const settings = await this.settings();
    this.requireRole(actor, settings.billApproverRoles, 'Approving a bill');
  }

  logActivity(id: string, actorId: string | null, text: string) {
    return this.log(this.prisma, id, actorId, text);
  }
}
