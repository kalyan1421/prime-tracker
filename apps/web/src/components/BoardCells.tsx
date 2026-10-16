/**
 * monday-style board cells for the Site Tracker (client, 2026-10-16: "inline edit for each
 * data point … same visual as monday.com").
 *
 * Every cell edits where it sits — no dialog. Status-type values are a COLOUR-FILLED cell
 * with the label in white, the way the client's board shows them; clicking opens the label
 * picker. Text, dates and timelines turn into an input on click and save on Enter or blur.
 *
 * Fills are the -600/-700 step of each hue, not monday's brighter shades: white text on
 * monday's own green/orange measures under 3:1, which the design system (AA, 4.5:1) rejects.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@heroui/react';
import { FiX } from 'react-icons/fi';
import { fmtDateShort } from '../utils/fmt';

export interface CellOption { value: string; label: string; color?: string | null }

/** HeroUI colour names (what CustomOption carries) -> filled-cell classes, AA with white text. */
const FILL: Record<string, string> = {
  success: 'bg-emerald-700 text-white',
  warning: 'bg-orange-700 text-white',
  danger: 'bg-red-600 text-white',
  primary: 'bg-blue-600 text-white',
  secondary: 'bg-purple-600 text-white',
  default: 'bg-gray-500 text-white',
};

/** Overrides by value where the client's board uses a specific colour for a specific label. */
const FILL_BY_VALUE: Record<string, string> = {
  // PRIORITY — monday: HIGH purple, MEDIUM teal, LOW blue.
  HIGH: 'bg-purple-600 text-white',
  MEDIUM: 'bg-teal-700 text-white',
  LOW: 'bg-blue-600 text-white',
  // Stage status — monday: Not Started grey, Working on it orange, Done green, Stuck red.
  NOT_STARTED: 'bg-gray-500 text-white',
  IN_PROGRESS: 'bg-orange-700 text-white',
  DONE: 'bg-emerald-700 text-white',
  BLOCKED: 'bg-red-600 text-white',
};

export function fillFor(opt?: CellOption | null) {
  if (!opt) return 'bg-gray-200 text-gray-600';
  return FILL_BY_VALUE[opt.value] ?? FILL[opt.color ?? 'default'] ?? FILL.default;
}

/**
 * A colour-filled status cell. Fills the whole table cell; give the <td> `p-0`.
 * `allowClear` adds a blank choice, for values that may legitimately be unset.
 */
export function StatusCell({
  value, options, onChange, canEdit, allowClear = false, label, emptyText = '',
}: {
  value: string | null | undefined;
  options: CellOption[];
  onChange: (v: string | null) => void;
  canEdit: boolean;
  allowClear?: boolean;
  label: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? null;
  const face = (
    <span className={`flex h-9 w-full items-center justify-center px-2 text-center text-xs font-medium ${fillFor(current)}`}>
      <span className="truncate">{current?.label ?? (value || emptyText)}</span>
    </span>
  );
  if (!canEdit) return <div aria-label={`${label}: ${current?.label ?? 'not set'}`}>{face}</div>;
  return (
    <Popover isOpen={open} onOpenChange={setOpen} placement="bottom" shouldBlockScroll={false}>
      <PopoverTrigger>
        <button type="button" className="block w-full hover:brightness-110" aria-label={`${label}: ${current?.label ?? 'not set'} — change`}>
          {face}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" aria-label={label}>
        <div className="flex w-full flex-col gap-1">
          {options.map((o) => (
            <button
              key={o.value} type="button"
              onClick={() => { setOpen(false); if (o.value !== value) onChange(o.value); }}
              className={`flex h-8 w-full items-center justify-center rounded text-xs font-medium hover:brightness-110 ${fillFor(o)} ${o.value === value ? 'ring-2 ring-offset-1 ring-gray-900' : ''}`}
            >
              {o.label}
            </button>
          ))}
          {allowClear && (
            <button
              type="button"
              onClick={() => { setOpen(false); if (value) onChange(null); }}
              className="flex h-8 w-full items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-600 hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Click to type, Enter or click away to save, Escape to cancel. An empty value saves as
 * null when `nullable`; otherwise an empty edit is ignored (a name cannot be blanked).
 */
export function InlineText({
  value, onSave, canEdit, placeholder = '—', label, nullable = true, className = '', textClassName = '',
}: {
  value: string | null | undefined;
  onSave: (v: string | null) => void;
  canEdit: boolean;
  placeholder?: string;
  label: string;
  nullable?: boolean;
  className?: string;
  textClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === (value ?? '').trim()) return;
    if (!next && !nullable) { setDraft(value ?? ''); return; }
    onSave(next || null);
  };

  if (editing) {
    return (
      <input
        ref={ref} value={draft} aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
        }}
        className={`h-8 w-full rounded border border-blue-500 bg-white px-2 text-xs text-gray-900 outline-none ${className}`}
      />
    );
  }
  return (
    <button
      type="button" disabled={!canEdit} onClick={() => setEditing(true)}
      aria-label={canEdit ? `${label}: ${value || 'empty'} — edit` : undefined}
      title={value || undefined}
      className={`flex h-8 w-full items-center rounded px-2 text-left text-xs enabled:hover:ring-1 enabled:hover:ring-gray-300 ${className}`}
    >
      <span className={`truncate ${value ? `text-gray-800 ${textClassName}` : 'text-gray-500'}`}>{value || placeholder}</span>
    </button>
  );
}

const isoDay = (d?: string | null) => (d ? d.slice(0, 10) : '');

/** A date that becomes a native date picker on click. */
export function InlineDate({ value, onSave, canEdit, label }: {
  value: string | null | undefined; onSave: (v: string | null) => void; canEdit: boolean; label: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="date" autoFocus aria-label={label} defaultValue={isoDay(value)}
          onChange={(e) => { onSave(e.target.value || null); setEditing(false); }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
          className="h-8 w-full rounded border border-blue-500 bg-white px-1 text-xs text-gray-900 outline-none"
        />
        {value && (
          <button
            type="button" aria-label={`Clear ${label}`}
            onMouseDown={(e) => { e.preventDefault(); onSave(null); setEditing(false); }}
            className="text-gray-500 hover:text-red-700"
          >
            <FiX size={12} />
          </button>
        )}
      </div>
    );
  }
  return (
    <button
      type="button" disabled={!canEdit} onClick={() => setEditing(true)}
      aria-label={canEdit ? `${label}: ${value ? fmtDateShort(value) : 'not set'} — edit` : undefined}
      className="flex h-8 w-full items-center justify-center rounded px-2 text-xs enabled:hover:ring-1 enabled:hover:ring-gray-300"
    >
      <span className={value ? 'text-gray-800' : 'text-gray-500'}>{value ? fmtDateShort(value) : '—'}</span>
    </button>
  );
}

/** monday's timeline pill: blue when set, grey when empty; click to set from / to. */
export function TimelinePill({ start, end, onSave, canEdit, label = 'Timeline' }: {
  start: string | null | undefined; end: string | null | undefined;
  onSave: (v: { startsOn: string | null; endsOn: string | null }) => void;
  canEdit: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(isoDay(start));
  const [to, setTo] = useState(isoDay(end));
  useEffect(() => { if (!open) { setFrom(isoDay(start)); setTo(isoDay(end)); } }, [open, start, end]);

  const has = !!(start || end);
  const late = !!end && new Date(end) < new Date(new Date().toDateString());
  const pill = (
    <span
      className={`inline-flex h-6 min-w-[96px] items-center justify-center whitespace-nowrap rounded-full px-3 text-xs font-medium ${
        has ? (late ? 'bg-orange-700 text-white' : 'bg-blue-600 text-white') : 'bg-gray-200 text-gray-600'
      }`}
    >
      {has
        ? `${start ? fmtDateShort(start) : '…'}${end && end !== start ? ` – ${fmtDateShort(end)}` : ''}`
        : '—'}
    </span>
  );
  if (!canEdit) return pill;
  return (
    <Popover isOpen={open} onOpenChange={setOpen} placement="bottom" shouldBlockScroll={false}>
      <PopoverTrigger>
        <button type="button" aria-label={`${label} — edit`} className="hover:brightness-110">{pill}</button>
      </PopoverTrigger>
      <PopoverContent className="p-3" aria-label={label}>
        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-3 text-xs text-gray-700">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="h-8 rounded border border-gray-300 px-1 text-xs text-gray-900" />
          </label>
          <label className="flex items-center justify-between gap-3 text-xs text-gray-700">
            To
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}
              className="h-8 rounded border border-gray-300 px-1 text-xs text-gray-900" />
          </label>
          <div className="flex justify-between gap-2 pt-1">
            <button type="button" className="text-xs text-gray-600 hover:text-red-700"
              onClick={() => { onSave({ startsOn: null, endsOn: null }); setOpen(false); }}>
              Clear
            </button>
            <button type="button" className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
              onClick={() => { onSave({ startsOn: from || null, endsOn: to || null }); setOpen(false); }}>
              Save
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Deterministic property colour: the coloured title and left stripe of a monday group. */
const GROUP_COLORS = [
  { text: 'text-emerald-700', stripe: 'bg-emerald-600' },
  { text: 'text-purple-700', stripe: 'bg-purple-600' },
  { text: 'text-blue-700', stripe: 'bg-blue-600' },
  { text: 'text-orange-700', stripe: 'bg-orange-600' },
  { text: 'text-teal-700', stripe: 'bg-teal-600' },
  { text: 'text-red-700', stripe: 'bg-red-600' },
  { text: 'text-amber-700', stripe: 'bg-amber-600' },
];
export function groupColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

/** A table cell with monday's hairline grid. */
export function Cell({ children, className = '', pad = true }: { children?: ReactNode; className?: string; pad?: boolean }) {
  return <td className={`border-b border-r border-gray-200 align-middle ${pad ? 'px-2 py-1' : 'p-0'} ${className}`}>{children}</td>;
}
