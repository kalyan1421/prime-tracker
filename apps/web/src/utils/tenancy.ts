/**
 * Pure derivations behind the unit page's tenancy panel and change log.
 *
 * Extracted from UnitDetailPage so they can be tested directly. They are the answer to
 * "is this tenant actually the tenant" and "what did this edit mean", which is exactly
 * the logic that was wrong on 2026-08-13 — a unit reading AVAILABLE while the panel
 * confidently displayed a tenant whose lease had finished. Nothing here touches the DOM
 * or the API.
 */
import { fmt, fmtPct, fmtDate } from './fmt';

/**
 * Unit statuses that assert somebody is in, or committed to, the space — and therefore
 * that a lease should exist.
 *
 * OCCUPIED is included: it means a tenant is physically in the unit, which without a
 * lease is the same dead end as LEASED. UNDER_CONTRACT is NOT — that is a SALE being
 * negotiated, and prompting for a tenant there would be the wrong document entirely.
 */
export const TENANTED_STATUSES = ['LEASED', 'LEASE_PENDING', 'OCCUPIED'];

/**
 * What a tenancy is ACTUALLY doing, derived from its dates — not read off `status`.
 *
 * `status` is a field someone has to remember to change, so on live data it drifts: a
 * lease whose term ended last month still reads ACTIVE until a human notices. Showing
 * that as a green "Active" chip is the app asserting something it has not checked.
 * Everything here is computed from leaseEnd / terminationDate, which cannot drift.
 */
export type TenancyState = {
  key: 'DRAFT' | 'CURRENT' | 'ENDING_SOON' | 'OVERDUE_TO_CLOSE' | 'ENDED';
  label: string;
  chip: string;
  /** True when this tenancy is over — the panel renders it as history, not as "the tenant". */
  isPast: boolean;
  note?: string;
};

export function tenancyState(lease: any): TenancyState {
  const today = new Date();
  const end = lease?.leaseEnd ? new Date(lease.leaseEnd) : null;
  const daysToEnd = end ? Math.round((end.getTime() - today.getTime()) / 86_400_000) : null;

  if (lease?.terminationDate || ['EXPIRED', 'TERMINATED'].includes(lease?.status)) {
    return {
      key: 'ENDED',
      label: 'Past tenant',
      chip: 'bg-gray-100 text-gray-600',
      isPast: true,
      note: lease?.terminationDate
        ? `Moved out ${fmtDate(lease.terminationDate)}`
        : end ? `Ended ${fmtDate(lease.leaseEnd)}` : undefined,
    };
  }
  if (lease?.status === 'DRAFT') {
    return { key: 'DRAFT', label: 'Draft', chip: 'bg-amber-100 text-amber-700', isPast: false,
      note: 'Not activated — no rent is being billed' };
  }
  // The drift case: the term is over but nobody closed the lease. Not "Active".
  if (daysToEnd !== null && daysToEnd < 0) {
    return {
      key: 'OVERDUE_TO_CLOSE',
      label: 'Term ended',
      chip: 'bg-red-100 text-red-700',
      isPast: false,
      note: `Ran out ${fmtDate(lease.leaseEnd)} and was never closed — end the tenancy or extend it`,
    };
  }
  if (daysToEnd !== null && daysToEnd <= 60) {
    return { key: 'ENDING_SOON', label: 'Ending soon', chip: 'bg-amber-100 text-amber-700', isPast: false,
      note: `Expires ${fmtDate(lease.leaseEnd)} — ${daysToEnd} days` };
  }
  return { key: 'CURRENT', label: 'Active', chip: 'bg-emerald-100 text-emerald-700', isPast: false };
}

/**
 * Render one side of a lease-terms change. The recorder stores values as strings so the
 * audit row stays comparable; the type tells us how to put them back into money, a date
 * or a percentage. Nulls read as "not set" rather than as an empty gap.
 */
export function fmtChangeValue(v: string | null, type: string): string {
  if (v == null || v === '') return 'not set';
  if (type === 'money') return fmt(Number(v));
  if (type === 'pct') return fmtPct(Number(v));
  if (type === 'date') return fmtDate(v);
  return String(v);
}

/**
 * Say what a change MEANT, not just what it was.
 *
 * "Rent end: Aug 13, 2027 → Jul 1, 2026" is accurate and makes the reader do the
 * arithmetic. "13 months earlier" is the thing they were actually going to work out.
 *
 * Returns null when there is nothing useful to add (a value appearing from nothing, a
 * text field, a delta of zero) — an annotation on every row would be noise, and noise
 * is what makes people stop reading a change log.
 */
export function changeDelta(c: { from: string | null; to: string | null; type: string }): string | null {
  if (c.from == null || c.from === '' || c.to == null || c.to === '') return null;

  if (c.type === 'money') {
    const d = Number(c.to) - Number(c.from);
    if (!Number.isFinite(d) || d === 0) return null;
    // Sign is spelled out rather than colour-coded: "up" is good for rent and bad for a
    // TI allowance, so a green/red judgement would be wrong half the time.
    return `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`;
  }

  if (c.type === 'pct') {
    const d = Number(c.to) - Number(c.from);
    if (!Number.isFinite(d) || d === 0) return null;
    return `${d > 0 ? '+' : '−'}${Math.abs(d)} pts`;
  }

  if (c.type === 'date') {
    const from = new Date(c.from);
    const to = new Date(c.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    if (days === 0) return null;
    const abs = Math.abs(days);
    // Months once it stops being countable in days — "395 days earlier" is a number
    // nobody holds in their head.
    const span = abs >= 60 ? `${Math.round(abs / 30.44)} months` : `${abs} days`;
    return `${span} ${days < 0 ? 'earlier' : 'later'}`;
  }

  // Plain numbers (term in months, free-rent months, rent due day).
  const a = Number(c.from);
  const b = Number(c.to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return `${Math.abs(b - a)} ${b > a ? 'more' : 'fewer'}`;
}

/** One-line summary for the entry header, so the timeline reads without expanding. */
export function summariseChanges(changes: Array<{ label: string }> = []): string | null {
  if (changes.length === 0) return null;
  if (changes.length === 1) return `${changes[0].label} changed`;
  if (changes.length === 2) return `${changes[0].label} and ${changes[1].label} changed`;
  return `${changes[0].label}, ${changes[1].label} and ${changes.length - 2} more changed`;
}


/**
 * One lease that happens to cover several units, gathered back into one thing.
 *
 * A multi-unit letting is stored as N separate `Lease` rows sharing `combinedDealRef` —
 * the units stay separate on purpose, so any one of them can later be sold or re-let on
 * its own. Nothing downstream knew that, so the six-unit We Fun lease rendered as six
 * tenancies: six rent-roll rows, six tenant cards, six of everything, as though six
 * businesses had moved in.
 *
 * This is the one place that regrouping is decided, so every surface collapses a deal the
 * same way and none of them re-derive it.
 *
 * NOT the same thing as `UnitsService.combine()`, which physically MERGES units into one
 * new unit and archives the sources. Nothing here changes a single record — it is a view
 * over rows that stay exactly as they are. UI copy says "leased together", never
 * "combined", so the two cannot be confused.
 */
export type DealGroup = {
  /** The shared reference, or null for an ordinary single-unit lease. */
  ref: string | null;
  /** Members, in unit-number order. Always at least one. */
  leases: any[];
  /** The lease to act on / show details from — the one carrying the deal's deposit. */
  primary: any;
  /** "701–706", "606, 608", or just "101". */
  unitLabel: string;
  /** Summed across members: the rent for the whole letting. */
  totalRent: number;
  /** False for a lone lease AND for a ref with only one live member — both render as
   *  ordinary rows. A "group of one" is not a group. */
  isGroup: boolean;
};

/** The unit number a lease sits on, however the caller's payload happens to be shaped. */
function unitNumberOf(lease: any): string {
  return String(lease?.unit?.unitNumber ?? lease?.unitNumber ?? '');
}

/**
 * "701, 702, 703, 704, 705, 706" is noise; "701–706" is the thing itself. Collapses to a
 * range only when the numbers are purely numeric, all distinct and genuinely contiguous —
 * "606, 608" must never render as "606–608", which would claim a unit 607 that is not in
 * the letting.
 */
export function formatUnitLabel(unitNumbers: string[]): string {
  const clean = unitNumbers.filter(Boolean);
  if (clean.length === 0) return '—';
  if (clean.length === 1) return clean[0];
  const nums = clean.map((n) => Number(n));
  const allNumeric = nums.every((n) => Number.isInteger(n));
  if (allNumeric) {
    const sorted = [...nums].sort((a, b) => a - b);
    const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
    if (contiguous && sorted.length > 2) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
    return sorted.join(', ');
  }
  return [...clean].sort().join(', ');
}

export function groupByCombinedDeal(leases: any[]): DealGroup[] {
  const byRef = new Map<string, any[]>();
  const singles: any[] = [];

  for (const l of leases ?? []) {
    const ref = (l?.combinedDealRef ?? '').trim();
    if (!ref) { singles.push(l); continue; }
    const list = byRef.get(ref) ?? [];
    list.push(l);
    byRef.set(ref, list);
  }

  const groups: DealGroup[] = [];

  for (const [ref, members] of byRef) {
    const ordered = [...members].sort((a, b) => unitNumberOf(a).localeCompare(unitNumberOf(b), undefined, { numeric: true }));
    groups.push({
      ref,
      leases: ordered,
      // The deposit is held whole on ONE member (client decision, 2026-09-12), so that is
      // the lease a deal-level action has to target. Falls back to the first member for
      // data that predates the rule.
      primary: ordered.find((l) => Number(l?.securityDeposit ?? 0) > 0) ?? ordered[0],
      unitLabel: formatUnitLabel(ordered.map(unitNumberOf)),
      totalRent: ordered.reduce((sum, l) => sum + Number(l?.monthlyRent ?? 0), 0),
      // A ref whose siblings were never imported (two exist in live data) is one unit
      // wearing a group's name. Rendering it as a collapsible group of one is just noise.
      isGroup: ordered.length > 1,
    });
  }

  for (const l of singles) {
    groups.push({
      ref: null,
      leases: [l],
      primary: l,
      unitLabel: unitNumberOf(l) || '—',
      totalRent: Number(l?.monthlyRent ?? 0),
      isGroup: false,
    });
  }

  // Stable ordering by first unit, so a group sits where its lowest unit would have.
  return groups.sort((a, b) => a.unitLabel.localeCompare(b.unitLabel, undefined, { numeric: true }));
}

/**
 * The same regrouping, for a list of UNITS rather than leases.
 *
 * A unit list is inventory — every physical unit is real and none may be hidden. So a
 * deal here is a collapsible row that opens to the units it covers, never a replacement
 * for them. `units` is always the full set; the caller decides whether to show them.
 */
export type UnitDealGroup = {
  ref: string | null;
  units: any[];
  unitLabel: string;
  /** Whether these units are held together by a letting or by a sale. */
  dealKind: 'LEASE' | 'SALE' | null;
  /** Tenant for a letting, buyer for a sale — whoever the group is with. */
  partyName: string | null;
  isGroup: boolean;
};

/**
 * What holds this unit together with others, if anything.
 *
 * A SOLD unit is grouped by its SALE, not its tenancy: the letting that preceded the sale
 * is history, and a lease row surviving on a sold unit must not drag it back into a
 * lettings group (the rule the rent roll already applies). Units sold together as one deal
 * still belong together though — they just belong together as a SALE, which is why this
 * looks at the sale first for those.
 */
function dealOfUnit(unit: any): { ref: string; kind: 'LEASE' | 'SALE' | null; party: string | null } {
  if (unit?.status === 'SOLD') {
    const sales = (unit?.sales ?? []).filter((x: any) => x?.status !== 'CANCELLED');
    const sale = sales.find((x: any) => x?.combinedDealRef) ?? sales[0];
    return {
      ref: String(sale?.combinedDealRef ?? '').trim(),
      kind: sale ? 'SALE' : null,
      party: sale?.buyer ?? null,
    };
  }
  const lease = (unit?.leases ?? []).find((l: any) => l?.combinedDealRef) ?? unit?.leases?.[0];
  return {
    ref: String(lease?.combinedDealRef ?? '').trim(),
    kind: lease ? 'LEASE' : null,
    party: lease?.tenantName ?? null,
  };
}

export function groupUnitsByCombinedDeal(units: any[]): UnitDealGroup[] {
  const byRef = new Map<string, any[]>();
  const singles: any[] = [];

  for (const u of units ?? []) {
    const { ref, kind } = dealOfUnit(u);
    if (!ref) { singles.push(u); continue; }
    // Keyed by kind too: a letting and a sale could reuse a label, and merging the two
    // would put sold and let units in one row.
    const key = `${kind}:${ref}`;
    const list = byRef.get(key) ?? [];
    list.push(u);
    byRef.set(key, list);
  }

  const out: UnitDealGroup[] = [];
  for (const [key, members] of byRef) {
    const ordered = [...members].sort((a, b) =>
      String(a?.unitNumber ?? '').localeCompare(String(b?.unitNumber ?? ''), undefined, { numeric: true }));
    // A ref with one member in THIS list is not a group — it is one unit. That happens
    // both for a half-imported deal and, routinely, when a building filter is applied.
    if (ordered.length < 2) { singles.push(ordered[0]); continue; }
    const head = dealOfUnit(ordered[0]);
    out.push({
      ref: key.slice(key.indexOf(':') + 1),
      units: ordered,
      unitLabel: formatUnitLabel(ordered.map((u) => String(u?.unitNumber ?? ''))),
      dealKind: head.kind,
      partyName: head.party,
      isGroup: true,
    });
  }

  for (const u of singles) {
    const d = dealOfUnit(u);
    out.push({
      ref: null,
      units: [u],
      unitLabel: String(u?.unitNumber ?? u?.name ?? '—'),
      dealKind: d.kind,
      partyName: d.party,
      isGroup: false,
    });
  }

  return out.sort((a, b) => a.unitLabel.localeCompare(b.unitLabel, undefined, { numeric: true }));
}

/**
 * The same regrouping for SALES — several units sold to one buyer as one negotiated deal.
 *
 * Lives beside the lease and unit versions because it is the same question about the same
 * `combinedDealRef` idea, and keeping the three together is what stops a fourth being
 * invented somewhere else with slightly different rules.
 */
export type SaleDealGroup = {
  ref: string | null;
  sales: any[];
  primary: any;
  unitLabel: string;
  totalPrice: number;
  isGroup: boolean;
};

export function groupSalesByCombinedDeal(sales: any[]): SaleDealGroup[] {
  const byRef = new Map<string, any[]>();
  const singles: any[] = [];
  for (const s of sales ?? []) {
    const ref = (s?.combinedDealRef ?? '').trim();
    if (!ref) { singles.push(s); continue; }
    const list = byRef.get(ref) ?? [];
    list.push(s);
    byRef.set(ref, list);
  }

  const out: SaleDealGroup[] = [];
  for (const [ref, members] of byRef) {
    const ordered = [...members].sort((a, b) =>
      String(a?.unit?.unitNumber ?? '').localeCompare(String(b?.unit?.unitNumber ?? ''), undefined, { numeric: true }));
    // One member here is one sale — a deal whose siblings sit in another pipeline column
    // (two closed, one still under contract) must not render as a "group of one".
    if (ordered.length < 2) { singles.push(ordered[0]); continue; }
    out.push({
      ref,
      sales: ordered,
      primary: ordered[0],
      unitLabel: formatUnitLabel(ordered.map((s) => String(s?.unit?.unitNumber ?? ''))),
      totalPrice: ordered.reduce((sum, s) => sum + Number(s?.salePrice ?? 0), 0),
      isGroup: true,
    });
  }
  for (const s of singles) {
    out.push({
      ref: null,
      sales: [s],
      primary: s,
      unitLabel: String(s?.unit?.unitNumber ?? '—'),
      totalPrice: Number(s?.salePrice ?? 0),
      isGroup: false,
    });
  }
  return out;
}
