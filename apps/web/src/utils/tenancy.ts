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

