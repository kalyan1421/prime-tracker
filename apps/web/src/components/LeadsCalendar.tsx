import { useMemo, useState } from 'react';
import { Button, Chip, Tooltip } from '@heroui/react';
import { FiChevronLeft, FiChevronRight, FiCalendar, FiPhoneCall } from 'react-icons/fi';
import { useSiteVisits } from '../hooks/useApi';

/**
 * Month view of what is actually in the diary: confirmed site visits and follow-up dates,
 * chipped as "Lead name | PROJECT" and coloured per project — the Agency Dashboard
 * calendar the client is moving off monday.
 *
 * Follow-ups come from the leads already loaded by the page; visits are fetched for the
 * month on show. Both are read-only here — clicking a chip opens the lead, which is where
 * anything is actually changed.
 */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// One stable colour per project, assigned by first appearance so the legend does not
// reshuffle on every render.
const PROJECT_COLORS = [
  { chip: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  { chip: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  { chip: 'bg-pink-100 text-pink-800 border-pink-200', dot: 'bg-pink-500' },
  { chip: 'bg-violet-100 text-violet-800 border-violet-200', dot: 'bg-violet-500' },
  { chip: 'bg-sky-100 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  { chip: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-500' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function monthCells(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<{ day: number; key: string } | null> = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push({ day: d, key: keyOf(year, month + 1, d) });
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function LeadsCalendar({
  leads, onSelect,
}: { leads: any[]; onSelect: (lead: any) => void }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  // Days the user has expanded. Per-day rather than a global "show all" so one busy
  // Tuesday does not stretch every other row in the month.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const range = useMemo(() => {
    const from = new Date(Date.UTC(cursor.year, cursor.month, 1));
    const to = new Date(Date.UTC(cursor.year, cursor.month + 1, 0, 23, 59, 59));
    return { from: from.toISOString(), to: to.toISOString() };
  }, [cursor]);

  const { data: visitData } = useSiteVisits(range);
  const visits: any[] = (visitData as any[]) || [];

  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);

  // Stable colour per project across both chip kinds.
  const projectColor = useMemo(() => {
    const names = [...new Set([
      ...leads.map((l) => l.project?.name).filter(Boolean),
      ...visits.map((v) => v.project?.name).filter(Boolean),
    ])].sort();
    const map = new Map<string, typeof PROJECT_COLORS[number]>();
    names.forEach((n, i) => map.set(n as string, PROJECT_COLORS[i % PROJECT_COLORS.length]));
    return map;
  }, [leads, visits]);

  // Both kinds of entry, bucketed by calendar day.
  const byDay = useMemo(() => {
    const map: Record<string, Array<any>> = {};
    for (const l of leads) {
      if (!l.followUpDate) continue;
      const k = String(l.followUpDate).slice(0, 10);
      (map[k] ||= []).push({ kind: 'followup', lead: l, project: l.project?.name });
    }
    for (const v of visits) {
      // Terminal states are history, not diary entries.
      if (['CANCELLED', 'RESCHEDULED', 'REJECTED'].includes(v.status)) continue;
      const k = new Intl.DateTimeFormat('en-CA', {
        timeZone: v.timezone || 'America/Chicago',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(v.startsAt));
      (map[k] ||= []).push({ kind: 'visit', visit: v, lead: v.lead, project: v.project?.name });
    }
    return map;
  }, [leads, visits]);

  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
    .format(new Date(cursor.year, cursor.month, 1));
  const today = keyOf(now.getFullYear(), now.getMonth() + 1, now.getDate());

  const step = (d: number) => setCursor((c) => {
    const m = c.month + d;
    return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
  });

  const legend = [...projectColor.entries()];

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <span className="text-sm font-semibold text-gray-800">{monthLabel}</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="flat" className="h-7 min-w-0 px-2 text-xs"
            onPress={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}>
            Today
          </Button>
          <Button isIconOnly size="sm" variant="light" aria-label="Previous month"
            className="h-7 w-7 min-w-0" onPress={() => step(-1)}>
            <FiChevronLeft className="w-4 h-4" />
          </Button>
          <Button isIconOnly size="sm" variant="light" aria-label="Next month"
            className="h-7 w-7 min-w-0" onPress={() => step(1)}>
            <FiChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {DOW.map((d) => (
          <div key={d} className="px-2 py-1 text-[11px] font-semibold text-gray-600 text-center">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((c, i) => {
          if (!c) return <div key={`pad-${i}`} className="min-h-[92px] border-b border-r border-gray-100 bg-gray-50/40" />;
          const entries = byDay[c.key] ?? [];
          const isToday = c.key === today;
          return (
            <div key={c.key} className="min-h-[92px] border-b border-r border-gray-100 p-1 align-top">
              <div className={`text-[11px] mb-0.5 ${isToday
                ? 'font-bold text-blue-700' : 'text-gray-600'}`}>
                {c.day}{isToday && ' · today'}
              </div>
              <div className="space-y-0.5">
                {(expanded[c.key] ? entries : entries.slice(0, 3)).map((e, idx) => {
                  const color = projectColor.get(e.project) ?? PROJECT_COLORS[0];
                  const name = e.lead?.name || 'Unnamed lead';
                  const label = e.kind === 'visit'
                    ? `Site visit · ${name}${e.project ? ` | ${e.project}` : ''}`
                    : `Follow up · ${name}${e.project ? ` | ${e.project}` : ''}`;
                  return (
                    <Tooltip key={idx} content={label}>
                      <button
                        type="button"
                        onClick={() => e.lead && onSelect(e.lead)}
                        aria-label={label}
                        className={`w-full text-left truncate px-1 py-0.5 rounded border text-[11px] font-medium ${color.chip} hover:opacity-80`}
                      >
                        <span className="inline-flex items-center gap-1 w-full">
                          {e.kind === 'visit'
                            ? <FiCalendar className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                            : <FiPhoneCall className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />}
                          <span className="truncate">{name}</span>
                        </span>
                      </button>
                    </Tooltip>
                  );
                })}
                {entries.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setExpanded((x) => ({ ...x, [c.key]: !x[c.key] }))}
                    aria-expanded={!!expanded[c.key]}
                    aria-label={expanded[c.key]
                      ? `Show fewer entries on ${c.key}`
                      : `Show all ${entries.length} entries on ${c.key}`}
                    className="block w-full text-left text-[11px] text-gray-600 hover:text-gray-900 hover:underline pl-1"
                  >
                    {expanded[c.key] ? 'Show less' : `+${entries.length - 3} more`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {legend.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap px-3 py-2 border-t border-gray-200">
          {legend.map(([name, color]) => (
            <span key={name} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
              <span className={`w-2 h-2 rounded-full ${color.dot}`} aria-hidden="true" />
              {name}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 ml-auto">
            <FiCalendar className="w-3 h-3" aria-hidden="true" /> Site visit
            <FiPhoneCall className="w-3 h-3 ml-2" aria-hidden="true" /> Follow-up
          </span>
        </div>
      )}
    </div>
  );
}
