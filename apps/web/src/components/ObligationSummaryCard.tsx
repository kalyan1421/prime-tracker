/**
 * ObligationSummaryCard — deposit / TI allowance rollup for a unit or a building.
 *
 *   <ObligationSummaryCard scope="unit"     id={unitId} />
 *   <ObligationSummaryCard scope="building" id={buildingId} />
 *
 * Answers one question first: "is the security deposit paid, and how much is left?"
 *
 * Three things this card is deliberately careful about, because getting any of
 * them wrong misrepresents money:
 *
 * 1. BUILDING-LEVEL MONEY IS NEVER PUSHED DOWN INTO UNITS. A lease signed on the
 *    building as a whole carries its own deposit; it is not apportioned across
 *    that building's units. The API returns three buckets (buildingLevel /
 *    unitLevel / combined) precisely so nothing is double-counted, and the
 *    building view keeps that split on screen instead of collapsing it into one
 *    number. `combined` is the only total shown as a total.
 *
 * 2. KINDS ARE NEVER SUMMED TOGETHER. SECURITY_DEPOSIT flows tenant → Prime and
 *    TI_ALLOWANCE flows Prime → tenant — opposite directions. Adding them would
 *    produce a number that means nothing, so every figure here is per-kind and
 *    the direction is labelled. (The API's top-level `totalAgreed` IS a cross-kind
 *    sum, which is why this card never renders it.)
 *
 * 3. PENDING CAN BE NEGATIVE. Overpayment is allowed by design (rounded wires,
 *    bundled deposit-plus-first-month cheques, FX), so a negative pending is a
 *    refund owed, not a broken number, and reads as "Overpaid / refund due".
 *
 * Money arrives as Prisma Decimal, which JSON-serializes to a STRING. Every value
 * goes through num() before any arithmetic — `0 + "500"` is `"0500"`.
 */

import { useState } from 'react';
import { Card, CardBody, CardHeader, Tooltip } from '@heroui/react';
import {
  FiShield, FiTool, FiMoreHorizontal, FiArrowDownLeft, FiArrowUpRight,
  FiHome, FiGrid, FiChevronDown, FiChevronRight, FiInbox,
} from 'react-icons/fi';
import { useUnitObligationSummary, useBuildingObligationSummary } from '../hooks/useApi';
import { fmt } from '../utils/fmt';
import { ErrorState } from './ui';

// ─── money ────────────────────────────────────────────────────────────────────

/** Decimals serialize as strings — coerce before ANY arithmetic. */
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Half-cent tolerance: Decimal(14,2) rounding shouldn't read as "still owed". */
const EPS = 0.005;

// ─── shapes ───────────────────────────────────────────────────────────────────

type Totals = { agreed: number; paid: number; pending: number };
type KindTotals = Totals & { kind: string; count: number };
type Bucket = Totals & { byKind: KindTotals[] };
type UnitRow = { unitId: string; unitNumber: string | null; byKind: KindTotals[] };

function totalsOf(raw: any): Totals {
  const agreed = num(raw?.totalAgreed);
  const paid = num(raw?.totalPaid);
  // Trust the server's pending when present; otherwise derive it the same way.
  const pending = raw?.totalPending != null ? num(raw.totalPending) : agreed - paid;
  return { agreed, paid, pending };
}

function kindsOf(raw: any): KindTotals[] {
  return (Array.isArray(raw?.byKind) ? raw.byKind : []).map((k: any) => ({
    kind: String(k?.kind ?? 'OTHER'),
    count: num(k?.count),
    ...totalsOf(k),
  }));
}

function bucketOf(raw: any): Bucket {
  return { ...totalsOf(raw), byKind: kindsOf(raw) };
}

const ZERO: Totals = { agreed: 0, paid: 0, pending: 0 };

const isEmptyTotals = (t: Totals) => Math.abs(t.agreed) < EPS && Math.abs(t.paid) < EPS;

// ─── kind config ──────────────────────────────────────────────────────────────

/** Deposit leads — it's the question this card exists to answer. */
const KIND_ORDER = ['SECURITY_DEPOSIT', 'TI_ALLOWANCE', 'OTHER'];

const KIND_META: Record<string, {
  label: string;
  direction: string;
  flow: 'in' | 'out' | 'none';
  icon: React.ReactNode;
  tint: string;   // icon chip
  bar: string;    // progress fill
}> = {
  SECURITY_DEPOSIT: {
    label: 'Security Deposit',
    direction: 'Tenant → Prime',
    flow: 'in',
    icon: <FiShield size={14} />,
    tint: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    bar: 'bg-emerald-500',
  },
  TI_ALLOWANCE: {
    label: 'TI Allowance',
    direction: 'Prime → Tenant',
    flow: 'out',
    icon: <FiTool size={14} />,
    tint: 'bg-amber-50 text-amber-700 border-amber-100',
    bar: 'bg-amber-500',
  },
  OTHER: {
    label: 'Other Obligation',
    direction: 'Mixed direction',
    flow: 'none',
    icon: <FiMoreHorizontal size={14} />,
    tint: 'bg-gray-50 text-gray-500 border-gray-200',
    bar: 'bg-gray-400',
  },
};

const metaFor = (kind: string) => KIND_META[kind] ?? {
  ...KIND_META.OTHER,
  label: kind.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
};

/** Union of kinds across the given buckets, deposit-first, unknown kinds last. */
function orderedKinds(...buckets: Bucket[]): string[] {
  const seen: string[] = [];
  for (const b of buckets) for (const k of b.byKind) if (!seen.includes(k.kind)) seen.push(k.kind);
  return seen.sort((a, b) => {
    const ai = KIND_ORDER.indexOf(a);
    const bi = KIND_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

const pick = (bucket: Bucket, kind: string): Totals =>
  bucket.byKind.find((k) => k.kind === kind) ?? ZERO;

const countOf = (bucket: Bucket, kind: string): number =>
  bucket.byKind.find((k) => k.kind === kind)?.count ?? 0;

// ─── settlement state ─────────────────────────────────────────────────────────

type Settlement = { key: 'settled' | 'partial' | 'unpaid' | 'refund' | 'none'; label: string; chip: string; dot: string };

/**
 * Paid-in-full vs part-paid vs unpaid, readable without the user doing any
 * arithmetic. Negative pending (overpayment) surfaces as a refund, not an error.
 */
function settlementOf(t: Totals): Settlement {
  if (t.pending < -EPS) {
    return { key: 'refund', label: 'Overpaid', chip: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500' };
  }
  if (isEmptyTotals(t)) {
    return { key: 'none', label: 'Nothing recorded', chip: 'bg-gray-100 text-gray-500', dot: 'bg-gray-300' };
  }
  if (t.pending <= EPS) {
    return { key: 'settled', label: 'Paid in full', chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' };
  }
  if (t.paid <= EPS) {
    return { key: 'unpaid', label: 'Unpaid', chip: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500' };
  }
  return { key: 'partial', label: 'Partly paid', chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' };
}

/** The one-line balance sentence: what's left, or what's owed back. */
function balanceLine(t: Totals): string | null {
  if (t.pending < -EPS) return `${fmt(Math.abs(t.pending))} refund due`;
  if (isEmptyTotals(t) || t.pending <= EPS) return null;
  return `${fmt(t.pending)} outstanding`;
}

const pctOf = (t: Totals): number => {
  if (t.agreed <= EPS) return t.paid > EPS ? 100 : 0;
  return Math.max(0, Math.min(100, (t.paid / t.agreed) * 100));
};

// ─── small pieces ─────────────────────────────────────────────────────────────

function StatusChip({ s }: { s: Settlement }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>
      {s.label}
    </span>
  );
}

function ProgressBar({ t, fill }: { t: Totals; fill: string }) {
  const pct = pctOf(t);
  const over = t.pending < -EPS;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div
        className={`h-full rounded-full transition-all ${over ? 'bg-sky-500' : fill}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** "$4,000 paid of $10,000" — always per-kind, never a cross-kind sum. */
function PaidOf({ t, className = '' }: { t: Totals; className?: string }) {
  return (
    <span className={`tabular-nums ${className}`}>
      <span className="font-semibold text-gray-900">{fmt(t.paid)}</span>
      <span className="text-gray-500"> paid of </span>
      <span className="font-medium text-gray-700">{fmt(t.agreed)}</span>
    </span>
  );
}

/**
 * One kind (deposit / TI / other) with its own headline, bar and status.
 * `children` carries the building-level vs unit-level split when there is one.
 */
function KindBlock({
  kind, totals, count, children,
}: {
  kind: string;
  totals: Totals;
  count: number;
  children?: React.ReactNode;
}) {
  const meta = metaFor(kind);
  const s = settlementOf(totals);
  const balance = balanceLine(totals);

  return (
    <div className="rounded-xl border border-gray-100 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${meta.tint}`}>
            {meta.icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-800">{meta.label}</p>
            <p className="flex items-center gap-1 text-[11px] text-gray-500">
              {meta.flow === 'in' && <FiArrowDownLeft size={10} className="text-emerald-500" aria-hidden />}
              {meta.flow === 'out' && <FiArrowUpRight size={10} className="text-amber-500" aria-hidden />}
              {meta.direction}
              {count > 0 && <span>· {count} {count === 1 ? 'obligation' : 'obligations'}</span>}
            </p>
          </div>
        </div>
        <StatusChip s={s} />
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <PaidOf t={totals} className="text-base" />
        {balance && (
          <span className={`shrink-0 text-xs font-medium tabular-nums ${s.key === 'refund' ? 'text-sky-600' : 'text-gray-500'}`}>
            {balance}
          </span>
        )}
      </div>
      <div className="mt-1.5">
        <ProgressBar t={totals} fill={meta.bar} />
      </div>

      {children}
    </div>
  );
}

/**
 * One leg of the building split. Rendered as its own labelled row so a
 * building-level deposit can never be read as if it belonged to the units.
 */
function SplitRow({
  icon, label, hint, totals,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  totals: Totals;
}) {
  const s = settlementOf(totals);
  const empty = s.key === 'none';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <Tooltip content={hint} placement="top">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${empty ? 'bg-gray-200' : s.dot}`} />
          {icon}
          <span className="truncate">{label}</span>
        </span>
      </Tooltip>
      {empty ? (
        <span className="shrink-0 text-xs text-gray-300">none</span>
      ) : (
        <PaidOf t={totals} className="shrink-0 text-xs" />
      )}
    </div>
  );
}

// ─── shells ───────────────────────────────────────────────────────────────────

function Shell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <Card shadow="sm">
      <CardHeader className="flex-col items-start gap-0 pb-0">
        <p className="text-sm font-semibold text-gray-700">Deposits &amp; Allowances</p>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/**
 * Empty state: one calm line, no zeros.
 *
 * A unit with no lease has no deposit story to tell, and a grid of "$0 / $0 /
 * $0" reads like money went missing rather than like nothing was ever agreed.
 * We still render the card shell (rather than returning null) so the card keeps
 * its slot in whatever layout the page puts it in, and so the user can tell
 * "nothing recorded" apart from "this section failed to load".
 */
function EmptyBody({ scope }: { scope: Scope }) {
  return (
    <div className="flex items-center gap-2.5 py-2 text-sm text-gray-500">
      <FiInbox size={16} className="shrink-0 text-gray-300" aria-hidden />
      <span>
        No security deposits or TI allowances recorded for this {scope}.
      </span>
    </div>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

type Scope = 'unit' | 'building';

export interface ObligationSummaryCardProps {
  scope: Scope;
  /** Unit id when scope="unit", building id when scope="building". */
  id?: string;
}

export function ObligationSummaryCard({ scope, id }: ObligationSummaryCardProps) {
  const isUnit = scope === 'unit';

  // Both hooks must be called every render (rules of hooks); the one that isn't
  // in scope gets `undefined` and stays disabled, so it never hits the network.
  const unitQuery = useUnitObligationSummary(isUnit ? id : undefined);
  const buildingQuery = useBuildingObligationSummary(isUnit ? undefined : id);
  const { data, isLoading, error } = isUnit ? unitQuery : buildingQuery;

  const subtitle = isUnit
    ? "Held against this unit's own leases."
    : 'Building-level and unit-level leases, kept separate.';

  if (!id || isLoading) {
    return (
      <Shell subtitle={subtitle}>
        {!id ? <EmptyBody scope={scope} /> : <div className="h-24 animate-pulse rounded-xl bg-gray-50" />}
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell subtitle={subtitle}>
        <ErrorState message="Could not load deposits and allowances." />
      </Shell>
    );
  }

  return (
    <Shell subtitle={subtitle}>
      {isUnit
        ? <UnitBody data={data} />
        : <BuildingBody data={data} />}
    </Shell>
  );
}

// ─── unit view ────────────────────────────────────────────────────────────────

function UnitBody({ data }: { data: unknown }) {
  const bucket = bucketOf(data);
  const kinds = orderedKinds(bucket);

  if (kinds.length === 0) return <EmptyBody scope="unit" />;

  return (
    <div className="space-y-2.5">
      {kinds.map((kind) => (
        <KindBlock key={kind} kind={kind} totals={pick(bucket, kind)} count={countOf(bucket, kind)} />
      ))}
    </div>
  );
}

// ─── building view ────────────────────────────────────────────────────────────

function BuildingBody({ data }: { data: unknown }) {
  const [showUnits, setShowUnits] = useState(false);

  const d = data as any;
  const buildingLevel = bucketOf(d?.buildingLevel);
  const unitLevel = bucketOf(d?.unitLevel);
  const combined = bucketOf(d?.combined);

  // `combined` already counts each obligation exactly once, so it is the total.
  const kinds = orderedKinds(combined, buildingLevel, unitLevel);

  const units: UnitRow[] = (Array.isArray(d?.unitLevel?.units) ? d.unitLevel.units : []).map((u: any) => ({
    unitId: String(u?.unitId ?? ''),
    unitNumber: u?.unitNumber ?? null,
    byKind: kindsOf(u),
  }));

  const hasBuildingLevel = !isEmptyTotals(buildingLevel);

  if (kinds.length === 0) return <EmptyBody scope="building" />;

  return (
    <div className="space-y-2.5">
      {kinds.map((kind) => {
        // Fall back to building + unit only if `combined` somehow lacks the kind.
        const fromCombined = combined.byKind.find((k) => k.kind === kind);
        const b = pick(buildingLevel, kind);
        const u = pick(unitLevel, kind);
        const total: Totals = fromCombined ?? {
          agreed: b.agreed + u.agreed,
          paid: b.paid + u.paid,
          pending: b.pending + u.pending,
        };
        const count = fromCombined?.count ?? countOf(buildingLevel, kind) + countOf(unitLevel, kind);

        return (
          <KindBlock key={kind} kind={kind} totals={total} count={count}>
            <div className="mt-2.5 divide-y divide-gray-50 border-t border-gray-100 pt-1">
              <SplitRow
                icon={<FiHome size={11} className="text-gray-400" aria-hidden />}
                label="Building-level lease"
                hint="Signed on the building as a whole. Held against the building — never split across its units."
                totals={b}
              />
              <SplitRow
                icon={<FiGrid size={11} className="text-gray-400" aria-hidden />}
                label="Unit leases"
                hint="Sum of leases signed on individual units inside this building."
                totals={u}
              />
            </div>
          </KindBlock>
        );
      })}

      {hasBuildingLevel && (
        <p className="px-0.5 text-[11px] leading-relaxed text-gray-500">
          A building-level deposit is held against the whole building and is never split across
          its units. The headline figures are the two rows added together, each obligation counted once.
        </p>
      )}

      {units.length > 0 && (
        <div className="rounded-xl border border-gray-100">
          <button
            type="button"
            onClick={() => setShowUnits((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-gray-600">
              {showUnits ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />}
              By unit
              <span className="font-normal text-gray-500">({units.length})</span>
            </span>
            <span className="text-[11px] text-gray-500">unit leases only</span>
          </button>

          {showUnits && (
            <div className="divide-y divide-gray-50 border-t border-gray-100">
              {units.map((u) => (
                <div key={u.unitId} className="px-3.5 py-2.5">
                  <p className="text-xs font-semibold text-gray-700">
                    {u.unitNumber ? `Unit ${u.unitNumber}` : 'Unit'}
                  </p>
                  <div className="mt-1 space-y-1">
                    {/* Per-kind lines only: a unit's deposit and its TI allowance
                        move in opposite directions and are never added together. */}
                    {orderedKinds({ ...ZERO, byKind: u.byKind }).map((kind) => {
                      const t = u.byKind.find((k) => k.kind === kind) ?? ZERO;
                      const s = settlementOf(t);
                      return (
                        <div key={kind} className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-500">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
                            <span className="truncate">{metaFor(kind).label}</span>
                          </span>
                          <PaidOf t={t} className="shrink-0 text-[11px]" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
