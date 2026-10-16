/**
 * Shared pieces of the interiors job-costing screens (client, 2026-10-17 — replaces
 * BuilderTrend's estimate / budget / purchase order screens for fit-outs).
 *
 * Money is shown to the cent, as BuilderTrend shows it: the client checks these screens
 * against BuilderTrend line by line while the two run side by side.
 */
import type { ReactNode } from 'react';

export type Payer = 'PRIME' | 'TENANT';

export const COST_TYPES = ['Subcontractor', 'Material', 'Labor', 'Equipment', 'Other'];
export const CO_REASONS = ['Tenant request', 'Scope add', 'Cost increase', 'Plan change', 'Credit', 'Other'];

/** "$318,007.06" — cents only when there are any; "" for zero when `blankZero`. */
export function money(n: number | null | undefined, opts: { blankZero?: boolean } = {}) {
  const v = Number(n ?? 0) || 0;
  if (opts.blankZero && Math.abs(v) < 0.005) return '';
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}$${s}`;
}

export interface CostCode {
  id: string; code: string | null; name: string; groupCode: string | null; groupName: string;
  sortOrder: number; active: boolean;
}

export const codeLabel = (c?: { code: string | null; name: string } | null) =>
  !c ? 'No cost code' : c.code ? `${c.code} - ${c.name}` : c.name;

/** Cost codes grouped the way BuilderTrend lists them: "02 BUSINESS OPERATIONS" etc. */
export function groupCodes(codes: CostCode[]) {
  const groups: { key: string; label: string; codes: CostCode[] }[] = [];
  for (const c of [...codes].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = c.groupName;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, label: c.groupCode ? `${c.groupCode} ${c.groupName}` : c.groupName, codes: [] }; groups.push(g); }
    g.codes.push(c);
  }
  return groups;
}

const FIELD = 'h-8 w-full rounded border border-gray-200 bg-white px-2 text-xs text-gray-900 outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-700';

/**
 * A native select, grouped by division. Native on purpose: the estimate grid renders one
 * per line, and a HeroUI Select per row made a 60-line estimate sluggish to type in.
 */
export function CostCodeSelect({ value, onChange, codes, label, disabled, allowNone = true }: {
  value: string | null | undefined; onChange: (id: string | null) => void; codes: CostCode[];
  label: string; disabled?: boolean; allowNone?: boolean;
}) {
  // A line may point at a code that has since been switched off; keep it selectable.
  const shown = codes.filter((c) => c.active || c.id === value);
  return (
    <select
      aria-label={label} disabled={disabled} value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)} className={FIELD}
    >
      {allowNone && <option value="">No cost code</option>}
      {groupCodes(shown).map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.codes.map((c) => <option key={c.id} value={c.id}>{codeLabel(c)}{c.active ? '' : ' (off)'}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export function PlainSelect({ value, onChange, options, label, disabled }: {
  value: string | null | undefined; onChange: (v: string) => void; options: { value: string; label: string }[];
  label: string; disabled?: boolean;
}) {
  return (
    <select aria-label={label} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={FIELD}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Who pays for a line: Prime (the TI budget) or the tenant (billed back). */
export function PayerToggle({ value, onChange, disabled, label = 'Paid by' }: {
  value: Payer | string; onChange: (v: Payer) => void; disabled?: boolean; label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded border border-gray-200 bg-white p-0.5">
      {(['PRIME', 'TENANT'] as Payer[]).map((p) => {
        const on = value === p;
        return (
          <button
            key={p} type="button" role="radio" aria-checked={on} disabled={disabled}
            onClick={() => !on && onChange(p)}
            className={`h-7 rounded px-2 text-[11px] font-semibold ${on
              ? p === 'TENANT' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'
              : 'text-gray-700 enabled:hover:bg-gray-100'}`}
          >
            {p === 'PRIME' ? 'Prime' : 'Tenant'}
          </button>
        );
      })}
    </div>
  );
}

export function PayerTag({ value }: { value: string }) {
  return value === 'TENANT'
    ? <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-semibold text-purple-700">Tenant</span>
    : <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">Prime</span>;
}

const TONES = {
  gray: 'bg-gray-100 text-gray-700',
  amber: 'bg-amber-50 text-amber-700',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-blue-50 text-blue-700',
} as const;

export function Tag({ tone = 'gray', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

export const STATUS_TAG: Record<string, { tone: keyof typeof TONES; label: string }> = {
  DRAFT: { tone: 'gray', label: 'Draft' },
  SUBMITTED: { tone: 'amber', label: 'Waiting for approval' },
  LOCKED: { tone: 'blue', label: 'Locked' },
  PENDING: { tone: 'amber', label: 'Waiting' },
  APPROVED: { tone: 'green', label: 'Approved' },
  REJECTED: { tone: 'red', label: 'Rejected' },
  VOID: { tone: 'red', label: 'Void' },
  PAID: { tone: 'green', label: 'Paid' },
};

export function StatusTag({ status, labels }: { status: string; labels?: Record<string, string> }) {
  const s = STATUS_TAG[status] ?? { tone: 'gray' as const, label: status };
  return <Tag tone={s.tone}>{labels?.[status] ?? s.label}</Tag>;
}

export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad'; children: ReactNode }) {
  const cls = tone === 'bad' ? 'border-red-100 bg-red-50 text-red-700'
    : tone === 'warn' ? 'border-amber-100 bg-amber-50 text-amber-700'
      : 'border-blue-100 bg-blue-50 text-blue-700';
  return <div className={`rounded-lg border px-3 py-2 text-xs ${cls}`}>{children}</div>;
}

export function SectionCard({ title, hint, right, children }: {
  title: string; hint?: ReactNode; right?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
        <span className="flex-1" />
        {right}
      </header>
      {children}
    </section>
  );
}

export const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap';
export const TD = 'px-3 py-2 text-xs text-gray-800 align-top';
export const NUM = 'tabular-nums text-right whitespace-nowrap';

export const fmtDay = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';

export const roleList = (roles: string[]) =>
  roles.map((r) => r.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())).join(', ');
