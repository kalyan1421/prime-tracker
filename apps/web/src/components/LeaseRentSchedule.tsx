/**
 * LeaseRentSchedule — the rent timeline for a single lease.
 *
 * One table covers what would naively be three: the escalation SCHEDULE, the rent
 * HISTORY and the free-rent window. That mirrors the backend (`LeaseRentPeriod`),
 * and it is the point of the panel — a leasing manager should be able to read
 * "what we billed", "what we bill today" and "what we will bill" off one screen.
 *
 * Domain rules this UI has to respect (client-confirmed 2026-07-29):
 *  1. A period is a DATE RANGE, not a month. Free rent is ONE row spanning every
 *     abated month, never one row per month.
 *  2. Escalation COMPOUNDS and applies to baseRent, which is the whole of the rent.
 *     NNN is NOT here: it is charged once at signing (client-confirmed 2026-08-12)
 *     and lives on the lease's obligations, beside the security deposit.
 *  3. Past periods are IMMUTABLE. Even with canEdit there is no "edit row": the
 *     only writes are appending a manual period and re-cutting the future.
 *     The ONE exception is R22's correction, behind its own permission
 *     (`lease:history:correct`, held by nobody by default): a period that was RECORDED
 *     wrong can be corrected, and doing so preserves the old figure and flags the months
 *     already billed from it. That is a different act from "the rent changed", which is
 *     still an appended period — see the dialog copy, which says so out loud.
 *  4. `reason` is required on a manual period — blocked client-side, not left to
 *     the API's 400.
 *
 * MONEY IS A STRING. Prisma Decimal serialises to JSON as a string, so `+` would
 * concatenate ("0" + "500" === "0500"). Everything numeric goes through num().
 */

import { useMemo, useState } from 'react';
import {
  Button, Card, CardBody, Chip, Input, Textarea, Tooltip,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  useDisclosure, addToast,
} from '@heroui/react';
import {
  FiPlus, FiRefreshCw, FiZap, FiCalendar, FiTrendingUp,
  FiGift, FiEdit3, FiLock, FiInfo, FiAlertTriangle, FiTool,
} from 'react-icons/fi';
import {
  useLeaseRentPeriods, useLeaseRentSummary,
  useAddManualRentPeriod, useRegenerateFutureRentPeriods, useGenerateRentPeriods,
  useCorrectRentPeriod, useLeaseRentCorrections,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg, fmt, fmtPct, fmtDate } from '../utils/fmt';
import { StatCard, LoadingState, ErrorState, EmptyState } from './ui';
import { FormError } from './FormError';

// ─── types ────────────────────────────────────────────────────────────────────

type RentSource = 'INITIAL' | 'AUTO_ESCALATION' | 'MANUAL' | 'FREE_RENT';

interface RentPeriod {
  id: string;
  sequence: number;
  startDate: string;
  endDate: string | null;
  /** Decimal-as-string. Never do arithmetic on these without num(). */
  baseRent: string | number;
  monthlyRent: string | number;
  isFreeRent: boolean;
  escalationPct: string | number | null;
  source: RentSource;
  reason: string | null;
  createdAt: string;
}

interface RentSummary {
  termMonths: number;
  payingMonths: number;
  freeRentMonths: number;
  totalContractedRent: string | number;
  totalContractedBaseRent: string | number;
  effectiveMonthlyRent: string | number;
  effectiveMonthlyBaseRent: string | number;
  firstPayingMonth: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** The one safe door from Decimal-as-string to JS number. */
function num(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const MS_PER_DAY = 86_400_000;

/** Strip time-of-day so boundaries compare cleanly (server stores UTC days). */
function utcDay(d: string | Date): number {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

function todayUtcDay(): number {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
}

type Phase = 'past' | 'current' | 'future';

/** endDate is the INCLUSIVE last day of the period; null means "runs to lease end". */
function phaseOf(p: RentPeriod, today: number): Phase {
  const start = utcDay(p.startDate);
  if (start > today) return 'future';
  if (!p.endDate) return 'current';
  return utcDay(p.endDate) < today ? 'past' : 'current';
}

/**
 * Whole months + leftover days between an inclusive start and an inclusive end.
 * Clamped month stepping (Jan 31 + 1mo = Feb 28), matching the server's date maths.
 */
function durationLabel(start: string, end: string | null): string {
  if (!end) return 'to lease end';
  const s = new Date(utcDay(start));
  const endExclusive = utcDay(end) + MS_PER_DAY;

  let months = 0;
  for (;;) {
    const probe = addMonthsUtc(s, months + 1);
    if (probe > endExclusive) break;
    months += 1;
    if (months > 600) break; // paranoia: never spin on bad data
  }
  const days = Math.round((endExclusive - addMonthsUtc(s, months)) / MS_PER_DAY);

  if (months && days) return `${months} mo ${days} d`;
  if (months) return `${months} mo`;
  return `${days} d`;
}

function addMonthsUtc(d: Date, months: number): number {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay));
}

const SOURCE_META: Record<RentSource, { label: string; color: 'default' | 'primary' | 'secondary' | 'success' | 'warning'; icon: React.ReactNode }> = {
  INITIAL:         { label: 'Initial',    color: 'primary',   icon: <FiCalendar size={11} /> },
  AUTO_ESCALATION: { label: 'Escalation', color: 'secondary', icon: <FiTrendingUp size={11} /> },
  MANUAL:          { label: 'Manual',     color: 'warning',   icon: <FiEdit3 size={11} /> },
  FREE_RENT:       { label: 'Free rent',  color: 'success',   icon: <FiGift size={11} /> },
};

const EMPTY_MANUAL = {
  startDate: '',
  endDate: '',
  baseRent: '',
  reason: '',
};

// ─── component ────────────────────────────────────────────────────────────────

interface LeaseRentScheduleProps {
  leaseId: string;
  canEdit: boolean;
  /**
   * Why writing to this schedule is closed, when it is — e.g. the unit has been sold.
   * Distinct from `canEdit`, which is about the VIEWER's permission: this is about the
   * lease itself no longer being schedulable, so the reason is worth saying out loud
   * rather than just greying the buttons out.
   */
  lockedReason?: string | null;
}

export function LeaseRentSchedule({ leaseId, canEdit, lockedReason }: LeaseRentScheduleProps) {
  const periodsQ = useLeaseRentPeriods(leaseId);
  // The summary endpoint 400s on a lease with no periods (it cannot straight-line
  // nothing). That is expected on un-backfilled leases, so its error is swallowed
  // and only the periods query drives the error state.
  const summaryQ = useLeaseRentSummary(leaseId);

  const addManual = useAddManualRentPeriod();
  const regenFuture = useRegenerateFutureRentPeriods();
  const generate = useGenerateRentPeriods();

  const manualModal = useDisclosure();
  const regenModal = useDisclosure();

  // R22. Held by no role by default — Prime decides who gets it — so for almost every
  // user this whole branch is inert and the table reads exactly as it did before.
  const canCorrect = useAuthStore((st) => st.hasPermission('lease:history:correct'));
  const correct = useCorrectRentPeriod();
  const correctionsQ = useLeaseRentCorrections(leaseId);
  const corrections = (correctionsQ.data ?? []) as any[];
  const [correcting, setCorrecting] = useState<RentPeriod | null>(null);
  const [correctForm, setCorrectForm] = useState<Record<string, string>>({});
  const [correctErr, setCorrectErr] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, string>>(EMPTY_MANUAL);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [regenForm, setRegenForm] = useState<Record<string, string>>({ baseRent: '' });
  const [regenErr, setRegenErr] = useState<string | null>(null);

  const periods = (periodsQ.data ?? []) as RentPeriod[];
  const summary = summaryQ.data as RentSummary | undefined;

  const today = todayUtcDay();
  const correctedIds = useMemo(
    () => new Set(corrections.map((c: any) => c.periodId)),
    [corrections],
  );

  // The API returns periods ordered by `sequence`, and a manual mid-term period is
  // appended with the NEXT sequence — so sequence order is not chronological order.
  // A timeline has to read chronologically, hence the re-sort.
  const rows = useMemo(() => {
    return [...periods]
      .sort((a, b) => (utcDay(a.startDate) - utcDay(b.startDate)) || (a.sequence - b.sequence))
      .map((p) => ({ p, phase: phaseOf(p, today) }));
  }, [periods, today]);

  // Overlapping rows can both contain today (a manual period layered over a
  // generated one). The later sequence is the operative rent, so exactly one row
  // is marked "current" and the rest of the containing rows read as superseded.
  const currentId = useMemo(() => {
    const live = rows.filter((r) => r.phase === 'current');
    if (live.length === 0) return null;
    return live.reduce((best, r) => (r.p.sequence > best.p.sequence ? r : best), live[0]).p.id;
  }, [rows]);

  // ── mutations ───────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    try {
      await generate.mutateAsync({ leaseId });
      addToast({ title: 'Rent schedule generated', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to generate rent schedule'), color: 'danger' });
    }
  };

  const openManual = () => {
    setForm(EMPTY_MANUAL);
    setFormErr(null);
    manualModal.onOpen();
  };

  const handleAddManual = async () => {
    setFormErr(null);

    // reason is required by the domain, not just by the API — block here so the
    // user never sees a 400 for something we already know.
    if (!form.reason.trim()) {
      setFormErr('A reason is required — a mid-term rent change with no stated reason is not auditable.');
      return;
    }
    if (!form.startDate) {
      setFormErr('Start date is required.');
      return;
    }
    if (form.endDate && form.endDate < form.startDate) {
      setFormErr('End date cannot precede the start date.');
      return;
    }
    const baseRent = Number(form.baseRent);
    if (form.baseRent.trim() === '' || !Number.isFinite(baseRent) || baseRent < 0) {
      setFormErr('Base rent must be a number of 0 or more.');
      return;
    }

    try {
      await addManual.mutateAsync({
        leaseId,
        data: {
          startDate: form.startDate,
          // Omitted entirely (not null) so the API's whitelist is happy either way.
          ...(form.endDate ? { endDate: form.endDate } : {}),
          baseRent,
          // monthlyRent is intentionally not sent — the server mirrors baseRent,
          // which keeps the invariant monthlyRent === baseRent on it.
          reason: form.reason.trim(),
        },
      });
      addToast({ title: 'Rent change added', color: 'success' });
      manualModal.onClose();
      setForm(EMPTY_MANUAL);
    } catch (e) {
      setFormErr(errMsg(e, 'Failed to add rent change'));
    }
  };

  const openRegen = () => {
    setRegenForm({ baseRent: '' });
    setRegenErr(null);
    regenModal.onOpen();
  };

  const handleRegen = async () => {
    setRegenErr(null);
    const base = regenForm.baseRent.trim() === '' ? undefined : Number(regenForm.baseRent);
    if (base !== undefined && (!Number.isFinite(base) || base < 0)) {
      setRegenErr('Base rent must be a number of 0 or more.');
      return;
    }
    // regenerateFuture only rewrites periods that START in the future — anything
    // already running or finished is frozen so billed rent is never silently rewritten.
    // When no period starts after today it is a guaranteed no-op, and the API still
    // answers 201, so the old unconditional success toast claimed a change that never
    // happened. Say so instead, and point at the path that does work.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const hasFuturePeriod = periods.some((p) => new Date(p.startDate) > startOfToday);
    if (!hasFuturePeriod) {
      setRegenErr(
        'No period starts after today, so there is nothing to re-cut — periods already ' +
        'running or finished are frozen. To change the rent from a date, use ' +
        '"Add manual period" instead.',
      );
      return;
    }
    try {
      await regenFuture.mutateAsync({
        leaseId,
        data: {
          ...(base !== undefined ? { baseRent: base } : {}),
        },
      });
      addToast({ title: 'Future periods re-cut', color: 'success' });
      regenModal.onClose();
    } catch (e) {
      setRegenErr(errMsg(e, 'Failed to regenerate future periods'));
    }
  };

  const openCorrect = (p: RentPeriod) => {
    // Pre-filled with what is there now, so the person corrects a value rather than
    // reconstructing the row from memory and mistyping the parts they did not mean to
    // touch. The API rejects a body where nothing actually differs.
    setCorrectForm({
      baseRent: String(num(p.baseRent)),
      startDate: p.startDate.slice(0, 10),
      endDate: p.endDate ? p.endDate.slice(0, 10) : '',
      reason: '',
    });
    setCorrectErr(null);
    setCorrecting(p);
  };

  const submitCorrection = async () => {
    setCorrectErr(null);
    if (!correcting) return;
    if (correctForm.reason.trim().length < 10) {
      setCorrectErr('Say what was wrong and what it should be. This note is the only account of why a billed figure changed.');
      return;
    }
    const rent = Number(correctForm.baseRent);
    if (!Number.isFinite(rent) || rent < 0) {
      setCorrectErr('Base rent must be a number of 0 or more.');
      return;
    }
    // Only send what moved. Sending the whole row makes every field an assertion, and
    // the server then records unchanged values as part of the correction.
    const data: Record<string, any> = { reason: correctForm.reason.trim() };
    if (rent !== num(correcting.baseRent)) data.baseRent = rent;
    if (correctForm.startDate !== correcting.startDate.slice(0, 10)) {
      data.startDate = correctForm.startDate;
    }
    const currentEnd = correcting.endDate ? correcting.endDate.slice(0, 10) : '';
    if (correctForm.endDate !== currentEnd) {
      data.endDate = correctForm.endDate || null;
    }
    if (Object.keys(data).length === 1) {
      setCorrectErr('Nothing has been changed yet.');
      return;
    }
    try {
      const res = await correct.mutateAsync({ periodId: correcting.id, data });
      addToast({
        title: res.invoicesFlagged
          ? `Corrected — ${res.invoicesFlagged} already-billed month(s) flagged for Finance`
          : 'Period corrected',
        color: 'success',
      });
      setCorrecting(null);
    } catch (e) {
      setCorrectErr(errMsg(e, 'Failed to correct the period'));
    }
  };

  const set = (f: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [f]: e.target.value }));
  const setRegen = (f: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRegenForm((p) => ({ ...p, [f]: e.target.value }));

  // ── query states ────────────────────────────────────────────────────────────

  if (periodsQ.isLoading) return <LoadingState message="Loading rent schedule…" />;
  if (periodsQ.isError) {
    return <ErrorState message={errMsg(periodsQ.error, 'Failed to load the rent schedule')} />;
  }

  // ── modals (shared by the empty and populated branches) ─────────────────────

  const modals = (
    <>
      {/* R22 — correcting a period that was already billed. The copy leads with the
          distinction from "add a rent change", because choosing the wrong one of the two
          is the mistake that actually happens: one records history, the other rewrites it. */}
      <Modal isOpen={!!correcting} onClose={() => setCorrecting(null)} size="lg">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>Correct a billed period</span>
            <span className="text-xs font-normal text-gray-500">
              Only if this period was RECORDED wrong. If the rent genuinely changed from a
              date, close this and use “Add rent change” instead.
            </span>
          </ModalHeader>
          <ModalBody>
            <FormError message={correctErr} />
            <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              <FiAlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Months already invoiced from this period will be flagged for Finance — they
                are never restated automatically, because the invoice records what was
                actually billed. The previous value is kept on the record.
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1">
              <Input
                size="sm" type="number" label="Base rent / month"
                value={correctForm.baseRent ?? ''}
                onChange={(e) => setCorrectForm((f) => ({ ...f, baseRent: e.target.value }))}
              />
              <Input
                size="sm" type="date" label="Starts on"
                value={correctForm.startDate ?? ''}
                onChange={(e) => setCorrectForm((f) => ({ ...f, startDate: e.target.value }))}
              />
              <Input
                size="sm" type="date" label="Ends on"
                description="Blank = lease end"
                value={correctForm.endDate ?? ''}
                onChange={(e) => setCorrectForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </div>
            <Textarea
              size="sm"
              label="What was wrong?"
              description="Required. Finance reconciles the ledger against this note."
              minRows={2}
              value={correctForm.reason ?? ''}
              onValueChange={(v) => setCorrectForm((f) => ({ ...f, reason: v }))}
            />
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setCorrecting(null)}>Cancel</Button>
            <Button size="sm" color="warning" isLoading={correct.isPending} onPress={submitCorrection}>
              Record correction
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={manualModal.isOpen} onOpenChange={manualModal.onOpenChange} size="lg">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>Add a mid-term rent change</span>
            <span className="text-xs font-normal text-gray-500">
              Appends a NEW period from the date you pick. Nothing already billed is altered.
            </span>
          </ModalHeader>
          <ModalBody>
            <FormError message={formErr} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                size="sm" type="date" label="Starts on" isRequired
                value={form.startDate} onChange={set('startDate')}
              />
              <Input
                size="sm" type="date" label="Ends on"
                description="Leave blank to run to lease end"
                value={form.endDate} onChange={set('endDate')}
              />
              <Input
                size="sm" type="number" label="Base rent / month" isRequired
                placeholder="0.00"
                startContent={<span className="text-xs text-gray-400">$</span>}
                value={form.baseRent} onChange={set('baseRent')}
              />
            </div>
            <Input
              size="sm" label="Reason" isRequired
              placeholder="e.g. Negotiated COVID step-down, holdover rate, blend-and-extend"
              value={form.reason} onChange={set('reason')}
            />
            <p className="text-xs text-gray-500 flex items-start gap-1.5">
              <FiInfo size={12} className="shrink-0 mt-0.5" />
              Total monthly rent mirrors the base rent — NNN is charged once at signing and is
              tracked in the lease's obligations, not here.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={manualModal.onClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleAddManual} isLoading={addManual.isPending}>
              Add period
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={regenModal.isOpen} onOpenChange={regenModal.onOpenChange} size="md">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>Regenerate future periods</span>
            <span className="text-xs font-normal text-gray-500">
              Re-cuts every period that STARTS in the future from the lease's escalation terms.
              Past and in-flight periods are frozen.
            </span>
          </ModalHeader>
          <ModalBody>
            <FormError message={regenErr} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                size="sm" type="number" label="Base rent override"
                placeholder="Leave blank to keep"
                startContent={<span className="text-xs text-gray-400">$</span>}
                value={regenForm.baseRent} onChange={setRegen('baseRent')}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={regenModal.onClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleRegen} isLoading={regenFuture.isPending}>
              Regenerate
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );

  // ── empty: lease predates the generator ─────────────────────────────────────

  if (rows.length === 0) {
    return (
      <Card shadow="sm" className="border border-gray-100">
        <CardBody className="p-4">
          <EmptyState
            title="No rent schedule yet"
            message={
              canEdit
                ? 'This lease predates the rent timeline. Generate it from the lease terms — start, end, monthly rent, escalation and free-rent months.'
                : 'This lease predates the rent timeline and has no periods on file.'
            }
            action={canEdit ? (
              <Button size="sm" color="primary" startContent={<FiZap size={13} />}
                onPress={handleGenerate} isLoading={generate.isPending}>
                Generate schedule
              </Button>
            ) : undefined}
          />
        </CardBody>
      </Card>
    );
  }

  // ── populated ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Effective monthly rent"
            value={fmt(num(summary.effectiveMonthlyRent))}
            colorScheme="blue"
            helpText={`Straight-lined over ${summary.termMonths} mo`}
          />
          <StatCard
            label="Free rent"
            value={`${summary.freeRentMonths} mo`}
            colorScheme={num(summary.freeRentMonths) > 0 ? 'orange' : 'gray'}
            // Rounded: payingMonths is derived from a day count, so a part-month term
            // yields values like 12.032258. Six decimal places of a month is not a
            // number anyone reads — it just looks broken.
            helpText={`${Math.round(num(summary.payingMonths) * 10) / 10} paying months`}
          />
          <StatCard
            label="First paying month"
            value={summary.firstPayingMonth ? fmtDate(summary.firstPayingMonth) : '—'}
            colorScheme="teal"
            helpText={summary.firstPayingMonth ? 'Rent commencement' : 'Fully abated term'}
          />
          <StatCard
            label="Total contracted rent"
            value={fmt(num(summary.totalContractedRent))}
            colorScheme="green"
            helpText={`${fmt(num(summary.totalContractedBaseRent))} base`}
          />
        </div>
      )}

      <Card shadow="sm" className="border border-gray-100">
        <CardBody className="p-0">
          {/* Header + actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">Rent schedule &amp; history</p>
              <p className="text-xs text-gray-400">
                Escalation compounds on the base rent. NNN is a one-time charge at signing,
                tracked in this lease's obligations.
              </p>
            </div>
            {canEdit && (
              <div className="flex items-center gap-2 shrink-0">
                <Tooltip
                  content={lockedReason || 'Re-cut only the periods that start in the future'}
                  size="sm"
                >
                  {/* A disabled Button does not fire pointer events, so the Tooltip needs a
                      wrapper to hang off — otherwise the reason is unreachable exactly when
                      it matters. */}
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={<FiRefreshCw size={13} />}
                      onPress={openRegen}
                      isDisabled={!!lockedReason}
                    >
                      Regenerate future
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip content={lockedReason || 'Append a mid-term rent change'} size="sm">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      color="primary"
                      startContent={<FiPlus size={13} />}
                      onPress={openManual}
                      isDisabled={!!lockedReason}
                    >
                      Add rent change
                    </Button>
                  </span>
                </Tooltip>
              </div>
            )}
          </div>

          {lockedReason && (
            <div className="flex items-start gap-1.5 px-4 py-2 bg-amber-50 border-b border-amber-100">
              <FiLock className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">{lockedReason}</p>
            </div>
          )}

          {/* Legend — the past/current/future encoding is the whole point of the table */}
          <div className="flex flex-wrap items-center gap-4 px-4 py-2 bg-gray-50/70 border-b border-gray-100 text-[11px] text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-gray-300" /> Billed (locked)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> In effect today
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm border border-dashed border-gray-400" /> Scheduled
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[840px]">
              <thead>
                <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="text-left px-3 py-2 font-medium w-8">#</th>
                  <th className="text-left px-3 py-2 font-medium">Period</th>
                  <th className="text-left px-3 py-2 font-medium">Length</th>
                  <th className="text-right px-3 py-2 font-medium">Base rent</th>
                  <th className="text-right px-3 py-2 font-medium">Total / mo</th>
                  <th className="text-right px-3 py-2 font-medium">Escalation</th>
                  <th className="text-left px-3 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, phase }) => {
                  const isCurrent = p.id === currentId;
                  const isPast = phase === 'past';
                  const isFuture = phase === 'future';
                  const meta = SOURCE_META[p.source] ?? SOURCE_META.MANUAL;

                  const rowClass = isCurrent
                    ? 'bg-blue-50/80 border-l-[3px] border-l-blue-500'
                    : isPast
                    ? 'bg-white border-l-[3px] border-l-gray-200'
                    : 'bg-white border-l-[3px] border-l-transparent';

                  const textClass = isCurrent
                    ? 'text-gray-900 font-medium'
                    : isPast
                    ? 'text-gray-400'
                    : 'text-gray-700';

                  return (
                    <tr key={p.id} className={`border-t border-gray-100 ${rowClass}`}>
                      <td className={`px-3 py-2.5 tabular-nums ${isPast ? 'text-gray-300' : 'text-gray-400'}`}>
                        {p.sequence}
                      </td>

                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`whitespace-nowrap ${textClass}`}>
                            {fmtDate(p.startDate)} → {p.endDate ? fmtDate(p.endDate) : 'lease end'}
                          </span>
                          {isCurrent && (
                            <Chip size="sm" color="primary" variant="solid" className="h-5 text-[10px]">
                              In effect
                            </Chip>
                          )}
                          {isPast && (
                            <Tooltip content="Already billed — immutable" size="sm">
                              <span className="text-gray-300"><FiLock size={11} /></span>
                            </Tooltip>
                          )}
                          {correctedIds.has(p.id) && (
                            <Tooltip content="This period was corrected — see the trail below" size="sm">
                              <span className="text-amber-600"><FiTool size={11} /></span>
                            </Tooltip>
                          )}
                          {/* Only on rows that have actually been billed. Offering it on a
                              future period would compete with "Add rent change", which is
                              the right tool there. */}
                          {canCorrect && (isPast || isCurrent) && !p.isFreeRent && (
                            <button
                              type="button"
                              onClick={() => openCorrect(p)}
                              className="text-[10px] uppercase tracking-wide text-amber-700 hover:text-amber-900 underline decoration-dotted underline-offset-2"
                            >
                              Correct
                            </button>
                          )}
                          {isFuture && (
                            <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-dashed border-gray-300 rounded px-1.5 py-0.5">
                              Scheduled
                            </span>
                          )}
                        </div>
                        {p.reason && (
                          <p className={`mt-1 text-[11px] italic ${isPast ? 'text-gray-300' : 'text-gray-500'}`}>
                            {p.reason}
                          </p>
                        )}
                      </td>

                      <td className={`px-3 py-2.5 whitespace-nowrap ${isPast ? 'text-gray-300' : 'text-gray-500'}`}>
                        {durationLabel(p.startDate, p.endDate)}
                      </td>

                      <td className={`px-3 py-2.5 text-right tabular-nums ${textClass}`}>
                        {p.isFreeRent ? <span className="text-green-600">Abated</span> : fmt(num(p.baseRent))}
                      </td>

                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                        p.isFreeRent ? 'text-green-600' : isPast ? 'text-gray-400' : 'text-gray-900'
                      }`}>
                        {fmt(num(p.monthlyRent))}
                      </td>

                      <td className={`px-3 py-2.5 text-right tabular-nums ${isPast ? 'text-gray-300' : 'text-gray-500'}`}>
                        {p.escalationPct == null ? '—' : (
                          <span className={isPast ? '' : 'text-purple-600'}>{fmtPct(num(p.escalationPct))}</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5">
                        <Chip
                          size="sm" variant="flat"
                          color={p.isFreeRent ? 'success' : meta.color}
                          className={`h-5 text-[10px] ${isPast ? 'opacity-60' : ''}`}
                          startContent={<span className="ml-1">{p.isFreeRent ? <FiGift size={11} /> : meta.icon}</span>}
                        >
                          {p.isFreeRent ? 'Free rent' : meta.label}
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* The provenance trail. Renders only when something has been corrected, so a
              lease with a clean history says nothing at all rather than showing an empty
              "Corrections" heading that implies the feature is in use. */}
          {corrections.length > 0 && (
            <div className="border-t border-amber-100 bg-amber-50/40 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800 flex items-center gap-1.5">
                <FiTool size={11} />
                Corrections to billed rent ({corrections.length})
              </p>
              <ul className="mt-2 space-y-2">
                {corrections.map((c: any) => (
                  <li key={c.id} className="text-[11px] text-gray-700">
                    <span className="tabular-nums font-medium">
                      {fmt(num(c.previousRent))} → {fmt(num(c.correctedRent))}
                    </span>
                    {c.correctedStartDate && (
                      <span className="text-gray-500">
                        {' '}· starts {fmtDate(c.previousStartDate)} → {fmtDate(c.correctedStartDate)}
                      </span>
                    )}
                    {c.correctedEndDate && (
                      <span className="text-gray-500">
                        {' '}· ends {fmtDate(c.previousEndDate)} → {fmtDate(c.correctedEndDate)}
                      </span>
                    )}
                    <span className="text-gray-500">
                      {' '}· {fmtDate(c.createdAt)}
                      {c.correctedBy?.name ? ` by ${c.correctedBy.name}` : ''}
                    </span>
                    {c.invoicesFlagged > 0 && (
                      <span className="ml-1 text-amber-700">
                        · {c.invoicesFlagged} billed month(s) flagged
                      </span>
                    )}
                    <p className="italic text-gray-500 mt-0.5">“{c.reason}”</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {canEdit && (
            <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400 flex items-start gap-1.5">
              <FiLock size={11} className="shrink-0 mt-0.5" />
              Periods are append-only. To change rent, add a new period from the date the change takes
              effect — existing rows are never edited or deleted.
              {canCorrect && (
                <> A period recorded wrong can be corrected, which keeps the old figure and
                flags anything already billed from it.</>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {modals}
    </div>
  );
}
