/**
 * Sorting and the date-derived filters for the Leads list. Shared by the card list and
 * the grid so both views agree on what "sorted by follow-up" means, and kept pure so the
 * ordering rules are pinned by tests rather than by eyeballing a table.
 */

/**
 * Days until a follow-up is due: negative = overdue, 0 = today, positive = upcoming.
 * null when no date is set.
 *
 * Compared as CALENDAR DAYS, not instants. followUpDate is a DATE column and arrives as
 * UTC midnight, so a naive `new Date(x) < new Date()` marks today's follow-up overdue for
 * every hour of the local day after midnight UTC — the same timezone trap that already
 * produced a time-of-day-dependent test failure elsewhere in this repo.
 */
export function followUpDays(lead: any): number | null {
  if (!lead?.followUpDate) return null;
  const d = String(lead.followUpDate).slice(0, 10).split('-').map(Number);
  if (d.length !== 3 || d.some(Number.isNaN)) return null;
  const due = Date.UTC(d[0], d[1] - 1, d[2]);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86_400_000);
}

// "Stale" = no activity in 14+ days, and not in a terminal status (CONVERTED/LOST/DEAD).
// The 14-day threshold is intentionally aggressive so reps notice deals going cold
// — escalates to red at 30 days. Matches the dashboard's stale-leads list.
export function staleDays(lead: { updatedAt: string; status: string }): number | null {
  if (['CONVERTED', 'LOST', 'DEAD'].includes(lead.status)) return null;
  const days = Math.floor((Date.now() - new Date(lead.updatedAt).getTime()) / 86_400_000);
  return days >= 14 ? days : null;
}

export type LeadSortKey =
  | 'stale' | 'activity' | 'added' | 'followUp' | 'name' | 'status'
  | 'calls' | 'source' | 'team' | 'unit' | 'campaign';
export type SortDir = 'asc' | 'desc';
export interface LeadSort { key: LeadSortKey; dir: SortDir }

/**
 * Every sortable field, with the direction it should START in — the one a person means
 * when they pick it. Nobody choosing "Date added" wants the oldest lead first, and nobody
 * choosing "Follow-up" wants next year's before today's.
 */
export const LEAD_SORT_FIELDS: { key: LeadSortKey; label: string; defaultDir: SortDir }[] = [
  { key: 'stale', label: 'Most stale', defaultDir: 'desc' },
  { key: 'activity', label: 'Last activity', defaultDir: 'desc' },
  { key: 'added', label: 'Date added', defaultDir: 'desc' },
  { key: 'followUp', label: 'Follow-up date', defaultDir: 'asc' },
  { key: 'name', label: 'Name', defaultDir: 'asc' },
  { key: 'status', label: 'Pipeline stage', defaultDir: 'asc' },
  { key: 'calls', label: 'Calls', defaultDir: 'desc' },
  { key: 'source', label: 'Source', defaultDir: 'asc' },
  { key: 'team', label: 'Assignee', defaultDir: 'asc' },
  { key: 'unit', label: 'Building / Unit', defaultDir: 'asc' },
  { key: 'campaign', label: 'Campaign', defaultDir: 'asc' },
];

export const DEFAULT_LEAD_SORT: LeadSort = { key: 'stale', dir: 'desc' };

export function isLeadSortKey(v: unknown): v is LeadSortKey {
  return LEAD_SORT_FIELDS.some((f) => f.key === v);
}

export function defaultDirFor(key: LeadSortKey): SortDir {
  return LEAD_SORT_FIELDS.find((f) => f.key === key)?.defaultDir ?? 'asc';
}

const time = (v: unknown): number | null => {
  if (!v) return null;
  const t = new Date(v as string).getTime();
  return Number.isNaN(t) ? null : t;
};
const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

function sortValue(lead: any, key: LeadSortKey, statusOrder: string[]): number | string | null {
  switch (key) {
    case 'stale': return staleDays(lead);
    case 'activity': return time(lead.updatedAt);
    case 'added': return time(lead.createdAt);
    case 'followUp': return followUpDays(lead);
    case 'name': return text(lead.name);
    case 'status': {
      const i = statusOrder.indexOf(lead.status);
      return i === -1 ? null : i;
    }
    case 'calls': return lead.callCount ?? 0;
    case 'source': return text(lead.source);
    case 'team': return text(lead.assignedUser?.name);
    case 'unit': return text(lead.unit?.unitNumber) ?? text(lead.building?.name);
    case 'campaign': return text(lead.campaign?.name);
  }
}

/**
 * Returns a sorted COPY. Blanks — no follow-up set, no assignee, an unnamed lead — always
 * sink to the bottom whichever direction is chosen: flipping to descending is asking for
 * the other end of the real values, not for a screen full of dashes.
 *
 * `statusOrder` is the pipeline order from the lead_status catalogue, so "Pipeline stage"
 * follows the funnel (New → Contacted → … → Converted) rather than the alphabet.
 */
export function sortLeads<T>(leads: T[], sort: LeadSort, statusOrder: string[] = []): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  // Decorate once instead of recomputing staleDays/followUpDays inside every comparison.
  return leads
    .map((lead, i) => ({ lead, i, v: sortValue(lead, sort.key, statusOrder) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const cmp = typeof a.v === 'number' && typeof b.v === 'number'
        ? a.v - b.v
        // numeric: true so "Unit 9" sorts before "Unit 10".
        : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' });
      // Ties keep the incoming order, so the sort is stable across re-renders.
      return cmp !== 0 ? cmp * sign : a.i - b.i;
    })
    .map((d) => d.lead);
}

export type FollowUpFilter = '' | 'overdue' | 'today' | 'week' | 'none';

export const FOLLOW_UP_FILTERS: { key: Exclude<FollowUpFilter, ''>; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Due in next 7 days' },
  { key: 'none', label: 'No follow-up set' },
];

export function matchFollowUp(lead: any, filter: FollowUpFilter): boolean {
  if (!filter) return true;
  const d = followUpDays(lead);
  switch (filter) {
    case 'overdue': return d !== null && d < 0;
    case 'today': return d === 0;
    case 'week': return d !== null && d >= 0 && d <= 7;
    case 'none': return d === null;
  }
}
