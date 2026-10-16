/**
 * The interiors job-costing maths (client, 2026-10-17 — replaces BuilderTrend's job costing
 * budget). Pure, so the numbers can be checked against BuilderTrend line by line.
 *
 *   Original    the estimate as it stood when it was LOCKED (the snapshot). Before the lock,
 *               the live estimate, labelled as not locked.
 *   Change ord. approved change orders (pending ones are shown beside, never added).
 *   Revised     original + approved change orders.
 *   Pending     purchase orders waiting for approval (DRAFT or PENDING).
 *   Committed   approved purchase orders.
 *   Actual      approved + paid bills, spread over their PO's cost lines by share.
 *   Projected   the larger of revised, committed and actual — what BuilderTrend shows on
 *               every line of the 2026-10-13 screen (Electrical 45,000 / HVAC 102,360).
 *   To complete projected − actual.
 *   Over/under  revised − projected; negative is over budget.
 *
 * Every money figure on the budget is also split into what PRIME pays and what the TENANT
 * pays, from the `paidBy` on each estimate line, change order and PO line.
 */

export type Payer = 'PRIME' | 'TENANT';
const toNum = (v: unknown) => (v === null || v === undefined ? 0 : Number(v)) || 0;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface BudgetInput {
  locked: boolean;
  snapshot: { costCodeId: string | null; paidBy: string; amount: unknown }[];
  lines: { costCodeId: string | null; paidBy: string; quantity?: unknown; unitPrice?: unknown; total?: unknown }[];
  changeOrders: { costCodeId: string | null; paidBy: string; amount: unknown; status: string }[];
  purchaseOrders: {
    id: string; status: string;
    lines: { costCodeId: string | null; paidBy: string; amount: unknown }[];
  }[];
  bills: { purchaseOrderId: string | null; amount: unknown; status: string }[];
}

export interface BudgetRow {
  costCodeId: string | null;
  original: number; originalPrime: number; originalTenant: number;
  coApproved: number; coPending: number;
  revised: number; revisedPrime: number; revisedTenant: number;
  pending: number; committed: number; actual: number; paid: number;
  projected: number; toComplete: number; overUnder: number;
}

export type BudgetTotals = Omit<BudgetRow, 'costCodeId'>;

/** An estimate line's value: its total, or quantity × unit price. */
export function lineValue(l: { quantity?: unknown; unitPrice?: unknown; total?: unknown }) {
  if (l.total !== null && l.total !== undefined) return toNum(l.total);
  return toNum(l.quantity) * toNum(l.unitPrice);
}

const KEY_NONE = '__none__';

export function computeBudget(input: BudgetInput): { rows: BudgetRow[]; totals: BudgetTotals } {
  const rows = new Map<string, BudgetRow>();
  const get = (codeId: string | null) => {
    const k = codeId ?? KEY_NONE;
    let r = rows.get(k);
    if (!r) {
      r = {
        costCodeId: codeId, original: 0, originalPrime: 0, originalTenant: 0, coApproved: 0, coPending: 0,
        revised: 0, revisedPrime: 0, revisedTenant: 0, pending: 0, committed: 0, actual: 0, paid: 0,
        projected: 0, toComplete: 0, overUnder: 0,
      };
      rows.set(k, r);
    }
    return r;
  };
  const addOriginal = (codeId: string | null, payer: string, amount: number) => {
    const r = get(codeId);
    r.original += amount;
    if (payer === 'TENANT') r.originalTenant += amount; else r.originalPrime += amount;
  };

  if (input.locked) for (const s of input.snapshot) addOriginal(s.costCodeId, s.paidBy, toNum(s.amount));
  else for (const l of input.lines) addOriginal(l.costCodeId, l.paidBy, lineValue(l));

  // Change orders: approved ones move the revised budget, on the payer they name.
  const coPrime = new Map<string, number>();
  const coTenant = new Map<string, number>();
  for (const co of input.changeOrders) {
    const r = get(co.costCodeId);
    const amt = toNum(co.amount);
    if (co.status === 'APPROVED') {
      r.coApproved += amt;
      const m = co.paidBy === 'TENANT' ? coTenant : coPrime;
      const k = co.costCodeId ?? KEY_NONE;
      m.set(k, (m.get(k) ?? 0) + amt);
    } else if (co.status === 'PENDING') {
      r.coPending += amt;
    }
  }

  const poById = new Map(input.purchaseOrders.map((p) => [p.id, p]));
  for (const p of input.purchaseOrders) {
    if (p.status === 'VOID') continue;
    for (const ln of p.lines) {
      const r = get(ln.costCodeId);
      if (p.status === 'APPROVED') r.committed += toNum(ln.amount);
      else r.pending += toNum(ln.amount);
    }
  }

  // A bill is spread over its PO's lines in proportion to each line's amount. A bill with
  // no PO (logged before POs existed) lands on the "no cost code" row rather than vanishing.
  for (const b of input.bills) {
    if (b.status !== 'APPROVED' && b.status !== 'PAID') continue;
    const amount = toNum(b.amount);
    const p = b.purchaseOrderId ? poById.get(b.purchaseOrderId) : undefined;
    const lines = p && p.status !== 'VOID' ? p.lines : [];
    const total = lines.reduce((t, l) => t + toNum(l.amount), 0);
    if (!lines.length || !total) {
      const r = get(null);
      r.actual += amount;
      if (b.status === 'PAID') r.paid += amount;
      continue;
    }
    for (const l of lines) {
      const share = toNum(l.amount) / total;
      const r = get(l.costCodeId);
      r.actual += amount * share;
      if (b.status === 'PAID') r.paid += amount * share;
    }
  }

  const list: BudgetRow[] = [];
  for (const [k, r] of rows) {
    r.revised = r.original + r.coApproved;
    r.revisedPrime = r.originalPrime + (coPrime.get(k) ?? 0);
    r.revisedTenant = r.originalTenant + (coTenant.get(k) ?? 0);
    r.projected = Math.max(r.revised, r.committed, r.actual);
    r.toComplete = r.projected - r.actual;
    r.overUnder = r.revised - r.projected;
    for (const key of Object.keys(r) as (keyof BudgetRow)[]) {
      if (typeof r[key] === 'number') (r as any)[key] = r2(r[key] as number);
    }
    list.push(r);
  }

  const totals = {} as BudgetTotals;
  for (const key of [
    'original', 'originalPrime', 'originalTenant', 'coApproved', 'coPending', 'revised', 'revisedPrime',
    'revisedTenant', 'pending', 'committed', 'actual', 'paid', 'projected', 'toComplete', 'overUnder',
  ] as (keyof BudgetTotals)[]) {
    totals[key] = r2(list.reduce((t, r) => t + (r[key] as number), 0));
  }
  return { rows: list, totals };
}

/**
 * How much is still free on a cost code for a NEW commitment: revised budget, less what is
 * already committed, less what other purchase orders are waiting to commit. `exceptPoId`
 * leaves out the PO being approved, so it is not counted against itself.
 */
export function leftOnCode(input: BudgetInput, costCodeId: string | null, exceptPoId?: string) {
  const { rows } = computeBudget(input);
  const r = rows.find((x) => x.costCodeId === costCodeId);
  const revised = r?.revised ?? 0;
  const committed = input.purchaseOrders
    .filter((p) => p.status === 'APPROVED' && p.id !== exceptPoId)
    .flatMap((p) => p.lines).filter((l) => l.costCodeId === costCodeId)
    .reduce((t, l) => t + toNum(l.amount), 0);
  const pendingOther = input.purchaseOrders
    .filter((p) => (p.status === 'PENDING' || p.status === 'DRAFT') && p.id !== exceptPoId)
    .flatMap((p) => p.lines).filter((l) => l.costCodeId === costCodeId)
    .reduce((t, l) => t + toNum(l.amount), 0);
  return r2(revised - committed - pendingOther);
}

/** Cost codes a set of PO lines would take past what is left on them. */
export function codesOverBudget(
  input: BudgetInput,
  lines: { costCodeId: string | null; amount: unknown }[],
  exceptPoId?: string,
): (string | null)[] {
  const byCode = new Map<string | null, number>();
  for (const l of lines) byCode.set(l.costCodeId, (byCode.get(l.costCodeId) ?? 0) + toNum(l.amount));
  const over: (string | null)[] = [];
  for (const [code, amt] of byCode) {
    if (amt > 0 && amt > leftOnCode(input, code, exceptPoId) + 0.005) over.push(code);
  }
  return over;
}
