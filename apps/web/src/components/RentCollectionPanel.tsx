/**
 * RentCollectionPanel — the monthly rent ledger on a lease.
 *
 * The mental model this UI has to protect (all server-enforced):
 *
 *  1. ONE ROW PER MONTH, GENERATED. Rows are never hand-created — the only
 *     creation affordance here is "Generate / update ledger", which backfills the
 *     months that are missing. It is append-only server-side: re-running it can
 *     neither duplicate a month nor stomp a payment already recorded.
 *
 *  2. FREE MONTHS ARE REAL ROWS AT $0. A rent-free month is billed deliberately
 *     at zero so a unit's payment history has no gaps. It is an ABATEMENT, not an
 *     unpaid month and not an error, and it is never styled like one. The API
 *     refuses a payment against it ("nothing to collect").
 *
 *  3. A PRORATED MONTH MUST BE EXPLAINABLE. Part months bill pro-rata by day
 *     count, so `billedDays`/`monthDays` is surfaced on the row itself ("17/31
 *     days") — a part-month charge has to be justifiable to a tenant without
 *     anyone recomputing it by hand.
 *
 *  4. `status` AND `amountPaid` ARE DERIVED SERVER-SIDE. Display only. There is
 *     no status picker anywhere in this file.
 *
 *  5. amountPaid REPLACES, never adds. Recording a payment sets the month's TOTAL
 *     collected — it is not a running tally of receipts. That is the single
 *     easiest way for a user to double-count, so the modal says so on every open.
 *
 *  6. Undo is `clearPayment`, not a zero payment: the API rejects an amount of 0
 *     and points at the clear path. Typing 0 in the form is therefore ROUTED to
 *     clearPayment (same outcome — amountPaid 0, status re-derived), with the
 *     substitution stated in the form before submit.
 *
 * MONEY IS A STRING: Prisma Decimal serialises to JSON as a string, so `+`
 * concatenates ("0" + "500" = "0500"). Every amount goes through `num()` before
 * arithmetic and `fmt()` for display.
 *
 * Every write is gated on `canCollect` (the `rent:collect` permission — NOT the
 * same as `lease:edit`; collecting money is a finance action, not an admin one).
 */

import { useMemo, useState } from 'react';
import {
  Button, Chip, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Progress, Select, SelectItem, Textarea, Tooltip, useDisclosure, addToast,
} from '@heroui/react';
import {
  FiAlertTriangle, FiCalendar, FiCheckCircle, FiCornerUpLeft, FiGift,
  FiRefreshCw, FiSlash, FiClock, FiInfo,
} from 'react-icons/fi';
import {
  useLeaseRentInvoices,
  useLeaseRentInvoiceSummary,
  useGenerateRentInvoices,
  useRecordRentPayment,
  useClearRentPayment,
  useClearInvoiceReview,
  useWaiveRentInvoice,
} from '../hooks/useApi';
import { errMsg, fmt, fmtDate } from '../utils/fmt';
import { LoadingState, ErrorState, EmptyState } from './ui';
import { FormError } from './FormError';

// ─── types (money fields arrive as strings — see file header) ─────────────────

type Money = string | number | null | undefined;

interface RentInvoice {
  id: string;
  leaseId: string;
  /** First day of the billed month, UTC midnight. The ledger key. */
  periodMonth: string;
  dueDate: string;
  amountDue: Money;
  amountPaid: Money;
  isProrated?: boolean;
  billedDays?: number | null;
  monthDays?: number | null;
  paidAt?: string | null;
  status: string;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** R22 — billed from a rent period that was corrected AFTER this invoice existed. */
  needsReview?: boolean;
  reviewReason?: string | null;
  recordedBy?: { id: string; name?: string | null; email?: string | null } | null;
}

interface RentSummary {
  invoiceCount?: number;
  billed?: Money;
  collected?: Money;
  outstanding?: Money;
  overdueCount?: number;
  /** Months billed from a period that was later corrected. Not a subset of overdue —
      a flagged month may be fully paid. */
  flaggedCount?: number;
}

// ─── money helpers ───────────────────────────────────────────────────────────

/** Decimal-as-string → number. NEVER sum raw API money values with `+`. */
function num(v: Money): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ─── status config ───────────────────────────────────────────────────────────
//
// FREE and WAIVED are deliberately NOT in the red/amber family: neither is a
// collection failure, and colouring them like one would train users to chase
// months nobody owes.

const STATUS_META: Record<string, {
  label: string;
  chip: string;
  accent: string;
  /** One line explaining what this row means, in plain collections language. */
  blurb: string;
}> = {
  DUE: {
    label: 'DUE',
    chip: 'bg-gray-100 text-gray-700 border-gray-200',
    accent: 'border-l-gray-300',
    blurb: 'Billed, nothing collected yet',
  },
  PARTIAL: {
    label: 'PARTIAL',
    chip: 'bg-blue-100 text-blue-700 border-blue-200',
    accent: 'border-l-blue-500',
    blurb: 'Part of the month collected',
  },
  PAID: {
    label: 'PAID',
    chip: 'bg-green-100 text-green-700 border-green-200',
    accent: 'border-l-green-500',
    blurb: 'Collected in full',
  },
  FREE: {
    label: 'FREE RENT',
    chip: 'bg-violet-100 text-violet-700 border-violet-200',
    accent: 'border-l-violet-400',
    blurb: 'Abated month — $0 billed on purpose, nothing owed',
  },
  WAIVED: {
    label: 'WAIVED',
    chip: 'bg-purple-100 text-purple-700 border-purple-200',
    accent: 'border-l-purple-400',
    blurb: 'Forgiven — no longer owed',
  },
};

function meta(status: string) {
  return STATUS_META[status] ?? STATUS_META.DUE;
}

const PAYMENT_METHODS = ['WIRE', 'CHECK', 'ACH', 'CASH', 'ADJUSTMENT'];

// ─── row predicates ──────────────────────────────────────────────────────────

/** Past due and still owing. FREE, PAID and WAIVED are never overdue. */
function isOverdue(inv: RentInvoice): boolean {
  if (inv.status !== 'DUE' && inv.status !== 'PARTIAL') return false;
  const due = new Date(inv.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  // Due TODAY is not yet overdue — matches the server rule exactly.
  return due.getTime() < startOfTodayUtc();
}

function startOfTodayUtc(): number {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}

/** A free month is a $0 row — the API refuses payments against it. */
function isFreeMonth(inv: RentInvoice): boolean {
  return inv.status === 'FREE' || num(inv.amountDue) <= 0;
}

function hasPayment(inv: RentInvoice): boolean {
  return num(inv.amountPaid) > 0 || !!inv.paidAt;
}

// ─── date helpers ────────────────────────────────────────────────────────────

const todayInput = () => new Date().toISOString().slice(0, 10);

/** periodMonth is UTC midnight on the 1st — format in UTC or it slips a month. */
function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function yearOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : String(d.getUTCFullYear());
}

// ─── filters ─────────────────────────────────────────────────────────────────

type FilterKey = 'ALL' | 'OVERDUE' | 'OPEN' | 'PAID' | 'ABATED';

/**
 * How many months the ledger shows before asking.
 *
 * Six is a half-year: enough to see the current run of payments and the shape of recent
 * behaviour, short enough that the summary tiles and the months needing action stay on
 * one screen. Anything older is history, and history is what the toggle is for.
 */
const COLLAPSED_MONTHS = 6;

const FILTERS: Array<{ key: FilterKey; label: string; test: (i: RentInvoice) => boolean }> = [
  { key: 'ALL', label: 'All months', test: () => true },
  { key: 'OVERDUE', label: 'Overdue', test: isOverdue },
  { key: 'OPEN', label: 'Outstanding', test: (i) => i.status === 'DUE' || i.status === 'PARTIAL' },
  { key: 'PAID', label: 'Paid', test: (i) => i.status === 'PAID' },
  { key: 'ABATED', label: 'Free & waived', test: (i) => i.status === 'FREE' || i.status === 'WAIVED' },
];

const EMPTY_PAYMENT = { amountPaid: '', paidAt: todayInput(), method: '', reference: '', notes: '' };

// ─── component ───────────────────────────────────────────────────────────────

interface RentCollectionPanelProps {
  leaseId: string;
  /** `rent:collect`. False → strictly read-only; no write control renders. */
  canCollect: boolean;
  /** Passed straight into mutation vars so the unit-level ledger invalidates. */
  unitId: string | undefined;
}

export function RentCollectionPanel({ leaseId, canCollect, unitId }: RentCollectionPanelProps) {
  const { data, isLoading, error } = useLeaseRentInvoices(leaseId);
  const { data: summaryData } = useLeaseRentInvoiceSummary(leaseId);

  const invoices = useMemo<RentInvoice[]>(
    () => (Array.isArray(data) ? (data as RentInvoice[]) : []),
    [data],
  );

  const generate = useGenerateRentInvoices();
  const recordPayment = useRecordRentPayment();
  const clearPayment = useClearRentPayment();
  const clearReview = useClearInvoiceReview();
  const waiveInvoice = useWaiveRentInvoice();

  // Both ids travel with every write — the unit's cross-lease payment timeline
  // goes stale otherwise.
  const scope = { leaseId, unitId };

  const generateModal = useDisclosure();
  const paymentModal = useDisclosure();
  const waiveModal = useDisclosure();

  const [target, setTarget] = useState<RentInvoice | null>(null);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [showAll, setShowAll] = useState(false);

  const [payForm, setPayForm] = useState<Record<string, string>>(EMPTY_PAYMENT);
  const [through, setThrough] = useState('');
  const [waiveReason, setWaiveReason] = useState('');

  const [payErr, setPayErr] = useState<string | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [waiveErr, setWaiveErr] = useState<string | null>(null);

  const setPay = (f: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setPayForm((p) => ({ ...p, [f]: e.target.value }));

  // ── derived ────────────────────────────────────────────────────────────────

  const summary = (summaryData ?? {}) as RentSummary;

  // Fall back to summing the rows when the summary call hasn't landed, using the
  // same rule as the server: a waived month leaves `billed`, but anything
  // actually collected against it still counts as money that moved.
  const totals = useMemo(() => {
    let billed = 0;
    let collected = 0;
    let overdueCount = 0;
    for (const inv of invoices) {
      if (inv.status !== 'WAIVED') billed += num(inv.amountDue);
      collected += num(inv.amountPaid);
      if (isOverdue(inv)) overdueCount++;
    }
    return {
      billed: summaryData ? num(summary.billed) : billed,
      collected: summaryData ? num(summary.collected) : collected,
      outstanding: summaryData ? num(summary.outstanding) : billed - collected,
      overdueCount: summaryData ? Number(summary.overdueCount ?? 0) : overdueCount,
    };
  }, [invoices, summaryData, summary.billed, summary.collected, summary.outstanding, summary.overdueCount]);

  const counts = useMemo(() => {
    const out: Record<FilterKey, number> = { ALL: 0, OVERDUE: 0, OPEN: 0, PAID: 0, ABATED: 0 };
    for (const f of FILTERS) out[f.key] = invoices.filter(f.test).length;
    return out;
  }, [invoices]);

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
    return invoices.filter(f.test);
  }, [invoices, filter]);

  /**
   * Progressive disclosure. A three-year lease is 36 rows, and 30 of them are settled
   * months nobody will ever look at again — they push the months that DO need action off
   * the screen.
   *
   * The collapsed set is the most RECENT months, not the first: rent is chased forward,
   * and the current month is the one being worked. Anything needing attention that falls
   * outside the window is counted on the toggle rather than silently hidden — a ledger
   * that conceals an overdue month is worse than a long one.
   */
  const shown = useMemo(() => {
    if (showAll || visible.length <= COLLAPSED_MONTHS) {
      return { rows: visible, hidden: 0, hiddenNeedingAttention: 0 };
    }
    const cut = visible.length - COLLAPSED_MONTHS;
    const hiddenRows = visible.slice(0, cut);
    return {
      rows: visible.slice(cut),
      hidden: cut,
      hiddenNeedingAttention: hiddenRows.filter((i) => isOverdue(i) || i.needsReview).length,
    };
  }, [visible, showAll]);

  /** Grouped by calendar year — a multi-year lease is otherwise a wall of rows. */
  const byYear = useMemo(() => {
    const groups: Array<{ year: string; rows: RentInvoice[]; billed: number; collected: number }> = [];
    for (const inv of shown.rows) {
      const y = yearOf(inv.periodMonth);
      let g = groups.find((x) => x.year === y);
      if (!g) {
        g = { year: y, rows: [], billed: 0, collected: 0 };
        groups.push(g);
      }
      g.rows.push(inv);
      if (inv.status !== 'WAIVED') g.billed += num(inv.amountDue);
      g.collected += num(inv.amountPaid);
    }
    return groups;
  }, [shown]);

  const collectedPct = totals.billed > 0
    ? Math.min(100, (totals.collected / totals.billed) * 100)
    : 0;

  // ── handlers ───────────────────────────────────────────────────────────────

  const openGenerate = () => {
    setThrough('');
    setGenErr(null);
    generateModal.onOpen();
  };

  const runGenerate = async () => {
    setGenErr(null);
    try {
      const before = invoices.length;
      const result = await generate.mutateAsync({
        ...scope,
        leaseId,
        data: through ? { through: new Date(through).toISOString() } : {},
      });
      const after = Array.isArray(result) ? result.length : before;
      const added = Math.max(0, after - before);
      addToast({
        title: added
          ? `Ledger updated — ${added} month${added === 1 ? '' : 's'} added`
          : 'Ledger already up to date',
        color: 'success',
      });
      generateModal.onClose();
    } catch (e) {
      setGenErr(errMsg(e, 'Failed to generate the rent ledger'));
    }
  };

  const openPayment = (inv: RentInvoice) => {
    setTarget(inv);
    setPayForm({
      ...EMPTY_PAYMENT,
      // Prefilled with the FULL month, because amountPaid is the month's total —
      // not the increment. Correcting a partial up means typing the new total.
      amountPaid: String(num(inv.amountDue)),
      paidAt: inv.paidAt ? new Date(inv.paidAt).toISOString().slice(0, 10) : todayInput(),
      method: inv.method ?? '',
      reference: inv.reference ?? '',
    });
    setPayErr(null);
    paymentModal.onOpen();
  };

  const savePayment = async () => {
    if (!target) return;
    setPayErr(null);

    const amount = Number(payForm.amountPaid);
    if (payForm.amountPaid.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      setPayErr('Enter an amount of zero or more.');
      return;
    }
    // The API accepts any date here — nothing stops "collected" being set in the
    // future, which reads as money that has not actually arrived yet.
    if (payForm.paidAt && payForm.paidAt > todayInput()) {
      setPayErr('Collected-on date cannot be in the future.');
      return;
    }

    try {
      // Zero is the "I keyed this wrong" case. The API rejects a zero payment and
      // points at the clear path, so route it there — same end state, one step.
      if (amount === 0) {
        await clearPayment.mutateAsync({ ...scope, invoiceId: target.id });
        addToast({ title: 'Payment cleared', color: 'success' });
      } else {
        await recordPayment.mutateAsync({
          ...scope,
          invoiceId: target.id,
          data: {
            amountPaid: amount,
            paidAt: payForm.paidAt ? new Date(payForm.paidAt).toISOString() : undefined,
            method: payForm.method || undefined,
            reference: payForm.reference || undefined,
            notes: payForm.notes || undefined,
          },
        });
        addToast({ title: 'Payment recorded', color: 'success' });
      }
      paymentModal.onClose();
    } catch (e) {
      setPayErr(errMsg(e, 'Failed to record payment'));
    }
  };

  const runClear = async (inv: RentInvoice) => {
    const label = monthLabel(inv.periodMonth);
    const question = inv.status === 'WAIVED'
      ? `Lift the waiver on ${label}? The month goes back to owing ${fmt(num(inv.amountDue))}.`
      : `Clear the ${fmt(num(inv.amountPaid))} recorded for ${label}? The month goes back to unpaid.`;
    if (!confirm(question)) return;
    try {
      await clearPayment.mutateAsync({ ...scope, invoiceId: inv.id });
      addToast({
        title: inv.status === 'WAIVED' ? 'Waiver lifted' : 'Payment cleared',
        color: 'success',
      });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to clear the entry'), color: 'danger' });
    }
  };

  /**
   * R22 — acknowledge a flagged month.
   *
   * No confirm(): this changes no money, it only records that somebody looked. Guarding
   * a harmless act behind a dialog trains people to click through the ones that matter.
   */
  const runClearReview = async (inv: RentInvoice) => {
    try {
      await clearReview.mutateAsync(inv.id);
      addToast({ title: `${monthLabel(inv.periodMonth)} marked reviewed`, color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to mark it reviewed'), color: 'danger' });
    }
  };

  const openWaive = (inv: RentInvoice) => {
    setTarget(inv);
    setWaiveReason('');
    setWaiveErr(null);
    waiveModal.onOpen();
  };

  const saveWaive = async () => {
    if (!target) return;
    setWaiveErr(null);
    // `reason` is REQUIRED by the API — block rather than round-trip a 400.
    if (!waiveReason.trim()) {
      setWaiveErr('A reason is required to waive a month of rent.');
      return;
    }
    try {
      await waiveInvoice.mutateAsync({
        ...scope,
        invoiceId: target.id,
        data: { reason: waiveReason.trim() },
      });
      addToast({ title: 'Month waived', color: 'success' });
      waiveModal.onClose();
    } catch (e) {
      setWaiveErr(errMsg(e, 'Failed to waive this month'));
    }
  };

  // ── states ─────────────────────────────────────────────────────────────────

  /**
   * The last month on the ledger, as "August 2026".
   *
   * Deliberately the MAX billed month rather than a count: "18 months" does not tell you
   * whether the ledger is current, and being current is the only question anyone asks of
   * it before pressing Generate.
   */
  const billedThrough = useMemo(() => {
    const months = invoices.map((i: any) => i.periodMonth).filter(Boolean).sort();
    if (months.length === 0) return null;
    return new Date(months[months.length - 1]).toLocaleDateString(undefined, {
      month: 'long', year: 'numeric',
    });
  }, [invoices]);

  if (isLoading) return <LoadingState message="Loading rent ledger…" />;
  if (error) return <ErrorState message={errMsg(error, 'Failed to load the rent ledger')} />;

  const generateButton = (
    <Button
      size="sm"
      color="primary"
      startContent={<FiRefreshCw size={14} />}
      onPress={openGenerate}
      isLoading={generate.isPending}
    >
      {invoices.length ? 'Generate / update ledger' : 'Generate ledger'}
    </Button>
  );

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Rent Collection</p>
          <p className="text-xs text-gray-500">
            One row per month, generated from the rent schedule — months are never added by hand
          </p>
          {/* What the ledger actually covers. Nothing said this before, so there was no
              way to tell whether "Generate ledger" had done anything, or how far a
              partly-generated ledger reached. */}
          {billedThrough && (
            <p className="text-xs text-gray-500 mt-0.5">
              Billed through <span className="font-medium text-gray-700">{billedThrough}</span>
            </p>
          )}
        </div>
        {canCollect && generateButton}
      </div>

      {/* Summary strip. Overdue is a count, not money: it answers "how many months
          am I chasing", which is the question that starts a collections call. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Billed" value={fmt(totals.billed)} hint={`${invoices.length} month${invoices.length === 1 ? '' : 's'} on the ledger`} />
        <SummaryTile label="Collected" value={fmt(totals.collected)} hint={`${Math.round(collectedPct)}% of billed`} tone="green" />
        <SummaryTile
          label={totals.outstanding < 0 ? 'Overpaid' : 'Outstanding'}
          value={fmt(Math.abs(totals.outstanding))}
          hint={totals.outstanding < 0 ? 'collected more than billed' : 'still to collect'}
          tone={totals.outstanding > 0 ? 'amber' : 'gray'}
        />
        <SummaryTile
          label="Overdue months"
          value={String(totals.overdueCount)}
          hint={totals.overdueCount ? 'past due and still owing' : 'nothing past due'}
          tone={totals.overdueCount ? 'red' : 'gray'}
          icon={totals.overdueCount ? <FiAlertTriangle size={12} /> : <FiCheckCircle size={12} />}
        />
      </div>

      {invoices.length > 0 && (
        <Progress
          size="sm"
          aria-label="Rent collected"
          value={collectedPct}
          color={totals.overdueCount ? 'warning' : 'success'}
        />
      )}

      {invoices.length === 0 ? (
        <EmptyState
          title="No rent ledger yet"
          message={
            canCollect
              ? 'Generate the ledger to bill every month from the lease start to today. Free-rent months are created too, at $0, so the payment history has no gaps.'
              : 'Nobody has generated this lease’s monthly rent ledger yet.'
          }
          action={canCollect ? generateButton : undefined}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const isOverdueFilter = f.key === 'OVERDUE' && counts.OVERDUE > 0;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => { setFilter(f.key); setShowAll(false); }}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : isOverdueFilter
                        ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {f.label} <span className={active ? 'text-gray-300' : 'text-gray-500'}>{counts[f.key]}</span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <EmptyState title="No months match this filter" />
          ) : (
            <div className="space-y-4">
              {byYear.map((g) => (
                <div key={g.year} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{g.year}</span>
                    <span className="text-[11px] text-gray-500">
                      {fmt(g.collected)} collected of {fmt(g.billed)} billed
                    </span>
                    <div className="h-px flex-1 bg-gray-100" />
                  </div>

                  {g.rows.map((inv) => (
                    <InvoiceRow
                      key={inv.id}
                      invoice={inv}
                      canCollect={canCollect}
                      onRecord={() => openPayment(inv)}
                      onClear={() => runClear(inv)}
                      onWaive={() => openWaive(inv)}
                      onReviewed={() => runClearReview(inv)}
                      busy={clearPayment.isPending || clearReview.isPending}
                    />
                  ))}
                </div>
              ))}

              {(shown.hidden > 0 || showAll) && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="group flex w-full items-center gap-3 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-left transition-colors hover:border-gray-300 hover:bg-gray-50"
                >
                  <span className="text-xs font-medium text-gray-600 group-hover:text-gray-900">
                    {showAll
                      ? `Show recent ${COLLAPSED_MONTHS} months`
                      : `Show all ${visible.length} months`}
                  </span>
                  {/* A hidden month somebody is chasing is the one thing collapsing must
                      never bury, so it is named on the control that would hide it. */}
                  {!showAll && shown.hiddenNeedingAttention > 0 && (
                    <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                      <FiAlertTriangle size={9} />
                      {shown.hiddenNeedingAttention} earlier need
                      {shown.hiddenNeedingAttention === 1 ? 's' : ''} attention
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-gray-500">
                    {showAll ? 'Collapse' : `${shown.hidden} earlier hidden`}
                  </span>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ── generate / update ledger ───────────────────────────────────────── */}
      <Modal isOpen={generateModal.isOpen} onClose={generateModal.onClose}>
        <ModalContent>
          <ModalHeader>{invoices.length ? 'Update rent ledger' : 'Generate rent ledger'}</ModalHeader>
          <ModalBody className="space-y-3">
            <FormError message={genErr} />
            <p className="text-sm text-gray-600">
              This bills every month from the lease start that isn’t on the ledger yet, using the
              rent schedule. Part months are prorated by day count, and rent-free months are created
              at $0 so the history has no gaps.
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
              <FiInfo size={13} className="mt-0.5 shrink-0 text-gray-400" />
              <span>
                Safe to re-run: existing months are never touched, so no payment already recorded
                can be overwritten or duplicated.
              </span>
            </div>
            <Input
              size="sm"
              type="date"
              label="Bill through"
              description="Leave blank to bill through today."
              value={through}
              onChange={(e) => setThrough(e.target.value)}
              startContent={<FiCalendar size={13} className="shrink-0 text-gray-400" />}
            />
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={generateModal.onClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={runGenerate} isLoading={generate.isPending}>
              {invoices.length ? 'Update ledger' : 'Generate ledger'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ── record payment ─────────────────────────────────────────────────── */}
      <Modal isOpen={paymentModal.isOpen} onClose={paymentModal.onClose} size="lg">
        <ModalContent>
          <ModalHeader>
            {target ? `Rent for ${monthLabel(target.periodMonth)}` : 'Record rent payment'}
          </ModalHeader>
          <ModalBody className="space-y-3">
            <FormError message={payErr} />

            {target && (
              <div className={`rounded-lg border-l-4 bg-gray-50 p-3 ${meta(target.status).accent}`}>
                <p className="text-xs font-semibold text-gray-800">
                  {fmt(num(target.amountDue))} due {fmtDate(target.dueDate)}
                </p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {fmt(num(target.amountPaid))} recorded so far · {meta(target.status).blurb.toLowerCase()}
                </p>
                {target.isProrated && (
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    Prorated: {target.billedDays ?? '—'} of {target.monthDays ?? '—'} days billed.
                  </p>
                )}
              </div>
            )}

            {/* The replace-not-add rule, stated every single time. */}
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <FiInfo size={13} className="mt-0.5 shrink-0" />
              <span>
                Enter the <strong>total collected for this month</strong>, not an extra payment on
                top. This figure replaces what is stored, so re-submitting can’t double-count.
              </span>
            </div>

            <Input
              size="sm"
              type="number"
              label="Total collected this month"
              placeholder="0.00"
              startContent={<span className="text-sm text-gray-500">$</span>}
              value={payForm.amountPaid}
              onChange={setPay('amountPaid')}
              description={
                Number(payForm.amountPaid) === 0 && payForm.amountPaid.trim() !== ''
                  ? 'Zero clears the recorded payment for this month and returns it to unpaid.'
                  : 'Overpayment is allowed — it lands on PAID.'
              }
            />
            <Input size="sm" type="date" label="Collected on" value={payForm.paidAt} onChange={setPay('paidAt')} />

            <Select
              size="sm"
              label="Method"
              placeholder="Select a method"
              selectedKeys={payForm.method ? [payForm.method] : []}
              onSelectionChange={(keys) => {
                const m = Array.from(keys)[0] as string;
                setPayForm((p) => ({ ...p, method: m ?? '' }));
              }}
            >
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} textValue={m}>{m}</SelectItem>
              ))}
            </Select>

            <Input
              size="sm"
              label="Reference"
              placeholder="Wire ref / cheque no."
              value={payForm.reference}
              onChange={setPay('reference')}
            />
            <Textarea size="sm" label="Notes" minRows={2} value={payForm.notes} onChange={setPay('notes')} />
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={paymentModal.onClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={savePayment}
              isLoading={recordPayment.isPending || clearPayment.isPending}
            >
              {Number(payForm.amountPaid) === 0 && payForm.amountPaid.trim() !== ''
                ? 'Clear payment'
                : 'Record payment'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ── waive ──────────────────────────────────────────────────────────── */}
      <Modal isOpen={waiveModal.isOpen} onClose={waiveModal.onClose}>
        <ModalContent>
          <ModalHeader>Waive {target ? monthLabel(target.periodMonth) : 'this month'}</ModalHeader>
          <ModalBody className="space-y-3">
            <FormError message={waiveErr} />
            <p className="text-sm text-gray-600">
              Waiving forgives{' '}
              <span className="font-semibold">{target ? fmt(num(target.amountDue)) : 'the amount'}</span>{' '}
              for this month — it leaves the billed total. Anything already collected stays on the
              row. The reason is appended to the month’s notes as the audit trail.
            </p>
            <Textarea
              size="sm"
              label="Reason"
              isRequired
              minRows={3}
              placeholder="e.g. Goodwill credit — HVAC outage for most of the month"
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={waiveModal.onClose}>Cancel</Button>
            <Button
              size="sm"
              color="warning"
              onPress={saveWaive}
              isDisabled={!waiveReason.trim()}
              isLoading={waiveInvoice.isPending}
            >
              Waive month
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function SummaryTile({
  label, value, hint, tone = 'gray', icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'gray' | 'green' | 'amber' | 'red';
  icon?: React.ReactNode;
}) {
  const tones = {
    gray: 'bg-white border-gray-200 text-gray-900',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    red: 'bg-red-50 border-red-200 text-red-800',
  } as const;
  return (
    <div className={`rounded-xl border p-3.5 ${tones[tone]}`}>
      <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide opacity-70">
        {icon}{label}
      </p>
      <p className="mt-1.5 text-xl font-semibold">{value}</p>
      {hint && <p className="text-[11px] opacity-60">{hint}</p>}
    </div>
  );
}

interface InvoiceRowProps {
  invoice: RentInvoice;
  canCollect: boolean;
  onRecord: () => void;
  onClear: () => void;
  onWaive: () => void;
  /** R22 — acknowledge that somebody looked at the discrepancy. Changes no money. */
  onReviewed: () => void;
  busy: boolean;
}

function InvoiceRow({ invoice: inv, canCollect, onRecord, onClear, onWaive, onReviewed, busy }: InvoiceRowProps) {
  const m = meta(inv.status);
  const due = num(inv.amountDue);
  const paid = num(inv.amountPaid);
  const open = due - paid;
  const overdue = isOverdue(inv);
  const free = isFreeMonth(inv);
  const waived = inv.status === 'WAIVED';
  /** Paid in full, nothing flagged — the row is history, and only corrections remain. */
  const settled = !free && !waived && paid > 0 && open <= 0 && !inv.needsReview;

  // Overdue overrides the status accent entirely — a month being chased must not
  // read as just another grey DUE row.
  const shell = overdue
    ? 'border-red-200 border-l-red-500 bg-red-50/60'
    : inv.needsReview
      ? 'border-amber-200 border-l-amber-400 bg-amber-50/40'
      : `border-gray-200 ${m.accent} bg-white`;

  /**
   * The two corrective controls for a settled month, rendered INSIDE the amount column.
   *
   * As a full-width row of their own they added ~28px of height and a band of dead space
   * to the left of them on every settled month — thirty-odd times over on a long ledger.
   * Beside the figure they correct, they cost nothing.
   */
  const settledActions = canCollect && settled ? (
    <div className="mt-1 flex items-center justify-end gap-0.5">
      <Button
        size="sm"
        variant="light"
        className="h-6 min-w-0 px-1.5 text-[11px] text-gray-500 data-[hover=true]:text-gray-900"
        onPress={onRecord}
      >
        Correct
      </Button>
      <Tooltip content="Clear the recorded payment" size="sm">
        <Button
          size="sm"
          variant="light"
          isIconOnly
          className="h-6 w-6 min-w-0 text-gray-300 data-[hover=true]:text-danger"
          isDisabled={busy}
          onPress={onClear}
          aria-label={`Clear the payment recorded for ${monthLabel(inv.periodMonth)}`}
        >
          <FiCornerUpLeft size={11} />
        </Button>
      </Tooltip>
    </div>
  ) : null;

  return (
    <div className={`rounded-xl border border-l-4 px-3.5 py-3 ${shell}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-semibold text-gray-900">{monthLabel(inv.periodMonth)}</p>
            <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${m.chip}`}>
              {free && !waived && <FiGift size={9} className="mr-1 inline align-[-1px]" />}
              {m.label}
            </span>
            {overdue && (
              <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">
                <FiAlertTriangle size={9} /> OVERDUE
              </span>
            )}
            {/* Amber, not red: this month is not being chased, it is being questioned.
                Reading as overdue would send somebody after a tenant who may owe nothing. */}
            {inv.needsReview && (
              <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                <FiAlertTriangle size={9} /> CHECK AMOUNT
              </span>
            )}
            {/* A prorated charge has to be defensible to a tenant on sight. */}
            {inv.isProrated && (
              <Tooltip
                size="sm"
                content={`Part month — billed ${inv.billedDays ?? '—'} of ${inv.monthDays ?? '—'} days at the monthly rate.`}
              >
                <span className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700">
                  <FiClock size={9} /> {inv.billedDays ?? '—'}/{inv.monthDays ?? '—'} days
                </span>
              </Tooltip>
            )}
          </div>

          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
            <FiCalendar size={10} />
            <span className={overdue ? 'font-semibold text-red-700' : ''}>Due {fmtDate(inv.dueDate)}</span>
            <span className="text-gray-300">·</span>
            <span>{m.blurb}</span>
          </p>

          {paid > 0 && (
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
              <span>Collected {fmtDate(inv.paidAt)}</span>
              {inv.method && <Chip size="sm" variant="flat" className="h-4 px-1 text-[11px]">{inv.method}</Chip>}
              {inv.reference && <span className="truncate text-gray-500">ref {inv.reference}</span>}
              {inv.recordedBy?.name && <span className="text-gray-500">by {inv.recordedBy.name}</span>}
            </p>
          )}

          {inv.needsReview && (
            <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-900">
              <p>{inv.reviewReason ?? 'The rent period this was billed from has since been corrected.'}</p>
              <p className="mt-1 text-amber-800">
                Nothing has been changed here — an invoice records what was actually billed.
                Re-issue, credit or leave it, then mark it reviewed.
              </p>
              {canCollect && (
                <Button
                  size="sm"
                  variant="flat"
                  className="mt-1.5 h-6 text-[11px]"
                  isDisabled={busy}
                  onPress={onReviewed}
                >
                  Mark reviewed
                </Button>
              )}
            </div>
          )}

          {inv.notes && (
            <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-600">
              {inv.notes}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          {/* A free month shows $0 as an intentional figure, never as a shortfall. */}
          <p className={`text-base font-semibold ${free ? 'text-violet-700' : 'text-gray-900'}`}>
            {free ? '$0' : fmt(due)}
          </p>
          {free ? (
            <p className="text-[11px] text-violet-600">rent abated</p>
          ) : waived ? (
            <p className="text-[11px] text-purple-600">not owed</p>
          ) : paid > 0 ? (
            <p className="text-[11px] text-gray-500">
              {fmt(paid)} collected
              {open > 0 && <span className={overdue ? 'text-red-700' : 'text-gray-600'}> · {fmt(open)} short</span>}
              {open < 0 && <span className="text-violet-700"> · {fmt(Math.abs(open))} over</span>}
            </p>
          ) : (
            <p className={`text-[11px] ${overdue ? 'font-semibold text-red-700' : 'text-gray-500'}`}>
              {fmt(due)} outstanding
            </p>
          )}
          {settledActions}
        </div>
      </div>

      {canCollect && !settled && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
          {/* Free months take no payment and no waiver — the API refuses both, and
              offering either would imply something is owed. */}
          {free && !waived && (
            <span className="mr-auto text-[11px] text-violet-600">Nothing to collect for this month.</span>
          )}

          {!free && !waived && (
            <Button size="sm" color="primary" variant="flat" className="h-7 min-w-0 px-2.5 text-[11px]" onPress={onRecord}>
              {paid > 0 ? 'Correct payment' : 'Record payment'}
            </Button>
          )}

          {!free && !waived && (
            <Tooltip content="Waive this month" size="sm">
              <Button
                size="sm"
                variant="light"
                isIconOnly
                className="h-7 w-7 min-w-0"
                onPress={onWaive}
                aria-label={`Waive ${monthLabel(inv.periodMonth)}`}
              >
                <FiSlash size={12} />
              </Button>
            </Tooltip>
          )}

          {/* clearPayment is the undo path for a mis-keyed entry, and the only way
              to lift a waiver. */}
          {(hasPayment(inv) || waived) && (
            <Button
              size="sm"
              variant="light"
              color="danger"
              className="h-7 min-w-0 px-2 text-[11px]"
              startContent={<FiCornerUpLeft size={12} />}
              isDisabled={busy}
              onPress={onClear}
            >
              {waived ? 'Lift waiver' : 'Clear payment'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
