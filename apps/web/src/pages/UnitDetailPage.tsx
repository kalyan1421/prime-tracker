import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useState, useRef, useMemo, useEffect } from 'react';
import {
  Chip, Button, Avatar, Textarea, Select, SelectItem, Switch, Tooltip,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure, addToast,
} from '@heroui/react';
import { FiAlertTriangle, FiArrowLeft, FiSend, FiTrash2, FiMessageSquare, FiEdit2, FiTarget, FiMail, FiPhone, FiClock, FiFileText, FiDownload, FiHome, FiCreditCard, FiAlignLeft, FiCheck, FiX, FiUpload, FiEye, FiExternalLink, FiTrendingUp, FiChevronDown, FiChevronRight, FiDollarSign, FiLogOut, FiRepeat, FiLayers, FiCheckSquare, FiUsers, FiClipboard } from 'react-icons/fi';
import { useQueryClient } from '@tanstack/react-query';
import {
  useUnit, useUpdateUnit, useLeads, useDocuments,
  useUnitWaitlist, useCreateLead, useCreateLease, useUpdateLease, useCreateSale, useUploadDocument, useDeleteDocument,
  useRenameDocument, useReplaceDocument, useUnitFinancialSummary, useCustomOptions,
  useLeaseRentPeriods, useUnitObligationSummary, useAssignableUsers, useUnitHistory,
  useTasks,
  useLeaseRentInvoices, useBackfillTenancy, useAddSalePayment, useBrokers,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';

const COMMENT_TYPE_COLORS: Record<string, string> = {
  MARKETING: 'bg-purple-100 text-purple-700',
  SALES: 'bg-blue-100 text-blue-700',
  FINANCIAL: 'bg-green-100 text-green-700',
};
import { fmt, fmtDate, fmtPct, errMsg } from '../utils/fmt';
import { StatusBadge, LoadingState, ErrorState, PermissionGate } from '../components/ui';
import { TimeOnMarketBar } from '../components/TimeOnMarketBar';
import { UnitActivity } from '../components/UnitActivity';
import { InteriorPanel } from '../components/InteriorPanel';
import { SoldUnitPanel } from '../components/SoldUnitPanel';
import { LeaseRentSchedule } from '../components/LeaseRentSchedule';
import { LeaseObligationsPanel } from '../components/LeaseObligationsPanel';
import { EndTenancyDialog, AssignTenantDialog } from '../components/TenancyTransitionDialogs';
import { UnitConstructionPanel } from '../components/ConstructionBoard';
import { UnitConstructionChecklist } from '../components/UnitConstructionChecklist';
import { BackfillTenancyDialog } from '../components/BackfillTenancyDialog';
import {
  TenancyBackfillFields, useTenancyBackfillState,
  requiredBackfillFieldError, buildCollectionOverrides, backfillSuccessToast,
} from '../components/TenancyBackfillFields';
import { HistoricalRecordControls } from '../components/HistoricalRecordControls';
import { RentCollectionPanel } from '../components/RentCollectionPanel';
import { ObligationSummaryCard } from '../components/ObligationSummaryCard';
import { EMPTY_LEASE, validateLeaseForm, buildLeasePayload, LeaseFormFields, leaseToForm } from '../components/LeaseFormFields';
import {
  TENANTED_STATUSES, tenancyState, fmtChangeValue, changeDelta, summariseChanges,
} from '../utils/tenancy';


const UNIT_STATUSES = ['AVAILABLE', 'UNDER_CONTRACT', 'LEASED', 'SOLD', 'OCCUPIED', 'UNDER_CONSTRUCTION'];

// Single metric cell used inside the unified key-metrics strip.
/** Whole days a unit has been blocked, or null when it is not. */
function blockerDays(since?: string | null) {
  if (!since) return null;
  return Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
}

function Metric({ label, value, unit, accent, sub }: { label: string; value: string; unit?: string; accent?: string; sub?: string }) {
  return (
    <div className="p-4 sm:p-5">
      <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">{label}</p>
      <p className={`mt-1.5 text-xl sm:text-2xl font-bold tabular-nums ${accent ?? 'text-gray-900'}`}>
        {value}
        {unit && <span className="text-sm font-medium text-gray-500 ml-1">{unit}</span>}
      </p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * Consistent section card shell: tinted icon, title, optional right-side action/hint.
 *
 * `empty` collapses the card to its header alone. A card that spends ninety vertical
 * pixels, a centred icon and a border to say "No linked loans" is using real estate to
 * communicate an absence — and on this page four such cards sit in a two-column grid,
 * so the emptiest one used to set the height of the row it was in.
 */
function Section({
  icon, title, subtitle, count, action, children, empty, className = '', id, headerClassName = '',
}: {
  icon: React.ReactNode;
  title: string;
  /** One line under the title — for two sections whose names alone could be
   *  mistaken for each other (e.g. "Construction" vs. "Construction Checklist"). */
  subtitle?: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Short word for "there is nothing here" — e.g. "None". Collapses the body. */
  empty?: string | null;
  className?: string;
  /** DOM id so other pages (e.g. the Construction dashboard) can deep-link via #hash. */
  id?: string;
  /** Optional tint on the header strip — for a card sitting next to a same-named
   *  neighbor (e.g. "Construction" / "Construction Checklist"), so the two are
   *  distinguishable at a glance rather than only on reading the subtitle. */
  headerClassName?: string;
}) {
  if (empty) {
    return (
      <div id={id} className={`rounded-2xl border border-gray-200 bg-white overflow-hidden ${className}`}>
        <div className={`flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 ${headerClassName}`}>
          <div className="flex items-center gap-2.5">
            {icon}
            <div>
              <h2 className="font-semibold text-sm text-gray-800">{title}</h2>
              {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{empty}</span>
            {action}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div id={id} className={`rounded-2xl border border-gray-200 bg-white overflow-hidden ${className}`}>
      <div className={`flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3 ${headerClassName}`}>
        <div className="flex items-center gap-2.5">
          {icon}
          <div>
            <h2 className="font-semibold text-sm text-gray-800">
              {title}
              {count != null && count > 0 && <span className="text-gray-500 font-normal ml-1">({count})</span>}
            </h2>
            {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </div>
  );
}

// Label/value row used inside detail lists.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

// Compact, centered empty state for a section body.
function EmptyRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-gray-300">
      {icon}
      <p className="text-sm text-gray-500">{text}</p>
    </div>
  );
}

// ---- Section jump rail ----
// The page below is 8+ heterogeneous sections deep with no way to reach the bottom
// ones (Documents, Comments) short of scrolling past everything else, every time. This
// is a sticky wayfinding strip, not route tabs: every section still renders on the same
// URL, so the existing #construction-checklist deep link from the Construction
// dashboard — and any other, present or future — keeps working exactly as before.
const SECTION_NAV_ITEMS = [
  { id: 'section-overview', label: 'Overview' },
  { id: 'construction-checklist', label: 'Checklist' },
  { id: 'section-history', label: 'History' },
  { id: 'section-notes', label: 'Notes' },
  { id: 'section-leads', label: 'Leads' },
  { id: 'section-interior', label: 'Interior' },
  { id: 'section-documents', label: 'Documents' },
  { id: 'section-activity', label: 'Activity' },
] as const;

function SectionNav({ constructionFirst = false }: { constructionFirst?: boolean }) {
  const [presentIds, setPresentIds] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);

  // Which sections actually rendered is a function of permissions and whether there is
  // anything to show (e.g. Notes only renders with content or edit rights, Interior
  // only behind a permission gate) — logic that already lives at each section's own
  // render site. Asking the DOM what exists, once mounted, is simpler and can't drift
  // out of sync with that logic the way re-deriving every gate a second time here would.
  useEffect(() => {
    const found = SECTION_NAV_ITEMS.map((it) => it.id).filter((id) => document.getElementById(id));
    setPresentIds(found);
  }, []);

  useEffect(() => {
    if (presentIds.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        );
        setActive(topmost.target.id);
      },
      { rootMargin: '-104px 0px -70% 0px', threshold: 0 },
    );
    presentIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [presentIds]);

  const orderedItems = constructionFirst
    ? [
        ...SECTION_NAV_ITEMS.filter((it) => it.id === 'construction-checklist' || it.id === 'section-activity'),
        ...SECTION_NAV_ITEMS.filter((it) => it.id !== 'construction-checklist' && it.id !== 'section-activity'),
      ]
    : [...SECTION_NAV_ITEMS];

  if (presentIds.length < 2) return null;

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <div className="sticky top-14 z-20 mb-5 sm:mb-6 -mx-1 px-1 py-2 overflow-x-auto">
      <div className="flex gap-1 bg-white/95 backdrop-blur border border-gray-200 rounded-full px-1.5 py-1.5 w-max shadow-sm">
        {/* The pills must follow the page, not the constant: for a construction-first
            viewer Checklist and Activity are rendered above the overview, and a nav that
            still led with Overview would jump the reader backwards. */}
        {orderedItems.filter((it) => presentIds.includes(it.id)).map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => jump(it.id)}
            aria-current={active === it.id ? 'true' : undefined}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              active === it.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Unit History timeline ----
// Renders GET /units/:id/history. This used to be derived here on the client from the
// lease and sale arrays, inferring vacancy from the gap between two ENDED leases. That
// could not see three things: the vacancy BEFORE the first lease, the vacancy happening
// RIGHT NOW (no later lease to measure against), and any vacancy on a unit that never
// had a lease at all. The server reads those from the unit_status_events log instead,
// so the clock comes from recorded transitions and only the narrative comes from
// lease/sale rows.

function durationLabel(startISO: string, endISO: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  months = Math.max(0, months);
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (rem > 0 || years === 0) parts.push(`${rem} month${rem === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/** Compact "1 yr 2 mo" / "45 days" for a day count. */
function daysLabel(days: number): string {
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years} yr ${rem} mo` : `${years} year${years === 1 ? '' : 's'}`;
}

const DOT_CLASS: Record<string, string> = {
  vacancy: 'bg-gray-300',
  status: 'bg-amber-400',
  free_rent: 'bg-purple-400',
  fit_out: 'bg-orange-300',
  lease_change: 'bg-indigo-400',
  // Rose reads as an ending without reading as an error — an expiry is routine, and a
  // red dot on every completed tenancy would make a normal history look alarming.
  tenancy_end: 'bg-rose-400',
  assignment: 'bg-violet-500',
};

function entryDot(e: any): string {
  if (e.kind === 'sale') {
    if (e.data?.status === 'CLOSED') return 'bg-emerald-500';
    if (e.data?.status === 'CANCELLED') return 'bg-gray-300';
    return 'bg-amber-400';
  }
  if (e.kind === 'lease') return e.isOngoing ? 'bg-blue-500' : 'bg-gray-400';
  // A scheduled escalation was agreed at signing; a manual change was a decision
  // someone made later. Only the second one is worth anyone's attention.
  if (e.kind === 'rent_change') return e.data?.isScheduled ? 'bg-teal-300' : 'bg-teal-600';
  return DOT_CLASS[e.kind] ?? 'bg-gray-300';
}

/** Rent movements are the noisy entries — a 5-year lease escalating annually adds 5. */
const RENT_KINDS = ['rent_change', 'free_rent'];

/**
 * Lifetime totals above the timeline. Vacant/leased days are the numbers the client
 * asked for ("age unit history whenever unit was available to lease") and are only
 * answerable from the event log — `availableSince` is wiped on every status change.
 */
function UnitHistorySummary({ summary }: { summary: any }) {
  if (!summary) return null;

  // Day totals are only as old as the occupancy log. On a unit whose only event is the
  // migration bootstrap row, "total leased: 21 days" sitting beside a tenancy that ran
  // from 2020 reads as a bug rather than as a gap in the record — so when the log has
  // nothing but that bootstrap row, the two day tiles say what they are measured from.
  // Inferring the missing days from the lease dates would be the same guesswork the
  // event log exists to replace; entering the history (H2) is the real fix.
  const partial = !!summary.historyStartsAtBootstrap;
  const since = partial ? `since ${fmtDate(summary.firstEventAt)}` : null;

  // The API nulls lifetimeRentCollected/lifetimeSaleProceeds for a caller without
  // lease:view/sales:view (see UnitHistoryService.getHistory) — that's the signal to
  // hide the tile, not `?? 0`, which would show a real-looking "$0" for data that's
  // actually just hidden from this role.
  const tiles = [
    { label: 'Total vacant', value: daysLabel(summary.totalDaysVacant ?? 0), tone: 'text-gray-700', note: since },
    { label: 'Total leased', value: daysLabel(summary.totalDaysLeased ?? 0), tone: 'text-emerald-700', note: since },
    { label: 'Tenancies', value: String(summary.tenancyCount ?? 0), tone: 'text-gray-700', note: null },
    ...(summary.lifetimeRentCollected != null
      ? [{ label: 'Rent collected', value: fmt(summary.lifetimeRentCollected), tone: 'text-emerald-700', note: null }]
      : []),
  ];
  return (
    <div className="mb-4">
      {/* Data problems the timeline cannot fix and must not hide — most importantly a
          unit marked SOLD that still carries an ACTIVE lease, which keeps the rent
          invoice cron billing a tenant on a unit Prime no longer owns. */}
      {(summary.dataWarnings ?? []).length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          {summary.dataWarnings.map((w: string, i: number) => (
            <p key={i} className="text-xs text-amber-800 flex items-start gap-1.5">
              <FiAlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t.label}</p>
            <p className={`text-sm font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
            {t.note && <p className="text-[11px] text-amber-700 mt-0.5">{t.note}</p>}
          </div>
        ))}
      </div>
      {summary.isCurrentlyVacant && (
        <p className="text-xs text-amber-700 mt-2 flex items-center gap-1.5">
          <FiClock className="w-3.5 h-3.5 shrink-0" />
          On the market {daysLabel(summary.currentVacancyDays ?? 0)} — since {fmtDate(summary.vacantSince)}
        </p>
      )}
      {summary.historyStartsAtBootstrap && (
        // Be honest about what the record can and cannot show. Everything this unit
        // has is the migration bootstrap row, so its timeline begins when tracking
        // began, not when the unit did.
        <p className="text-xs text-gray-500 mt-2">
          Tracked history begins {fmtDate(summary.firstEventAt)} — earlier activity was never recorded.
          {' '}Add it with a historical record.
        </p>
      )}
    </div>
  );
}

/**
 * The delete control for one backfilled row of the timeline.
 *
 * Until this existed the only way to remove a backfilled record was the Rent History
 * section (leases) or the sold-unit panel (sales) — and the latter renders only the
 * FIRST closed sale, so a unit that was imported twice had duplicate rows on this
 * timeline that no screen could delete. The timeline is where duplicates are actually
 * noticed, so the control belongs on the row that shows the problem.
 *
 * A live record is deliberately left alone here: it is edited or ended through its own
 * card, where the consequences (ledger, unit status) are visible. Only the unregenerable
 * hand-entered ones get an erase button, and that button still goes through the Founder
 * gate — this widens who can *reach* the flow, not who can decide.
 */
function HistoricalEntryDelete({ entry }: { entry: any }) {
  if (!entry?.isHistorical) return null;
  const id = entry.kind === 'lease' ? entry.data?.leaseId : entry.data?.saleId;
  if (!id) return null;

  return (
    <HistoricalRecordControls
      variant="inline"
      record={{
        kind: entry.kind,
        id,
        label: entry.title,
        dateRangeLabel: entry.isOngoing
          ? `${fmtDate(entry.startDate)} – present`
          : [fmtDate(entry.startDate), entry.endDate ? fmtDate(entry.endDate) : null]
            .filter(Boolean).join(' – '),
      }}
    />
  );
}

function UnitHistoryTimeline({ unitId }: { unitId: string | undefined }) {
  const { data, isLoading, error } = useUnitHistory(unitId);
  const [showRent, setShowRent] = useState(true);

  if (isLoading) return <LoadingState message="Loading history…" />;
  if (error) return <ErrorState message={errMsg(error, 'Failed to load unit history')} />;

  const all: any[] = data?.entries ?? [];
  if (all.length === 0) {
    return <EmptyRow icon={<FiClock className="w-5 h-5" />} text="No history yet" />;
  }

  // Rent movements can outnumber everything else on a long tenancy, so the timeline
  // has to still be readable as "who was here and when" with them switched off.
  const hasRentEntries = all.some((e) => RENT_KINDS.includes(e.kind));
  const entries = showRent ? all : all.filter((e) => !RENT_KINDS.includes(e.kind));

  return (
    <div>
      <UnitHistorySummary summary={data?.summary} />
      {hasRentEntries && (
        <div className="flex justify-end mb-3">
          <button
            type="button"
            onClick={() => setShowRent((v) => !v)}
            aria-pressed={showRent}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              showRent
                ? 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100'
                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            {showRent ? 'Hide rent changes' : 'Show rent changes'}
          </button>
        </div>
      )}
      {entries.map((e, i) => (
        <div key={e.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${entryDot(e)}`} />
            {i < entries.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1 mb-1" />}
          </div>
          <div className={`min-w-0 flex-1 ${i < entries.length - 1 ? 'pb-4' : ''}`}>
            {e.kind === 'lease' && (
              <>
                <p className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                  {e.title}
                  {e.isOngoing && (
                    <span className="text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      Current
                    </span>
                  )}
                  {/* isHistorical means "entered by hand from records," not "this tenancy
                      has ended" — those are independent facts. A lease can be both
                      backfilled AND still running today, so pair it with "Current"
                      instead of contradicting it. */}
                  {e.isHistorical && (
                    <span
                      className="text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500"
                      title="Entered by hand from records, not recorded live"
                    >
                      {e.isOngoing ? 'Backfilled' : 'Historical'}
                    </span>
                  )}
                  <HistoricalEntryDelete entry={e} />
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.startDate)} – {e.isOngoing ? 'present' : fmtDate(e.endDate)}
                  {' · '}{fmt(e.data.monthlyRent)}/mo
                  {e.data.rentPerSqft != null && ` · ${fmt(e.data.rentPerSqft)}/sqft`}
                </p>
                {/* R8 — a historical lease that spanned more than one physical unit
                    (e.g. two adjacent retail suites leased as one deal). */}
                {e.data.combinedWithUnits?.length > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Leased together with unit{e.data.combinedWithUnits.length > 1 ? 's' : ''} {e.data.combinedWithUnits.join(', ')}
                  </p>
                )}
                {/* Contracted vs collected, per tenancy — the question "what did this
                    unit actually earn from this tenant" needs both halves. */}
                {(e.data.contracted > 0 || e.data.collected > 0) && (
                  <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                    Collected {fmt(e.data.collected)} of {fmt(e.data.contracted)}
                    {e.data.outstanding > 0 && (
                      <span className="text-amber-700"> · {fmt(e.data.outstanding)} outstanding</span>
                    )}
                  </p>
                )}
                {!e.isOngoing && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Lease {String(e.data.status).toLowerCase()} · {durationLabel(e.startDate, e.endDate)}
                  </p>
                )}
              </>
            )}
            {e.kind === 'sale' && (
              <>
                <p className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                  {e.title}
                  {e.isHistorical && (
                    <span className="text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                      Historical
                    </span>
                  )}
                  <HistoricalEntryDelete entry={e} />
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.startDate)}
                  {e.data.salePrice != null && ` · ${fmt(e.data.salePrice)}`}
                </p>
                {e.data.status === 'CANCELLED' && e.data.lostReason && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Reason: {String(e.data.lostReason).replace(/_/g, ' ')}
                  </p>
                )}
              </>
            )}
            {e.kind === 'vacancy' && (
              <p className="text-sm text-gray-500 italic">
                {e.isOngoing ? (
                  <>Vacant since {fmtDate(e.startDate)} · {daysLabel(e.durationDays)} and counting</>
                ) : (
                  <>Vacant · {fmtDate(e.startDate)} – {fmtDate(e.endDate)} · {daysLabel(e.durationDays)}</>
                )}
              </p>
            )}
            {e.kind === 'status' && (
              <p className="text-sm text-gray-500">
                {e.title}
                <span className="text-xs text-gray-500">
                  {' · '}{fmtDate(e.startDate)}
                  {e.endDate ? ` – ${fmtDate(e.endDate)}` : ' – present'}
                </span>
              </p>
            )}
            {e.kind === 'rent_change' && (
              <>
                <p className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                  {e.title}
                  <span
                    className={`text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${
                      e.data.isScheduled ? 'bg-gray-100 text-gray-500' : 'bg-teal-100 text-teal-700'
                    }`}
                  >
                    {e.data.isScheduled ? 'Scheduled' : 'Manual'}
                  </span>
                  {/* The schedule is generated for the whole term, so most rows are
                      still ahead. Saying so keeps a "History" panel from asserting
                      future rent as though it had already been charged. */}
                  {e.isProjected && (
                    <span className="text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">
                      Upcoming
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                  {fmtDate(e.startDate)}
                  {' · '}{fmt(e.data.from)} → {fmt(e.data.to)}/mo
                  <span className={e.data.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                    {' '}({e.data.delta >= 0 ? '+' : '−'}{fmt(Math.abs(e.data.delta))})
                  </span>
                  {e.data.escalationPct != null && ` · ${fmtPct(e.data.escalationPct)}`}
                </p>
                {e.data.reason && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {e.data.reason}
                    {e.data.changedBy?.name && ` — ${e.data.changedBy.name}`}
                  </p>
                )}
              </>
            )}
            {e.kind === 'lease_change' && (
              <>
                <p className="text-sm font-medium text-gray-900">{e.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.startDate)}
                  {e.data.changedBy?.name && ` · ${e.data.changedBy.name}`}
                  {/* What changed, in the header — so the timeline is readable at a
                      glance without reading every row underneath it. */}
                  {summariseChanges(e.data.changes) && (
                    <span className="text-gray-500"> · {summariseChanges(e.data.changes)}</span>
                  )}
                </p>
                {/* Field-by-field, because "the lease was edited" is not an answer to
                    "what changed". Each row also says what the change MEANT — the
                    reader was going to do that arithmetic themselves otherwise. */}
                <ul className="mt-1.5 space-y-1">
                  {(e.data.changes ?? []).map((c: any, i: number) => {
                    const delta = changeDelta(c);
                    return (
                      <li key={i} className="text-xs leading-snug">
                        <span className="text-gray-600">{c.label}</span>
                        <span className="tabular-nums">
                          <span className="text-gray-500"> {fmtChangeValue(c.from, c.type)}</span>
                          <span className="text-gray-300"> → </span>
                          <span className="text-gray-800 font-medium">{fmtChangeValue(c.to, c.type)}</span>
                        </span>
                        {delta && (
                          <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 tabular-nums">
                            {delta}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {e.kind === 'fit_out' && (
              <>
                <p className="text-sm font-medium text-orange-800">{e.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.startDate)} – {fmtDate(e.endDate)} · {daysLabel(e.durationDays)}
                  {' · '}signed, rent starts {fmtDate(e.data.rentStartDate)}
                </p>
              </>
            )}
            {e.kind === 'free_rent' && (
              <>
                <p className="text-sm font-medium text-purple-800">{e.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.startDate)} – {fmtDate(e.endDate)} · {daysLabel(e.durationDays)} at no rent
                  {e.data.forgoneMonthlyRent != null &&
                    ` · ${fmt(e.data.forgoneMonthlyRent)}/mo abated`}
                </p>
              </>
            )}
            {e.kind === 'tenancy_end' && (
              <>
                <p className="text-sm font-medium text-rose-800">{e.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.startDate)}
                  {/* The gap between when they left and when the contract said they
                      would is the early-termination exposure — the number someone
                      opening this page is most likely looking for. */}
                  {e.data.daysEarly > 0 && (
                    <span className="text-rose-700">
                      {' · '}{daysLabel(e.data.daysEarly)} early (term ran to {fmtDate(e.data.contractedEnd)})
                    </span>
                  )}
                  {e.data.daysHeldOver > 0 && (
                    <span className="text-amber-700">
                      {' · '}held over {daysLabel(e.data.daysHeldOver)} past {fmtDate(e.data.contractedEnd)}
                    </span>
                  )}
                  {e.data.continuesOnThisUnit && e.data.successorTenant && (
                    <span className="text-gray-600">
                      {' · '}continues as {e.data.successorTenant}
                    </span>
                  )}
                </p>
                {e.data.terminationNote && (
                  <p className="text-xs text-gray-600 mt-1 italic">{e.data.terminationNote}</p>
                )}
              </>
            )}
            {e.kind === 'assignment' && (
              <>
                <p className="text-sm font-medium text-violet-800">{e.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.startDate)}
                  {e.data.reason && ` · ${String(e.data.reason).replace(/_/g, ' ').toLowerCase()}`}
                  {/* Says it out loud: an assignment changes who pays, never what they
                      pay. It is the first thing people ask when they see one. */}
                  {' · '}same lease, terms unchanged
                  {e.data.monthlyRent != null && ` (${fmt(e.data.monthlyRent)}/mo)`}
                </p>
                {e.data.note && (
                  <p className="text-xs text-gray-600 mt-1 italic">{e.data.note}</p>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Rent history, per unit ----
// The client asked for rent changes to live in the *unit's* history, but rent
// periods hang off a LEASE. A re-let means the unit has several leases, so
// rendering only the current one would silently drop the previous tenant's rent
// story — exactly the history that was asked for.
//
// So: every lease this unit has ever had, newest first, each labelled with its
// tenant and dates. The newest is expanded; older ones collapse to a one-line
// header that still carries tenant, dates and rent, so the unit reads as one
// continuous timeline whether or not you open the tables. Collapsing matters
// here because each schedule is a full multi-row table plus a four-stat strip —
// a unit on its fourth tenant would otherwise be several screens of tables.
//
// Each expanded lease shows BOTH halves of that tenancy's rent story, because
// they answer different questions and are different models: the SCHEDULE is what
// was contracted (periods, escalations, free-rent months — what is owed), the
// LEDGER is what actually happened (one row per month, payments recorded against
// it — what was collected). Reading either alone is how a tenant ends up chased
// for an abated month, or a missed payment goes unnoticed behind a healthy
// schedule, so they are stacked under one tenant header rather than split apart.
//
// Leases arrive on the unit payload from GET /units/:id (already used above for
// the History timeline), so this costs no extra request; only the expanded
// lease's schedule and ledger fetch their own rows.
function UnitRentHistory({
  leases, canEdit, canCollect, unitId, buildingId, onLeaseDeleted,
}: {
  leases: any[];
  canEdit: boolean;
  /** `rent:collect` — recording money received, deliberately not `lease:edit`. */
  canCollect: boolean;
  unitId: string | undefined;
  /** Needed so obligation writes invalidate the BUILDING rollup too, not just the unit's. */
  buildingId: string | undefined;
  /** Refresh the unit + its timeline after a historical record is removed. */
  onLeaseDeleted?: () => void;
}) {
  const ordered = [...(leases || [])].sort(
    (a, b) => new Date(b.leaseStart || 0).getTime() - new Date(a.leaseStart || 0).getTime(),
  );
  const [openIds, setOpenIds] = useState<string[]>(ordered.length > 0 ? [ordered[0].id] : []);

  const toggle = (id: string) =>
    setOpenIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  if (ordered.length === 0) {
    return <EmptyRow icon={<FiTrendingUp className="w-5 h-5" />} text="No leases yet — rent history starts with the first lease" />;
  }

  return (
    <div className="space-y-3">
      {ordered.map((l: any) => {
        const ongoing = !['EXPIRED', 'TERMINATED'].includes(l.status);
        const open = openIds.includes(l.id);
        return (
          // One card per lease — the button is its header row, the expanded content is
          // its body, so open and closed read as the same object rather than a floating
          // toggle followed by a separately-chromed pile of unrelated-looking panels.
          <div key={l.id} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(l.id)}
              aria-expanded={open}
              className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${open ? 'border-b border-gray-100' : ''}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-gray-500 shrink-0">
                  {open ? <FiChevronDown className="w-4 h-4" /> : <FiChevronRight className="w-4 h-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate flex items-center gap-2">
                    {l.tenantBrand || l.tenantName || 'Unnamed tenant'}
                    {ongoing ? (
                      <span className="text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        Current
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        {String(l.status).toLowerCase()}
                      </span>
                    )}
                    {/* Says the ledger below was typed in, not observed — which changes how
                        much you should trust it and what it takes to delete it. */}
                    {l.isHistorical && (
                      <span className="text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        Recorded
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {fmtDate(l.leaseStart)} – {fmtDate(l.leaseEnd)}
                  </p>
                </div>
              </div>
              <span className="text-sm font-semibold text-gray-700 tabular-nums shrink-0">
                {l.monthlyRent != null ? `${fmt(l.monthlyRent)}/mo` : '—'}
              </span>
            </button>
            {open && (
              <div className="px-4 pt-3 pb-4 space-y-5">
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    Rent schedule — what is owed
                  </p>
                  <LeaseRentSchedule leaseId={l.id} canEdit={canEdit} />
                </div>
                <div className="space-y-2 border-t border-gray-100 pt-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    Rent ledger — what was collected
                  </p>
                  <RentCollectionPanel leaseId={l.id} canCollect={canCollect} unitId={unitId} />
                </div>
                {/* Deposits & TI allowance, per tenancy. The ObligationSummaryCard above
                    the rent history is a read-only unit rollup — it answers "what is
                    outstanding on this unit", not "change this lease's TI allowance".
                    Without this panel the unit page had no write path to an obligation
                    at all, and the team could only edit TI from the project page's
                    Leases tab (client feedback 2026-08-12). */}
                <div className="space-y-2 border-t border-gray-100 pt-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    Deposits &amp; TI allowance — money owed both ways
                  </p>
                  <LeaseObligationsPanel
                    leaseId={l.id}
                    canEdit={canEdit}
                    unitId={unitId}
                    buildingId={buildingId}
                  />
                </div>
                {/* Last, below the ledger it governs — the approver should have scrolled
                    past what they are about to erase. */}
                {l.isHistorical && (
                  <HistoricalRecordControls
                    record={{
                      kind: 'lease', id: l.id, label: l.tenantName || 'This tenancy',
                      dateRangeLabel: `${fmtDate(l.leaseStart)} – ${fmtDate(l.leaseEnd)}`,
                    }}
                    onDeleted={onLeaseDeleted}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function UnitDetailPage() {
  const { id: projectId, unitId } = useParams<{ id: string; unitId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { data: unit, isLoading, error } = useUnit(unitId!);

  // Deep-link support (e.g. the Construction dashboard's "Update Unit Progress" picker
  // links straight to #construction-checklist). The target section only exists once the
  // unit has loaded, so this waits on that rather than firing on route mount. Scrolls twice:
  // sibling sections (e.g. the sale payment schedule) finish their own async fetch shortly
  // after mount and grow taller, which drifts an immediate scroll off-target — the second
  // pass corrects for that once the page has settled.
  useEffect(() => {
    if (!unit || !location.hash) return;
    const scrollToTarget = () => {
      const el = document.getElementById(location.hash.slice(1));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const t1 = setTimeout(scrollToTarget, 50);
    const t2 = setTimeout(scrollToTarget, 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [unit, location.hash]);

  // The unit payload and its history are two queries over the same underlying rows,
  // so anything that writes a lease, sale or status has to refresh both — otherwise
  // the panels above the timeline update and the timeline silently does not.
  const refreshUnit = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['unit', unitId] }),
      qc.invalidateQueries({ queryKey: ['unit-history', unitId] }),
      // Saving a lease can create or update its deposit / NNN / TI obligations and
      // regenerate its rent schedule. Without these the server did the work and the
      // panels below kept rendering their cached emptiness — a TI allowance typed on
      // the lease form appeared nowhere until a hard reload. Prefix-invalidated rather
      // than keyed per lease, because a save may touch any lease on the unit.
      qc.invalidateQueries({ queryKey: ['lease-obligations'] }),
      qc.invalidateQueries({ queryKey: ['obligation-summary'] }),
      qc.invalidateQueries({ queryKey: ['lease-rent-periods'] }),
      qc.invalidateQueries({ queryKey: ['lease-rent-summary'] }),
    ]);
  const updateUnit = useUpdateUnit();
  const { data: unitTypeOpts = [] } = useCustomOptions('unit_type');
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, string>>({});
  const [primeOwned, setPrimeOwned] = useState(false);
  const { hasPermission } = useAuthStore();
  // The narrower build-field permission: CONSTRUCTION may fix a unit's number, type,
  // size and notes. The commercial inputs inside the modal gate themselves on `unit:edit`.
  const canEditUnit = hasPermission('unit:editBuild');
  const canViewSales = hasPermission('sales:view');
  // Reaching the edit form only needs `unit:editBuild`; the commercial half of it —
  // status, asking price, asking rent, ownership — needs `unit:edit`, matching the
  // server-side allowlist in UnitsService.update exactly.
  const canEditCommercial = hasPermission('unit:edit');
  const canEditSale = hasPermission('sales:edit');
  const canEditLease = hasPermission('lease:edit');
  const canViewLeases = hasPermission('lease:view');
  // Recording rent is `rent:collect`, not `lease:edit` — an AR/AP clerk banks a
  // cheque without being able to rewrite the lease terms behind it.
  const canCollectRent = hasPermission('rent:collect');
  const canViewBudget = hasPermission('budget:view');
  const canViewChecklist = hasPermission('checklist:view');
  const canEditChecklist = hasPermission('checklist:edit');
  /**
   * A construction-focused viewer: runs checklists, cannot read leases. That is the
   * Construction role exactly — a PM holds lease:view too. For them the page led with an
   * empty Tenant card and the checklist sat several cards down the masonry, so the one thing
   * they came for was below the fold. Checklist and Activity move to the top instead.
   */
  // Whose unit page opens on the build work rather than the money: the roles that run
  // the site. Expressed as "can edit the checklist AND does not read financials" so it
  // resolves to exactly PROJECT_MANAGER and CONSTRUCTION — PM was previously excluded by
  // a `!canViewLeases` test, which PM fails because they hold lease:view, even though the
  // construction-first ordering is just as right for them. Kept permission-derived rather
  // than a role-name list, which is the thing that has drifted repeatedly in this codebase.
  const constructionFirst = canEditChecklist && !hasPermission('financial:view');
  const { data: budgetSummary } = useUnitFinancialSummary(canViewBudget ? (unitId || '') : '');
  // Derived from `unit` (not `u`) because the early returns below sit between here and
  // where `activeLease` is computed — hooks cannot live after a conditional return.
  const activeLeaseId = (unit as any)?.leases?.find(
    (l: any) => !['EXPIRED', 'TERMINATED'].includes(l.status),
  )?.id as string | undefined;
  const { data: rentPeriods = [] } = useLeaseRentPeriods(canViewLeases ? activeLeaseId : undefined);
  const { data: obligationSummary } = useUnitObligationSummary(canViewLeases ? unitId : undefined);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [leaseModalOpen, setLeaseModalOpen] = useState(false);
  const [leaseIsNew, setLeaseIsNew] = useState(false);
  const [leaseEditId, setLeaseEditId] = useState<string | null>(null);
  // Shared shape — this page used to keep its own six-field copy, so deposit,
  // escalation and rent-per-sqft were shown on the card but not editable here.
  const [leaseForm, setLeaseForm] = useState<Record<string, string>>(EMPTY_LEASE);
  const [leaseErrors, setLeaseErrors] = useState<Record<string, string>>({});
  const createLease = useCreateLease();
  const updateLease = useUpdateLease();
  const backfillTenancy = useBackfillTenancy();

  // "Save as rental history" — lets the Add Lease dialog write a settled, already-ended
  // tenancy (same backend call, and the same TenancyBackfillFields, as the separate
  // "+ Record a past tenancy" flow) instead of a live one. Only offered for a brand-new
  // lease: backfillTenancy composes create(), it does not edit an existing lease into a
  // historical record.
  const [isHistorical, setIsHistorical] = useState(false);
  const historical = useTenancyBackfillState(leaseForm.leaseStart ?? '', leaseForm.monthlyRent ?? '');

  const resetHistoricalFields = () => {
    setIsHistorical(false);
    historical.reset();
  };

  const closeLeaseModal = () => {
    setLeaseModalOpen(false);
    resetHistoricalFields();
  };

  const openAddLease = (leaseStatus: string = 'ACTIVE') => {
    setLeaseIsNew(true);
    setLeaseEditId(null);
    setLeaseForm({ ...EMPTY_LEASE, unitId: unitId || '', status: leaseStatus });
    setLeaseErrors({});
    resetHistoricalFields();
    setLeaseModalOpen(true);
  };

  // The two tenancy transitions. Held as the lease itself rather than a boolean so
  // the dialog always has the row it is acting on, even mid-close animation.
  const [endLease, setEndLease] = useState<any>(null);
  const [assignLease, setAssignLease] = useState<any>(null);
  const [backfilling, setBackfilling] = useState(false);

  const openEditLease = (lease: any) => {
    setLeaseIsNew(false);
    setLeaseEditId(lease.id);
    setLeaseForm(leaseToForm(lease, unitId || ''));
    setLeaseErrors({});
    resetHistoricalFields();
    setLeaseModalOpen(true);
  };

  const saveHistoricalLease = async () => {
    // Same field set the normal path checks (rentStartDate vs leaseStart, rentDueDay
    // range) — the backfill DTO enforces both server-side, so skipping this client-side
    // would just trade an inline field error for a generic toast after a round-trip.
    // isHistorical: true skips the NNN-required check — those fields are hidden here
    // and the backfill endpoint has nowhere to put them.
    const errs = validateLeaseForm(leaseForm, { isHistorical: true });
    if (Object.keys(errs).length > 0) {
      setLeaseErrors(errs);
      return addToast({ title: 'Please fix the highlighted fields', color: 'warning' });
    }
    const requiredError = requiredBackfillFieldError({
      tenantName: leaseForm.tenantName, leaseStart: leaseForm.leaseStart,
      leaseEnd: leaseForm.leaseEnd, terminationDate: historical.terminationDate,
      monthlyRent: leaseForm.monthlyRent,
    });
    if (requiredError) return addToast({ title: requiredError, color: 'warning' });
    if (historical.endsInFuture) {
      return addToast({ title: 'That move-out date is in the future — use a normal lease instead', color: 'warning' });
    }

    const overrides = buildCollectionOverrides(historical.collections, historical.rent);

    try {
      const res = await backfillTenancy.mutateAsync({
        unitId: unitId!,
        tenantName: leaseForm.tenantName.trim(),
        tenantLegalName: leaseForm.tenantLegalName || undefined,
        tenantBrand: leaseForm.tenantBrand || undefined,
        leaseStart: leaseForm.leaseStart,
        leaseEnd: leaseForm.leaseEnd,
        terminationDate: historical.terminationDate,
        terminationReason: historical.terminationReason || undefined,
        monthlyRent: Number(leaseForm.monthlyRent),
        rentStartDate: leaseForm.rentStartDate || undefined,
        securityDeposit: leaseForm.securityDeposit ? Number(leaseForm.securityDeposit) : undefined,
        rentDueDay: leaseForm.rentDueDay ? Number(leaseForm.rentDueDay) : undefined,
        notes: leaseForm.notes || undefined,
        collections: Object.keys(overrides).length ? overrides : undefined,
      });
      backfillSuccessToast(res);
      await refreshUnit();
      closeLeaseModal();
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not record the tenancy'), color: 'danger' });
    }
  };

  const handleSaveLease = async () => {
    if (leaseIsNew && isHistorical) return saveHistoricalLease();

    const errs = validateLeaseForm(leaseForm);
    if (Object.keys(errs).length > 0) {
      setLeaseErrors(errs);
      return addToast({ title: 'Please fix the highlighted fields', color: 'warning' });
    }
    const payload = buildLeasePayload(leaseForm);
    try {
      if (leaseIsNew) {
        await createLease.mutateAsync({ ...payload, unitId: unitId! });
        addToast({ title: 'Lease created', color: 'success' });
      } else {
        await updateLease.mutateAsync({ id: leaseEditId!, data: payload });
        addToast({ title: 'Lease updated', color: 'success' });
      }
      await refreshUnit();
      closeLeaseModal();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save lease'), color: 'danger' });
    }
  };

  // Quick-add for a SOLD unit with no sale record yet. Editing an EXISTING closed
  // sale (buyer, price, dates, broker) happens inside SoldUnitPanel — this only
  // covers the case where the unit's status was flipped to SOLD but nobody has
  // recorded the deal yet, mirroring the "+ Add Lease" fallback above.
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  /**
   * The same field set as the historical-sales import template, so a deal typed in by hand
   * and one loaded from a sheet record the same facts. It used to capture five of them —
   * buyer, price, deposit, a closing date and notes — which meant every manually entered
   * sale was missing the seller, the broker, the agreement date and when the money actually
   * arrived, and nobody could tell whether those were unknown or never asked for.
   *
   * Unit / Building / Sqft are shown but not editable: the modal is opened from the unit,
   * so they are context, not input. Price PSF is derived from price ÷ sqft rather than
   * typed — it is a quotient, and two people can only disagree about it.
   */
  const [saleForm, setSaleForm] = useState<Record<string, string>>({
    seller: '', buyer: '', salePrice: '', depositAmt: '', depositDate: '',
    secondPaymentAmt: '', secondPaymentDate: '', contractDate: '', closingDate: '',
    brokerId: '', notes: '',
  });
  const createSale = useCreateSale();
  const addSalePayment = useAddSalePayment();
  const { data: brokerList } = useBrokers();
  const brokers: any[] = Array.isArray(brokerList) ? brokerList : [];

  const openAddSale = () => {
    setSaleForm({
      seller: '', buyer: '', salePrice: '', depositAmt: '', depositDate: '',
      secondPaymentAmt: '', secondPaymentDate: '', contractDate: '', closingDate: '',
      brokerId: '', notes: '',
    });
    setSaleModalOpen(true);
  };

  const handleSaveSale = async () => {
    if (!saleForm.buyer.trim()) {
      return addToast({ title: 'Buyer is required', color: 'warning' });
    }
    if (!saleForm.salePrice) {
      return addToast({ title: 'Sale price is required', color: 'warning' });
    }
    const toDate = (d: string) => (d ? new Date(`${d}T12:00:00.000Z`).toISOString() : undefined);
    try {
      const sale: any = await createSale.mutateAsync({
        projectId: projectId!,
        unitId: unitId!,
        // Recorded as UNDER_CONTRACT, not CLOSED. Closing is gated on the Deed, NOC and
        // Possession Certificate being attached to the sale (S6/D1), and documents attach
        // to a sale that exists — so a sale cannot be born closed. This records the deal;
        // closing it is the second step, once the paperwork is on file.
        status: 'UNDER_CONTRACT',
        seller: saleForm.seller.trim() || undefined,
        buyer: saleForm.buyer.trim() || undefined,
        salePrice: parseFloat(saleForm.salePrice),
        depositAmt: saleForm.depositAmt ? parseFloat(saleForm.depositAmt) : undefined,
        contractDate: toDate(saleForm.contractDate),
        closingDate: toDate(saleForm.closingDate),
        brokerId: saleForm.brokerId || undefined,
        notes: saleForm.notes.trim() || undefined,
      });

      // Deposit and second payment become real installments on the sale's schedule rather
      // than two more columns on Sale — that schedule already exists, already reports what
      // is owed, and is where the import puts the same two figures.
      //
      // They are created DUE, not paid. The form asks when a payment is dated; it does not
      // ask whether the money arrived, and recording cash as received on that basis is a
      // claim the person filling this in never made. Marking it paid is one click on the
      // schedule.
      const installments = [
        { label: 'Deposit', amount: saleForm.depositAmt, date: saleForm.depositDate },
        { label: 'Second Payment', amount: saleForm.secondPaymentAmt, date: saleForm.secondPaymentDate },
      ].filter((p) => p.amount);

      for (const [i, p] of installments.entries()) {
        try {
          await addSalePayment.mutateAsync({
            saleId: sale.id,
            data: {
              label: p.label,
              amount: parseFloat(p.amount),
              trigger: 'FIXED_DATE',
              dueDate: toDate(p.date),
              sequence: i + 1,
            },
          });
        } catch (e) {
          // The sale is already saved; losing an installment must not read as losing the
          // deal. Name which one so it can be re-added rather than hunted for.
          addToast({ title: errMsg(e, `Sale saved, but the ${p.label} installment did not`), color: 'warning' });
        }
      }
      addToast({
        title: 'Sale recorded as Under Contract',
        description: 'Attach the Deed, NOC and Possession Certificate to this sale in the project\'s '
          + 'Revenue tab, then move it to Closed — that is what marks the unit sold.',
        color: 'success',
        timeout: 8000,
      });
      await refreshUnit();
      setSaleModalOpen(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save sale'), color: 'danger' });
    }
  };

  const setSale = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSaleForm((f) => ({ ...f, [field]: e.target.value }));

  const setLease = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setLeaseForm((f) => ({ ...f, [field]: e.target.value }));

  const saveNotes = async () => {
    try {
      await updateUnit.mutateAsync({ id: unitId!, data: { notes: notesDraft || null } });
      await refreshUnit();
      addToast({ title: 'Notes saved', color: 'success' });
      setEditingNotes(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save notes'), color: 'danger' });
    }
  };

  /**
   * Same query key as UnitConstructionPanel's, so TanStack serves both from one cache
   * entry and this costs nothing. The parent needs the count to decide whether the card
   * collapses — a child cannot collapse the shell it is rendered inside.
   */
  const constructionItems: any[] = (useTasks({ unitId, kind: 'CONSTRUCTION' }).data as any[]) ?? [];
  /**
   * The ledger of the lease currently open in the edit dialog, so the form can warn
   * before a date change silently diverges from months already billed. Enabled only
   * while editing, so it costs nothing the rest of the time.
   */
  const editedLeaseLedger: any[] =
    (useLeaseRentInvoices(canViewLeases ? (leaseEditId ?? undefined) : undefined).data as any[]) ?? [];
  /** "covering Jan 2025 – Aug 2026" — the range, so the warning is specific. */
  const ledgerSpan = useMemo(() => {
    if (editedLeaseLedger.length === 0) return null;
    const months = editedLeaseLedger
      .map((i) => i.periodMonth)
      .filter(Boolean)
      .sort();
    if (months.length === 0) return null;
    const fmtMonth = (m: string) =>
      new Date(m).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    return months.length === 1
      ? `covering ${fmtMonth(months[0])}`
      : `covering ${fmtMonth(months[0])} – ${fmtMonth(months[months.length - 1])}`;
  }, [editedLeaseLedger]);

  if (isLoading) return <LoadingState />;
  if (error || !unit) return <ErrorState />;

  const u = unit as any;
  const activeLease = u.leases?.find((l: any) => !['EXPIRED', 'TERMINATED'].includes(l.status));
  /**
   * The most recent tenancy that HAS ended. Shown, greyed out, when there is no live
   * lease — "no active lease" on a unit that had a tenant last month is technically
   * true and practically useless, and it is what sent people back to spreadsheets to
   * find out who was in there.
   */
  const lastEndedLease = !activeLease
    ? (u.leases ?? [])
        .filter((l: any) => l.terminationDate || ['EXPIRED', 'TERMINATED'].includes(l.status))
        .sort((a: any, b: any) =>
          new Date(b.terminationDate ?? b.leaseEnd).getTime() -
          new Date(a.terminationDate ?? a.leaseEnd).getTime())[0]
    : null;
  const shownLease = activeLease ?? lastEndedLease;
  const tenancy = shownLease ? tenancyState(shownLease) : null;
  /**
   * The unit's status and its lease disagree. Neither field can be trusted over the
   * other from here — the unit status is hand-set and the lease is hand-closed — so
   * this says what each one claims and lets a human decide, rather than silently
   * picking a winner.
   */
  const statusConflict =
    activeLease && !tenancy?.isPast && !TENANTED_STATUSES.includes(u.status) && u.status !== 'SOLD'
      ? `This unit is marked ${String(u.status).replace(/_/g, ' ').toLowerCase()}, but ${
          activeLease.tenantBrand || activeLease.tenantName
        } holds a lease on it${activeLease.leaseEnd ? ` until ${fmtDate(activeLease.leaseEnd)}` : ''}.`
      : null;
  // Money arrives as Prisma Decimal, which JSON-serializes to a STRING — always num() it
  // before arithmetic, or `0 + "500"` becomes `"0500"`.
  const num = (v: unknown) => Number(v ?? 0) || 0;
  const today = new Date();
  // Periods can overlap (a MANUAL period supersedes the generated one it sits inside),
  // so "the period covering today" is the LATEST-starting match, not the first in the
  // array — taking the first showed the superseded row and hid the NNN split entirely.
  const currentPeriod = (rentPeriods as any[])
    .filter((p) => {
      const start = new Date(p.startDate);
      const end = p.endDate ? new Date(p.endDate) : null;
      return start <= today && (!end || end >= today);
    })
    .sort((a, b) => {
      const d = new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
      return d !== 0 ? d : (b.sequence ?? 0) - (a.sequence ?? 0);
    })[0] ?? (rentPeriods as any[])[0];
  const baseRent = num(currentPeriod?.baseRent);
  const kindRow = (k: string) => (obligationSummary as any)?.byKind?.find((b: any) => b.kind === k);
  const depositAgreed = num(kindRow('SECURITY_DEPOSIT')?.totalAgreed);
  const depositPending = num(kindRow('SECURITY_DEPOSIT')?.totalPending);
  const tiAgreed = num(kindRow('TI_ALLOWANCE')?.totalAgreed);
  const tiPending = num(kindRow('TI_ALLOWANCE')?.totalPending);
  const psf = u.askingPrice && u.sqft ? (Number(u.askingPrice) / u.sqft).toFixed(2) : null;
  const rentPsf = u.askingRent && u.sqft ? ((Number(u.askingRent) * 12) / u.sqft).toFixed(2) : null;

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const openEdit = () => {
    setForm({
      unitNumber: u.unitNumber ?? '',
      unitType: u.unitType ?? 'RETAIL',
      status: u.status ?? 'AVAILABLE',
      sqft: u.sqft != null ? String(u.sqft) : '',
      askingPrice: u.askingPrice != null ? String(u.askingPrice) : '',
      askingRent: u.askingRent != null ? String(u.askingRent) : '',
      notes: u.notes ?? '',
    });
    setPrimeOwned(u.primeOwned ?? false);
    onOpen();
  };

  const handleSave = async () => {
    try {
      await updateUnit.mutateAsync({
        id: unitId!,
        data: {
          unitNumber: form.unitNumber || undefined,
          unitType: form.unitType || undefined,
          sqft: form.sqft ? parseInt(form.sqft, 10) : null,
          // Status, the commercial terms and ownership all need `unit:edit`; the route
          // itself only needs `unit:editBuild`. Omitted rather than sent as null,
          // because the API refuses the whole request if a field it disallows is present
          // — so sending them would fail the save instead of just ignoring them.
          ...(canEditCommercial ? {
            status: form.status || undefined,
            askingPrice: form.askingPrice ? parseFloat(form.askingPrice) : null,
            askingRent: form.askingRent ? parseFloat(form.askingRent) : null,
            primeOwned,
          } : {}),
          notes: form.notes || null,
        },
      });
      await refreshUnit();
      addToast({ title: 'Unit updated', color: 'success' });
      onClose();

      // A unit marked leased with no lease on file is a dead end: the rent roll, the
      // revenue reports and the unit's own history all read from the LEASE, not the
      // status, so the flag on its own records nothing. Rather than block the status
      // change — data gets entered in whatever order suits the person entering it —
      // offer the lease form immediately, seeded to match the status they just chose.
      const nowTenanted = TENANTED_STATUSES.includes(form.status);
      const wasTenanted = TENANTED_STATUSES.includes(u.status);
      if (nowTenanted && !wasTenanted && !activeLease && canEditLease) {
        openAddLease(form.status === 'LEASE_PENDING' ? 'DRAFT' : 'ACTIVE');
      }
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update unit'), color: 'danger' });
    }
  };


  // Defined once and placed by `constructionFirst` above, so the two orderings cannot drift
  // apart into two copies of the same JSX.
  const checklistSection = (
    <Section
      id="construction-checklist"
      icon={<FiCheckSquare className="w-4 h-4 text-teal-600" />}
      title="Construction Checklist"
      subtitle="Build stages — fixed template checklist"
      headerClassName="bg-teal-50/60"
    >
      <UnitConstructionChecklist
        unitId={unitId!} buildingId={u.building?.id}
        projectId={u.building?.project?.id} canEdit={canEditChecklist}
      />
    </Section>
  );

  const activitySection = (
    <div id="section-activity" className="mb-5 sm:mb-6">
      <Section
        icon={<FiClipboard className="w-4 h-4 text-blue-600" />}
        title="Activity"
        subtitle="Site updates and team comments, newest first"
        headerClassName="bg-blue-50/60"
      >
        <UnitActivity unitId={unitId!} projectId={u.building?.project?.id} />
      </Section>
    </div>
  );
  return (
    <div className="max-w-[1200px] mx-auto">
      <button
        className="inline-flex items-center gap-1.5 text-gray-500 text-sm font-medium mb-4 cursor-pointer hover:text-blue-600 transition-colors"
        onClick={() => navigate(`/projects/${projectId}/units`)}
      >
        <FiArrowLeft className="w-4 h-4" />
        Back to Units
      </button>

      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white mb-5 sm:mb-6">
        <div className="absolute inset-y-0 left-0 w-1 bg-blue-500" />
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 p-5 sm:p-6 pl-6 sm:pl-7">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">Unit {u.unitNumber}</h1>
            <p className="text-sm text-gray-500 mt-1.5 break-words">
              {u.building?.name}
              {u.building?.project?.name && <> &middot; {u.building.project.name}</>}
            </p>
            <div className="flex items-center gap-2 flex-wrap mt-3">
              <StatusBadge status={u.unitType} />
              <StatusBadge status={u.status} />
              {/* Site Tracker state, surfaced here too. It used to live ONLY on the Site
                  Tracker grid, so opening a unit gave no hint that it was blocked — the one
                  fact anyone arriving at this page most needs to know. */}
              {u.blockerStatus === 'YES' && (
                <Tooltip size="sm" content={u.blockerReason ?? 'Blocked'}>
                  <span>
                    <Chip
                      size="sm" color="danger" variant="flat"
                      startContent={<FiAlertTriangle className="w-3 h-3" />}
                    >
                      Blocked{blockerDays(u.blockerSince) !== null && ` · ${blockerDays(u.blockerSince)}d`}
                    </Chip>
                  </span>
                </Tooltip>
              )}
              {u.sitePriority && (
                <Chip
                  size="sm" variant="flat"
                  color={u.sitePriority === 'HIGH' ? 'secondary' : u.sitePriority === 'MEDIUM' ? 'warning' : 'primary'}
                >
                  {u.sitePriority.charAt(0) + u.sitePriority.slice(1).toLowerCase()} priority
                </Chip>
              )}
              {/* Slice 4: time-on-market shown only for AVAILABLE units */}
              {u.status === 'AVAILABLE' && u.availableSince && (
                <TimeOnMarketBar availableSince={u.availableSince} />
              )}
              {u.primeOwned && <Chip size="sm" color="success" variant="flat">Prime Owned</Chip>}
            </div>
          </div>
          {/* `canEditUnit` was computed and used in four other places on this page but not
              here, so Construction, Viewer, Legal and Finance — none of whom hold unit:edit —
              were offered an Edit button that the API refuses. Offering an action the server
              will reject is a bug on its own terms. */}
          {canEditUnit && (
            <Button size="sm" variant="flat" color="primary" startContent={<FiEdit2 />} onPress={openEdit} className="shrink-0 font-medium">
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      <Modal isOpen={isOpen} onClose={onClose} scrollBehavior="inside" size="lg">
        <ModalContent>
          <ModalHeader>Edit Unit {u.unitNumber}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Unit Number"
                value={form.unitNumber ?? ''}
                onChange={set('unitNumber')}
                size="sm"
              />
              <Select
                label="Unit Type"
                size="sm"
                selectedKeys={form.unitType ? [form.unitType] : []}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as string;
                  if (v) setForm((f) => ({ ...f, unitType: v }));
                }}
              >
                {(unitTypeOpts as any[]).map((opt: any) => (
                  <SelectItem key={opt.value} textValue={opt.label}>{opt.label}</SelectItem>
                ))}
              </Select>
              {canEditCommercial && (
                <Select
                  label="Status"
                  size="sm"
                  selectedKeys={form.status ? [form.status] : []}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as string;
                    if (v) setForm((f) => ({ ...f, status: v }));
                  }}
                >
                  {UNIT_STATUSES.map((s) => <SelectItem key={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
                </Select>
              )}
              <Input
                label="Size (sqft)"
                type="number"
                value={form.sqft ?? ''}
                onChange={set('sqft')}
                size="sm"
              />
              {canEditCommercial && (
                <>
                  <Input
                    label="Asking Price ($)"
                    type="number"
                    value={form.askingPrice ?? ''}
                    onChange={set('askingPrice')}
                    size="sm"
                  />
                  <Input
                    label="Asking Rent ($/mo)"
                    type="number"
                    value={form.askingRent ?? ''}
                    onChange={set('askingRent')}
                    size="sm"
                  />
                </>
              )}
            </div>
            <div className="mt-4">
              <Textarea
                label="Notes"
                value={form.notes ?? ''}
                onChange={set('notes')}
                size="sm"
                minRows={2}
                maxRows={5}
              />
            </div>
            {canEditCommercial && (
              <div className="mt-3">
                <Switch isSelected={primeOwned} onValueChange={setPrimeOwned} size="sm">
                  Prime Owned
                </Switch>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>Cancel</Button>
            <Button color="primary" onPress={handleSave} isLoading={updateUnit.isPending}>Save</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Lease Modal */}
      <Modal isOpen={leaseModalOpen} onClose={closeLeaseModal} size="2xl" scrollBehavior="inside">
        <ModalContent className={isHistorical ? 'border-2 border-amber-400' : undefined}>
          <ModalHeader>
            {isHistorical ? 'Record a Past Tenancy' : leaseIsNew ? 'Add Lease' : 'Edit Lease'}
          </ModalHeader>
          <ModalBody>
            {/* Only offered for a brand-new lease — backfillTenancy composes create(),
                it cannot turn an existing lease into a historical record. The banner
                stays visible for the whole dialog (not just at the top) so the mode is
                never ambiguous, even scrolled past the fields below. */}
            {leaseIsNew && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-amber-900">
                      This is a past tenancy that already ended
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Historical entry — the unit's current status will not change, and
                      months default to paid in full.
                    </p>
                  </div>
                  <Switch
                    size="sm"
                    color="warning"
                    isSelected={isHistorical}
                    onValueChange={(on) => {
                      setIsHistorical(on);
                      if (!on) historical.reset();
                    }}
                  />
                </div>
              </div>
            )}

            {/* Editing a lease that already has a ledger does NOT revisit the invoices.
                Periods that have started are frozen, and generation is idempotent on
                (leaseId, periodMonth) — so months billed under the old dates stay billed
                and re-generating will not correct them. Said before the save, because
                afterwards there is nothing that tells you. */}
            {!leaseIsNew && editedLeaseLedger.length > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                <FiAlertTriangle className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">
                    {editedLeaseLedger.length} invoice(s) already exist for this lease
                    {ledgerSpan && <> — {ledgerSpan}</>}.
                  </p>
                  <p className="mt-0.5">
                    Changing the rent or the dates re-derives future months only. Months
                    already billed are not revisited, and re-generating will not correct
                    them — void or edit them individually if they are wrong.
                  </p>
                </div>
              </div>
            )}
            <LeaseFormFields
              form={leaseForm}
              setForm={setLeaseForm}
              errors={leaseErrors}
              clearError={(f) => setLeaseErrors((p) => { const n = { ...p }; delete n[f]; return n; })}
              unitOptions={u ? [{ id: u.id, unitNumber: u.unitNumber, sqft: u.sqft }] : []}
              lockUnit
              isHistorical={isHistorical}
            />

            {/* Historical-only fields, inserted inline rather than a second modal — the
                same component BackfillTenancyDialog renders, so the two entry points
                can't drift on validation, copy, or the collections grid. */}
            {isHistorical && (
              <div className="mt-4 rounded-md border border-amber-200 p-3 space-y-3">
                <TenancyBackfillFields state={historical} />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={closeLeaseModal}>Cancel</Button>
            <Button
              color={isHistorical ? 'warning' : 'primary'}
              onPress={handleSaveLease}
              isLoading={createLease.isPending || updateLease.isPending || backfillTenancy.isPending}
              isDisabled={isHistorical && historical.endsInFuture}
            >
              {isHistorical ? 'Save Rental History' : leaseIsNew ? 'Add Lease' : 'Save Changes'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Add Sale Modal — quick-add for a SOLD unit with no sale record yet.
          Broker attribution and further edits happen inside SoldUnitPanel once
          this exists. */}
      <Modal
        isOpen={saleModalOpen} onClose={() => setSaleModalOpen(false)}
        size="2xl" scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>Add Sale</ModalHeader>
          <ModalBody>
            <p className="text-xs text-gray-500 mb-1">
              This records the deal as <span className="font-medium text-gray-700">Under Contract</span>. The unit
              is marked sold when the sale moves to Closed, which needs its Deed, NOC and Possession Certificate
              attached first.
            </p>
            {/* Context, not input — the modal was opened from this unit, so asking which
                unit it is would be asking a question we already answered. */}
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 grid grid-cols-3 gap-2">
              {[
                { label: 'Unit', value: u.unitNumber },
                { label: 'Building', value: u.building?.name ?? '—' },
                { label: 'Sqft', value: u.sqft ? u.sqft.toLocaleString() : '—' },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{f.label}</p>
                  <p className="text-xs text-gray-800 truncate">{f.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Seller" size="sm" value={saleForm.seller} onChange={setSale('seller')} />
              <Input label="Buyer" size="sm" isRequired value={saleForm.buyer} onChange={setSale('buyer')} />

              <Input
                label="Purchase Price ($)" size="sm" type="number" isRequired
                value={saleForm.salePrice} onChange={setSale('salePrice')}
              />
              {/* Derived, never typed: price ÷ sqft is a quotient, and a field for it is
                  only a way for the two to disagree. Matches the import, which treats PSF
                  as informational and does not store it either. */}
              <Input
                label="Price PSF ($)" size="sm" isReadOnly
                value={
                  saleForm.salePrice && u.sqft
                    ? (parseFloat(saleForm.salePrice) / u.sqft).toFixed(2)
                    : ''
                }
                description={u.sqft ? 'From price ÷ sqft' : 'This unit has no sqft recorded'}
              />

              <Input label="Deposit Amount ($)" size="sm" type="number" value={saleForm.depositAmt} onChange={setSale('depositAmt')} />
              <Input label="Deposit Date" size="sm" type="date" value={saleForm.depositDate} onChange={setSale('depositDate')} />

              <Input label="Second Payment Amount ($)" size="sm" type="number" value={saleForm.secondPaymentAmt} onChange={setSale('secondPaymentAmt')} />
              <Input label="Second Payment Date" size="sm" type="date" value={saleForm.secondPaymentDate} onChange={setSale('secondPaymentDate')} />

              <Input label="Sale Agreement / Executed Date" size="sm" type="date" value={saleForm.contractDate} onChange={setSale('contractDate')} />
              <Input label="Expected Closing Date" size="sm" type="date" value={saleForm.closingDate} onChange={setSale('closingDate')} />

              {/* A picker, not a name: the import matches broker names as text because a
                  spreadsheet has no ids, but here the real broker is one click away and a
                  typo would create no attribution at all. */}
              <Select
                label="Broker" size="sm" className="sm:col-span-2"
                selectedKeys={saleForm.brokerId ? [saleForm.brokerId] : []}
                onChange={(e) => setSaleForm((f) => ({ ...f, brokerId: e.target.value }))}
                description="Commission is computed when the sale closes."
              >
                {brokers.map((b: any) => (
                  <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
                ))}
              </Select>

              <Input label="Notes" size="sm" value={saleForm.notes} onChange={setSale('notes')} className="sm:col-span-2" />
            </div>

            {(saleForm.depositAmt || saleForm.secondPaymentAmt) && (
              <p className="text-[11px] text-gray-500">
                The deposit and second payment are added to this sale's payment schedule as
                due on the dates given. Mark them received there once the money is in.
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setSaleModalOpen(false)}>Cancel</Button>
            <Button color="primary" onPress={handleSaveSale} isLoading={createSale.isPending}>Add Sale</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <EndTenancyDialog
        lease={endLease}
        isOpen={!!endLease}
        onClose={() => setEndLease(null)}
        // The route param, NOT u.building.projectId — the unit payload nests the
        // project as `building.project.id` and has no `projectId` field, so the old
        // expression was always undefined and the successor dropdown never loaded.
        projectId={projectId}
      />
      <AssignTenantDialog
        lease={assignLease}
        isOpen={!!assignLease}
        onClose={() => setAssignLease(null)}
      />
      <BackfillTenancyDialog
        unitId={unitId!}
        unitNumber={u.unitNumber}
        isOpen={backfilling}
        onClose={() => setBackfilling(false)}
      />

      <SectionNav constructionFirst={constructionFirst} />

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 rounded-2xl border border-gray-200 bg-white overflow-hidden mb-5 sm:mb-6 divide-x divide-y md:divide-y-0 divide-gray-100">
        <Metric label="Size" value={u.sqft ? `${u.sqft.toLocaleString()}` : '\u2014'} unit={u.sqft ? 'sqft' : undefined} />
        {u.status === 'SOLD' ? (() => {
          const closedSale = u.sales?.find((s: any) => s.status === 'CLOSED');
          const sp = closedSale?.salePrice != null ? Number(closedSale.salePrice) : null;
          const soldPsf = sp && u.sqft ? (sp / u.sqft).toFixed(2) : null;
          return (
            <>
              <Metric label="Sale Price" value={sp != null ? fmt(sp) : '\u2014'} accent="text-emerald-700" />
              <Metric label="Price PSF" value={soldPsf ? `$${soldPsf}` : '\u2014'} />
              <Metric label="Closed" value={fmtDate(closedSale?.closingDate)} />
            </>
          );
        })() : TENANTED_STATUSES.includes(u.status) && activeLease ? (() => {
          // "Asking Price / Asking Rent" describe a unit still on the market \u2014 showing
          // them here for a unit that already HAS a tenant is why this strip read as
          // four dashes on a space earning real rent. Report what's actually true of a
          // leased unit instead: what it's collecting, and for how much longer.
          const rentPsfMo = activeLease.rentPerSqft != null ? Number(activeLease.rentPerSqft) : null;
          return (
            <>
              <Metric
                label="Monthly Rent"
                value={fmt(activeLease.monthlyRent)}
                accent="text-emerald-700"
                sub={rentPsfMo ? `$${rentPsfMo.toFixed(2)}/sqft/mo` : undefined}
              />
              <Metric
                label="Lease End"
                value={fmtDate(activeLease.leaseEnd)}
                accent={tenancy?.key === 'OVERDUE_TO_CLOSE' ? 'text-red-700' : undefined}
              />
              <Metric label="Occupied Since" value={fmtDate(activeLease.leaseStart)} />
            </>
          );
        })() : (
          <>
            {/* Asking price and rent are what the unit is being marketed at, not facts
                about the building, so they follow the sales/leasing permissions rather
                than unit:view. CONSTRUCTION holds neither and was seeing both. */}
            {canViewSales && (
              <>
                <Metric label="Asking Price" value={u.askingPrice ? fmt(u.askingPrice) : '\u2014'} accent="text-emerald-700" />
                <Metric label="Price PSF" value={psf ? `$${psf}` : '\u2014'} />
              </>
            )}
            {canViewLeases && (
              <Metric label="Asking Rent" value={u.askingRent ? fmt(u.askingRent) : '\u2014'} unit={u.askingRent ? '/mo' : undefined} accent="text-emerald-700" sub={rentPsf ? `$${rentPsf}/sqft/yr` : undefined} />
            )}
          </>
        )}
      </div>

      {/* Sold unit details — the unit's status is SOLD but nobody has recorded the
          deal yet. Previously this rendered nothing at all, which read as "there is
          no way to enter a sale" rather than "nothing has been entered yet". */}
      {u.status === 'SOLD' && (() => {
        const closedSale = u.sales?.find((s: any) => s.status === 'CLOSED');
        if (closedSale) return <SoldUnitPanel sale={closedSale} />;
        return (
          <div className="mb-5 sm:mb-6 rounded-2xl border border-dashed border-gray-200 bg-white p-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-gray-500">
              <FiDollarSign className="w-4 h-4" />
              <p className="text-sm">This unit is marked SOLD, but no sale has been recorded yet.</p>
            </div>
            {canEditSale ? (
              <Button size="sm" color="primary" variant="flat" className="shrink-0" onPress={openAddSale}>+ Add Sale</Button>
            ) : (
              <span className="text-xs text-gray-500 shrink-0">Ask someone with sales access to record it.</span>
            )}
          </div>
        );
      })()}

      {/* Leased with nobody in it. The same shape as the SOLD panel above, and for the
          same reason: without it the page reads as "there is no way to enter a tenant"
          rather than "nobody has entered one yet". Reachable however the status was
          set — the edit form, the units grid, or a script. */}
      {TENANTED_STATUSES.includes(u.status) && !activeLease && (
        <div className="mb-5 sm:mb-6 rounded-2xl border border-dashed border-amber-200 bg-amber-50/40 p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-amber-800">
            <FiAlertTriangle className="w-4 h-4 shrink-0" />
            <p className="text-sm">
              This unit is marked <strong>{String(u.status).replace('_', ' ').toLowerCase()}</strong>, but
              no tenant or lease has been recorded. Rent, the rent roll and this unit's
              history all read from the lease, so nothing is being tracked yet.
            </p>
          </div>
          {canEditLease ? (
            <Button
              size="sm"
              color="primary"
              variant="flat"
              className="shrink-0"
              onPress={() => openAddLease(u.status === 'LEASE_PENDING' ? 'DRAFT' : 'ACTIVE')}
            >
              + Add tenant
            </Button>
          ) : (
            <span className="text-xs text-amber-700 shrink-0">Ask someone with lease access to record it.</span>
          )}
        </div>
      )}

      {/* The unit and its lease contradict each other. The mirror image of the banner
          above, and on live data the commoner of the two — 91 units are marked tenanted
          with no lease, and 2 are marked available while a tenant holds a lease. */}
      {statusConflict && (
        <div className="mb-5 sm:mb-6 rounded-2xl border border-dashed border-red-200 bg-red-50/40 p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-red-800">
            <FiAlertTriangle className="w-4 h-4 shrink-0" />
            <p className="text-sm">
              {statusConflict} One of the two is wrong — correct the unit status, or end
              the tenancy if the tenant has left.
            </p>
          </div>
          {canEditUnit && (
            <Button size="sm" color="danger" variant="flat" className="shrink-0" onPress={openEdit}>
              Fix unit status
            </Button>
          )}
        </div>
      )}

      {/* Masonry via CSS columns, not grid.
          A grid row is only as short as its TALLEST card, so the tall Tenant card left a
          void beside every short one — first by stretching them (fixed with items-start),
          then as ragged empty space below them. Columns let each card take its own height
          AND let the next card flow up into the gap, so there is none.
          The trade-off, accepted deliberately: reading order becomes column-major — the
          whole left column, then the right — rather than left-to-right in pairs.
          `break-inside-avoid` is what stops a card being split across the column boundary. */}
      {/* Construction-first: for a viewer who runs checklists and cannot read leases, these
          two are the page. Rendered here, above the overview masonry, and skipped in their
          usual positions further down. */}
      {constructionFirst && canViewChecklist && (
        <div className="mb-5 sm:mb-6">{checklistSection}</div>
      )}
      {constructionFirst && activitySection}

      <div id="section-overview" className="columns-1 lg:columns-2 gap-5 sm:gap-6 mb-5 sm:mb-6 [&>*]:break-inside-avoid [&>*]:mb-5 sm:[&>*]:mb-6">
        {/* Active Lease / Tenant Profile.
            Shown for SOLD units too, since 2026-09-01. Hiding it did not prevent a
            sold-and-tenanted unit — the API never blocked one, and units reached that
            state anyway (a hand-flipped status, a tenancy that outlived the sale, a
            backfill entered out of order). It only removed every means of looking at or
            correcting the tenancy, while the history timeline went on warning about it
            and pointing at controls that were not on the page. The billing rules are
            unchanged: a lease on a SOLD unit stays out of the rent roll, invoicing,
            cash flow and dunning. What changes is that it can now be seen and edited. */}
        <Section
          icon={<FiHome className="w-4 h-4 text-blue-600" />}
          title="Tenant"
          action={canEditLease ? (
            activeLease ? (
              <div className="flex items-center gap-1">
                {/* Ending a tenancy and assigning a lease are not edits — they are the
                    two transitions, and burying them inside the edit form is how a user
                    ends up hand-typing a termination the server should be deriving. */}
                <button
                  onClick={() => setAssignLease(activeLease)}
                  className="text-gray-500 hover:text-violet-600 transition-colors p-1 rounded"
                  title="Assign lease to a new tenant (the lease itself continues)"
                >
                  <FiRepeat className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setEndLease(activeLease)}
                  className="text-gray-500 hover:text-rose-700 transition-colors p-1 rounded"
                  title="End tenancy — records the move-out and releases the unit"
                >
                  <FiLogOut className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => openEditLease(activeLease)}
                  className="text-gray-500 hover:text-blue-600 transition-colors p-1 rounded"
                  title="Edit lease"
                >
                  <FiEdit2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                // Wrapped, not passed bare: openAddLease now takes the lease status to
                // seed, and a bare handler would hand it the click event.
                onClick={() => openAddLease(u.status === 'LEASE_PENDING' ? 'DRAFT' : 'ACTIVE')}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
              >
                + Add Lease
              </button>
            )
          ) : undefined}
        >
          {shownLease ? (
            /* A past tenancy reads as archived through muted, desaturated colors on
               every element — NOT blanket opacity. Opacity dims a saturated box (like
               the emerald rent figure below) below safe text contrast, and a washed-out
               green still reads as "active but faded" rather than clearly historical. */
            <div className={`space-y-4 ${tenancy!.isPast ? 'border-l-2 border-gray-200 pl-3 -ml-3' : ''}`}>
              {tenancy!.isPast && (
                <p className="text-xs text-gray-500 -mb-1">
                  Nobody is in this unit now. Showing the last tenancy.
                </p>
              )}
              {/* Tenant identity block */}
              <div className="pb-4 border-b border-gray-100">
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  tenancy!.isPast ? 'bg-gray-400' : 'bg-blue-600'
                }`}>
                  <span className="text-white text-sm font-bold">
                    {(shownLease.tenantBrand || shownLease.tenantName || '?').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 text-sm leading-tight truncate">
                    {shownLease.tenantBrand || shownLease.tenantName}
                  </p>
                  {shownLease.tenantBrand && shownLease.tenantBrand !== shownLease.tenantName && (
                    <p className="text-xs text-gray-500 truncate">{shownLease.tenantName}</p>
                  )}
                  {shownLease.tenantLegalName && shownLease.tenantLegalName !== shownLease.tenantName && (
                    <p className="text-[11px] text-gray-500 italic truncate">{shownLease.tenantLegalName}</p>
                  )}
                  {shownLease.tenantContact && (
                    <p className="text-xs text-blue-600 mt-0.5 truncate">{shownLease.tenantContact}</p>
                  )}
                </div>
                <div className="shrink-0">
                  {/* Derived, not `status`. A lease whose term ran out last month must
                      not wear a green "Active" chip just because nobody closed it. */}
                  <span className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full ${tenancy!.chip}`}>
                    {tenancy!.label}
                  </span>
                </div>
              </div>
              {/* Full width, BELOW the identity row. Sitting it beside the chip squeezed
                  a sentence into a shrink-0 column and pushed it off the card. */}
              {tenancy!.note && (
                <p className="text-[11px] text-gray-500 mt-2 leading-snug">{tenancy!.note}</p>
              )}
              </div>

              {/* Financial highlight. Emerald means "collecting this now" elsewhere in
                  the app (the Active chip above uses the same color) — a past tenancy
                  keeps the figure legible but in neutral slate, so it never reads as a
                  live, currently-billing rent. */}
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-xl px-3 py-2.5 ${tenancy!.isPast ? 'bg-gray-50' : 'bg-emerald-50'}`}>
                  <p className={`text-[11px] uppercase tracking-wide font-semibold ${
                    tenancy!.isPast ? 'text-gray-500' : 'text-emerald-700'
                  }`}>
                    Monthly Rent
                  </p>
                  <p className={`text-lg font-bold tabular-nums mt-0.5 ${
                    tenancy!.isPast ? 'text-gray-700' : 'text-emerald-700'
                  }`}>
                    {fmt(shownLease.monthlyRent)}
                  </p>
                  {shownLease.rentPerSqft && (
                    <p className={`text-[11px] ${tenancy!.isPast ? 'text-gray-500' : 'text-emerald-700'}`}>
                      ${Number(shownLease.rentPerSqft).toFixed(2)}/sqft/mo
                    </p>
                  )}
                </div>
                {shownLease.securityDeposit && (
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Deposit</p>
                    <p className="text-lg font-bold text-gray-700 tabular-nums mt-0.5">{fmt(shownLease.securityDeposit)}</p>
                    {depositAgreed > 0 && (
                      <p className="text-[11px] text-gray-500">
                        {depositPending > 0
                          ? `${fmt(depositPending)} outstanding`
                          : depositPending < 0 ? 'Overpaid — refund due' : 'Collected in full'}
                      </p>
                    )}
                  </div>
                )}
              </div>


              {/* Lease timeline */}
              <dl className="text-sm divide-y divide-gray-100">
                <Row label="Start"><span className="text-gray-700">{fmtDate(shownLease.leaseStart)}</span></Row>
                <Row label="End">
                  <span className={`${new Date(shownLease.leaseEnd) < new Date() ? 'text-red-700' : 'text-gray-700'}`}>
                    {fmtDate(shownLease.leaseEnd)}
                  </span>
                </Row>
                {shownLease.termMonths && (
                  <Row label="Term"><span className="text-gray-700">{shownLease.termMonths} months</span></Row>
                )}
                {shownLease.escalationPct && (
                  <Row label="Escalation">
                    <span className="text-gray-700">{Number(shownLease.escalationPct).toFixed(1)}% every {shownLease.escalationFreq || 12} mo</span>
                  </Row>
                )}
                {shownLease.rentDueDay && (
                  <Row label="Rent due"><span className="text-gray-700">Day {shownLease.rentDueDay}</span></Row>
                )}
                {/* Abatement sits inside the term — leaseEnd is unchanged. */}
                <Row label="Free rent">
                  {Number(shownLease.freeRentMonths) > 0 ? (
                    <span className="text-emerald-700 font-medium">
                      {shownLease.freeRentMonths} mo
                      {shownLease.freeRentStartDate ? ` from ${fmtDate(shownLease.freeRentStartDate)}` : ''}
                    </span>
                  ) : (
                    <span className="text-gray-500">None</span>
                  )}
                </Row>
                {/* TI flows Prime -> tenant, the opposite direction to the deposit, so it
                    is never summed with it. Sourced from the lease obligation ledger. */}
                <Row label="TI allowance">
                  {tiAgreed > 0 ? (
                    <span className="text-gray-700">
                      {fmt(tiAgreed)}
                      <span className="text-gray-500">
                        {tiPending > 0 ? ` · ${fmt(tiPending)} left to fund` : ' · fully funded'}
                      </span>
                    </span>
                  ) : (
                    <span className="text-gray-500">None</span>
                  )}
                </Row>
              </dl>
            </div>
          ) : (
            <EmptyRow icon={<FiHome className="w-5 h-5" />} text="No active lease" />
          )}

          {/* Said once, at the bottom, rather than as a banner over the card: on a sold
              unit this is a standing condition of the record, not a problem to act on.
              It is here so nobody reads a rent figure above and expects an invoice. */}
          {u.status === 'SOLD' && (
            <p className="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-500 leading-snug">
              This unit is sold. A tenancy recorded here is kept for the record — it stays out
              of the rent roll, invoicing, cash flow and reminders, whatever its status says.
            </p>
          )}
        </Section>

        {/* Construction — the site work covering this unit. Sits beside the tenant and
            rent history on purpose: "is anything happening to this unit" and "who is in
            it" are the two questions this page exists to answer, and until now the first
            one lived in Monday. */}
        <Section
          icon={<FiLayers className="w-4 h-4 text-amber-600" />}
          title="Construction"
          subtitle="Work items — ad-hoc tasks & day-by-day updates"
          count={constructionItems.length}
          empty={constructionItems.length ? null : 'None'}
        >
          <UnitConstructionPanel unitId={unitId!} canEdit={hasPermission('task:edit')} />
        </Section>

        {/* Rendered here only for viewers whose job is not construction — for Construction
            it is lifted above the overview, see `constructionFirst`. */}
        {canViewChecklist && !constructionFirst && checklistSection}



        {/* Financing — loans and budget scoped to this unit, combined into one card so
            the two money sections stay together regardless of where the masonry's
            column break falls (previously two separate cards could land in different
            columns purely as a function of how tall the Tenant card rendered). */}
        {(() => {
          const budgetTotal = Number((budgetSummary as any)?.budgetTotal ?? 0);
          const committedTotal = Number((budgetSummary as any)?.committedTotal ?? 0);
          const actualTotal = Number((budgetSummary as any)?.actualTotal ?? 0);
          const variance = Number((budgetSummary as any)?.variance ?? 0);
          const hasBudget = canViewBudget && (budgetTotal !== 0 || committedTotal !== 0 || actualTotal !== 0);
          const hasLoans = u.loans?.length > 0;
          if (!canViewBudget && !hasLoans) return null;
          return (
            <Section icon={<FiDollarSign className="w-4 h-4 text-emerald-600" />} title="Financing" subtitle="Linked loans & budget">
              {hasLoans && (
                <div className={`space-y-4 ${hasBudget ? 'mb-4 pb-4 border-b border-gray-100' : ''}`}>
                  {u.loans.map((loan: any) => (
                    <dl key={loan.id} className="text-sm divide-y divide-gray-100 rounded-xl border border-gray-100 px-3">
                      <Row label="Lender"><span className="font-medium text-gray-900">{loan.lender || '\u2014'}</span></Row>
                      <Row label="Type"><span className="text-gray-700">{loan.loanType?.replace(/_/g, ' ') || '\u2014'}</span></Row>
                      <Row label="Monthly Payment"><span className="text-gray-700 tabular-nums">{loan.monthlyPayment ? fmt(loan.monthlyPayment) : '\u2014'}</span></Row>
                      <Row label="Principal"><span className="text-gray-700 tabular-nums">{loan.principalAmt ? fmt(loan.principalAmt) : '\u2014'}</span></Row>
                    </dl>
                  ))}
                </div>
              )}
              {hasBudget && (
                <dl className="text-sm divide-y divide-gray-100">
                  <Row label="Budget"><span className="text-gray-700 tabular-nums">{fmt(budgetTotal)}</span></Row>
                  <Row label="Committed"><span className="text-gray-700 tabular-nums">{fmt(committedTotal)}</span></Row>
                  <Row label="Actual"><span className="text-gray-700 tabular-nums">{fmt(actualTotal)}</span></Row>
                  <Row label="Remaining">
                    <span className={`tabular-nums font-medium ${variance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {fmt(variance)}
                    </span>
                  </Row>
                </dl>
              )}
              {!hasLoans && !hasBudget && (
                <EmptyRow icon={<FiCreditCard className="w-5 h-5" />} text="No loans or budget on this unit" />
              )}
            </Section>
          );
        })()}
      </div>

      {/* History — full lease + sale timeline, survives the unit changing status
          (e.g. a past tenant stays visible after the unit is later sold) */}
      <div id="section-history" className="mb-5 sm:mb-6">
        <Section icon={<FiClock className="w-4 h-4 text-gray-600" />} title="History">
          <UnitHistoryTimeline unitId={unitId} />
        </Section>
      </div>

      {/* Rent & deposits — deliberately directly under History. History answers
          "who was here and when"; this answers "how much, and when did it change"
          for those same leases, so the drill-down sits against the summary it
          expands rather than at the foot of the page. Not rendered inside a
          Section: ObligationSummaryCard brings its own card chrome, and each lease
          row in UnitRentHistory is its OWN card (button = header, expanded content =
          body) so LeaseRentSchedule/RentCollectionPanel/LeaseObligationsPanel read as
          one bordered unit per tenancy rather than loose panels floating in the page.

          Gated on lease:view like BuildingDetailPage does: every endpoint behind
          this block (obligation summary, rent periods, rent invoices) requires
          lease:view, and this route is not permission-guarded in App.tsx — so
          without the gate an ACCOUNTING / AR_AP / CONSTRUCTION / VIEWER user is
          shown a card whose only possible outcome is a 403. */}
      {canViewLeases && (
        <div className="mb-5 sm:mb-6 space-y-4">
          {/* Unit-wide rollup — ONLY when there is more than one tenancy to roll up.
              LeaseObligationsPanel (inside Rent History, per lease) already shows the
              same money-in / money-out totals, plus the editable rows behind them. On a
              single-lease unit the two were identical, so the page said "Deposits &
              Allowances" twice with the same numbers. It earns its place only when it
              aggregates across tenancies, which is something no per-lease panel can do. */}
          {(u.leases?.length ?? 0) > 1 && <ObligationSummaryCard scope="unit" id={unitId} />}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2.5">
              <FiTrendingUp className="w-4 h-4 text-emerald-600" />
              <h2 className="font-semibold text-sm text-gray-800">
                Rent History
                {(u.leases?.length ?? 0) > 1 && (
                  <span className="text-gray-500 font-normal ml-1">({u.leases.length} leases)</span>
                )}
              </h2>
            </div>
            {/* Entering history sits with the history, not with the "+ Add Lease" action
                above — they read similarly and do very different things, and the one
                that writes a whole settled ledger should not be the easier slip. */}
            {hasPermission('unit:history:backfill') && (
              <Button size="sm" variant="flat" onPress={() => setBackfilling(true)}>
                + Record a past tenancy
              </Button>
            )}
          </div>
          <UnitRentHistory
            leases={u.leases || []}
            canEdit={canEditLease}
            canCollect={canCollectRent}
            unitId={unitId}
            buildingId={u.building?.id}
            onLeaseDeleted={refreshUnit}
          />
        </div>
      )}

      {/* Notes — always visible so users can add notes even when empty */}
      {(u.notes || canEditUnit) && (
        <div id="section-notes" className="mb-5 sm:mb-6">
          <Section
            icon={<FiAlignLeft className="w-4 h-4 text-gray-500" />}
            title="Notes"
            action={canEditUnit && !editingNotes ? (
              <button
                onClick={() => { setNotesDraft(u.notes ?? ''); setEditingNotes(true); }}
                className="text-gray-500 hover:text-blue-600 transition-colors p-1 rounded"
                title="Edit notes"
              >
                <FiEdit2 className="w-3.5 h-3.5" />
              </button>
            ) : undefined}
          >
            {editingNotes ? (
              <div className="space-y-2">
                <Textarea
                  autoFocus
                  size="sm"
                  minRows={3}
                  value={notesDraft}
                  onValueChange={setNotesDraft}
                  placeholder="Add notes about this unit…"
                />
                <div className="flex gap-2">
                  <Button size="sm" color="primary" startContent={<FiCheck />} onPress={saveNotes} isLoading={updateUnit.isPending}>
                    Save
                  </Button>
                  <Button size="sm" variant="flat" startContent={<FiX />} onPress={() => setEditingNotes(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {u.notes || <span className="text-gray-500 italic">No notes yet{canEditUnit ? ' — click edit to add' : ''}</span>}
              </p>
            )}
          </Section>
        </div>
      )}

      {/* Leads & Activity — both panels hit /leads endpoints (lead:view) */}
      <PermissionGate permission="lead:view">
        <div id="section-leads" className="mb-5 sm:mb-6">
          <UnitLeadsPanel unitId={unitId!} projectId={projectId!} />
        </div>

        {/* Waitlist — demand signal */}
        <UnitWaitlistPanel unitId={unitId!} />
      </PermissionGate>

      {/* Interior / Fit-Out */}
      <PermissionGate permission="interior:view">
        <div id="section-interior" className="mb-5 sm:mb-6">
          <InteriorPanel
            unitId={unitId!}
            unitNumber={(unit as any)?.unitNumber}
            unitSqft={(unit as any)?.sqft != null ? Number((unit as any).sqft) : undefined}
          />
        </div>
      </PermissionGate>

      {/* Documents scoped to this unit */}
      <div id="section-documents" className="mb-5 sm:mb-6">
        <UnitDocumentsPanel unitId={unitId!} />
      </div>

      {/* Comments */}
      {/* Site updates and team comments in one chronological list. They were two separate
          sections and anyone checking on a unit had to read both and merge them mentally.
          The two RECORD types stay separate on purpose — see UnitActivity's header. */}
      {!constructionFirst && activitySection}
    </div>
  );
}

const LEAD_STATUS_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger'> = {
  NEW: 'default',
  CONTACTED: 'primary',
  POTENTIAL: 'primary',
  QUALIFIED: 'secondary',
  SITE_VISIT: 'secondary',
  PROPOSAL_SENT: 'warning',
  NEGOTIATING: 'warning',
  CONVERTED: 'success',
  LOST: 'danger',
  DEAD: 'danger',
};

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  SITE_VISIT: 'Site visit',
  FOLLOW_UP: 'Follow-up',
  NOTE: 'Note',
  STATUS_CHANGE: 'Status change',
};

const DOC_CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  BROCHURE:               { bg: 'bg-blue-50',     text: 'text-blue-700' },
  LOI:                    { bg: 'bg-indigo-50',   text: 'text-indigo-700' },
  BOOKING_AGREEMENT:      { bg: 'bg-violet-50',   text: 'text-violet-700' },
  DEED:                   { bg: 'bg-amber-50',    text: 'text-amber-700' },
  RECEIPT:                { bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  NOC:                    { bg: 'bg-rose-50',     text: 'text-rose-700' },
  POSSESSION_CERTIFICATE: { bg: 'bg-cyan-50',     text: 'text-cyan-700' },
  LEASE_DOCS:             { bg: 'bg-sky-50',      text: 'text-sky-700' },
  LOAN_DOCS:              { bg: 'bg-gray-100',    text: 'text-gray-700' },
  FINANCIAL:              { bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  ARCHITECTURAL:          { bg: 'bg-purple-50',   text: 'text-purple-700' },
  CONSTRUCTION_DOCS:      { bg: 'bg-orange-50',   text: 'text-orange-700' },
  PERMITS:                { bg: 'bg-yellow-50',   text: 'text-yellow-700' },
  INSURANCE:              { bg: 'bg-teal-50',     text: 'text-teal-700' },
  OTHER:                  { bg: 'bg-gray-100',    text: 'text-gray-700' },
  GENERAL:                { bg: 'bg-gray-50',     text: 'text-gray-600' },
};

// Categories relevant at the unit level (excludes project-wide types like PERMIT, DRAWING, CONTRACT).
const UNIT_DOC_CATEGORIES = [
  'LOI', 'BOOKING_AGREEMENT', 'DEED', 'RECEIPT',
  'NOC', 'POSSESSION_CERTIFICATE', 'LEASE_DOCS',
  'BROCHURE', 'FINANCIAL', 'GENERAL', 'OTHER',
] as const;

type PreviewDoc = { url: string; name: string; kind: 'image' | 'pdf' | 'other' };

function docPreviewKind(url: string): PreviewDoc['kind'] {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

function UnitDocumentsPanel({ unitId }: { unitId: string }) {
  const { data, isLoading } = useDocuments({ unitId });
  const docs: any[] = Array.isArray(data) ? data : [];
  const upload = useUploadDocument();
  const deleteDoc = useDeleteDocument();
  const renameDoc = useRenameDocument();
  const replaceDoc = useReplaceDocument();
  const { hasPermission } = useAuthStore();
  const canUpload = hasPermission('document:upload');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('GENERAL');
  const [displayName, setDisplayName] = useState('');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewDoc | null>(null);
  // edit state
  const editFileRef = useRef<HTMLInputElement>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);

  const openEdit = (d: any) => {
    setEditId(d.id);
    setEditName(d.fileName || d.name || '');
    setEditFile(null);
    setEditErr(null);
  };
  const cancelEdit = () => { setEditId(null); setEditFile(null); setEditErr(null); };

  const handleSaveEdit = async () => {
    if (!editName.trim()) { setEditErr('Name is required'); return; }
    setEditErr(null);
    try {
      if (editFile) {
        await replaceDoc.mutateAsync({ id: editId!, file: editFile, fileName: editName.trim() });
        addToast({ title: 'Document replaced', color: 'success' });
      } else {
        await renameDoc.mutateAsync({ id: editId!, fileName: editName.trim() });
        addToast({ title: 'Document renamed', color: 'success' });
      }
      cancelEdit();
    } catch (e) {
      setEditErr(errMsg(e, 'Failed to save'));
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPendingFile(f);
    setDisplayName(f.name.replace(/\.[^.]+$/, ''));
    setShowUploadForm(true);
    // Reset so same file can be re-selected after cancel
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!pendingFile) return;
    const fd = new FormData();
    fd.append('file', pendingFile);
    fd.append('unitId', unitId);
    fd.append('category', category);
    if (displayName.trim()) fd.append('displayName', displayName.trim());
    try {
      await upload.mutateAsync(fd);
      addToast({ title: 'Document uploaded', color: 'success' });
      setPendingFile(null);
      setDisplayName('');
      setCategory('GENERAL');
      setShowUploadForm(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Upload failed'), color: 'danger' });
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteDoc.mutateAsync(id);
      addToast({ title: 'Document deleted', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Delete failed'), color: 'danger' });
    }
  };

  const uploadAction = canUpload ? (
    <Button
      size="sm" variant="flat" color="primary"
      startContent={<FiUpload className="w-3 h-3" />}
      onPress={() => fileInputRef.current?.click()}
      isLoading={upload.isPending}
      className="text-xs h-7"
    >
      Upload
    </Button>
  ) : undefined;

  return (
    <Section
      icon={<FiFileText className="w-4 h-4 text-indigo-600" />}
      title="Documents"
      count={docs.length || undefined}
      action={uploadAction}
    >
      {/* Hidden file input */}
      {canUpload && (
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp"
          onChange={onFileChange}
        />
      )}

      {/* Upload form — shown after file is picked */}
      {showUploadForm && pendingFile && (
        <div className="mb-4 p-3 rounded-xl border border-violet-100 bg-violet-50 space-y-2">
          <p className="text-xs font-medium text-violet-700 truncate">
            <FiFileText className="inline w-3 h-3 mr-1" />{pendingFile.name}
            <span className="text-violet-400 ml-1">({Math.round(pendingFile.size / 1024)} KB)</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              size="sm" label="Display name" value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={pendingFile.name}
            />
            <Select
              size="sm" label="Category"
              selectedKeys={[category]}
              onSelectionChange={(k) => { const v = Array.from(k)[0] as string; if (v) setCategory(v); }}
            >
              {UNIT_DOC_CATEGORIES.map((c) => (
                <SelectItem key={c} textValue={c.replace(/_/g, ' ')}>{c.replace(/_/g, ' ')}</SelectItem>
              ))}
            </Select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" color="primary" startContent={<FiUpload />} onPress={handleUpload} isLoading={upload.isPending}>
              Upload
            </Button>
            <Button size="sm" variant="flat" onPress={() => { setPendingFile(null); setShowUploadForm(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-sm text-gray-500 py-4 text-center">Loading…</div>}

      {!isLoading && docs.length === 0 && !showUploadForm && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
            <FiFileText className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-sm font-medium text-gray-500">No documents yet</p>
          {canUpload
            ? <p className="text-xs text-gray-500">Click <span className="font-medium text-gray-500">Upload</span> to attach a file directly to this unit.</p>
            : <p className="text-xs text-gray-500">Upload from the project's Documents tab.</p>
          }
        </div>
      )}

      {/* Document preview modal */}
      {preview && (
        <Modal isOpen onClose={() => setPreview(null)} size="3xl" scrollBehavior="inside">
          <ModalContent>
            <ModalHeader className="flex items-center justify-between gap-2 pr-10">
              <span className="text-sm font-semibold truncate">{preview.name}</span>
              <a
                href={preview.url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
              >
                <FiExternalLink className="w-3.5 h-3.5" /> Open in new tab
              </a>
            </ModalHeader>
            <ModalBody className="pb-6">
              {preview.kind === 'image' ? (
                <img
                  src={preview.url} alt={preview.name}
                  className="w-full rounded-lg object-contain max-h-[70vh]"
                />
              ) : (
                <iframe
                  src={preview.url} title={preview.name}
                  className="w-full rounded-lg border border-gray-100"
                  style={{ height: '70vh' }}
                />
              )}
            </ModalBody>
          </ModalContent>
        </Modal>
      )}

      {/* hidden file input for replace */}
      <input ref={editFileRef} type="file" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) setEditFile(f);
        e.target.value = '';
      }} />

      {!isLoading && docs.length > 0 && (
        <div className="space-y-0.5">
          {docs.map((d: any) => {
            const cat = d.category || 'OTHER';
            const color = DOC_CATEGORY_COLORS[cat] ?? DOC_CATEGORY_COLORS.OTHER;
            const sizeKb = d.fileSize ? Math.round(d.fileSize / 1024) : null;
            const isEditing = editId === d.id;

            if (isEditing) {
              const saving = renameDoc.isPending || replaceDoc.isPending;
              return (
                <div key={d.id} className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Edit document</span>
                    <div className="flex gap-1">
                      <Button size="sm" isIconOnly variant="light" onPress={cancelEdit} aria-label="Cancel"><FiX className="w-3.5 h-3.5 text-gray-400" /></Button>
                      <Button size="sm" isIconOnly color="primary" onPress={handleSaveEdit} isLoading={saving} aria-label="Save"><FiCheck className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                  {editErr && <p className="text-xs text-red-700">{editErr}</p>}
                  <Input
                    size="sm" label="File name" value={editName}
                    onChange={(e) => { setEditName(e.target.value); setEditErr(null); }}
                    isInvalid={!!editErr}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm" variant="flat" color="default"
                      onPress={() => editFileRef.current?.click()}
                      startContent={<FiUpload className="w-3.5 h-3.5" />}
                    >
                      {editFile ? 'Change file' : 'Replace file'}
                    </Button>
                    {editFile
                      ? <span className="text-xs text-gray-600 truncate max-w-[160px]">{editFile.name}</span>
                      : <span className="text-xs text-gray-500">Current: {d.fileName}</span>
                    }
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button size="sm" variant="light" onPress={cancelEdit}>Cancel</Button>
                    <Button size="sm" color="primary" onPress={handleSaveEdit} isLoading={saving}>
                      {editFile ? 'Replace & save' : 'Save name'}
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div key={d.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-b-0 group">
                <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                  <FiFileText className="text-violet-500 w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-800 truncate">{d.fileName || d.name}</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium ${color.bg} ${color.text}`}>
                      {String(cat).replace(/_/g, ' ')}
                    </span>
                    {d.versionNumber > 1 && (
                      <span className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">v{d.versionNumber}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {d.uploadedBy?.name && <>by {d.uploadedBy.name} · </>}
                    {fmtDate(d.createdAt)}
                    {sizeKb && <> · {sizeKb < 1024 ? `${sizeKb} KB` : `${(sizeKb / 1024).toFixed(1)} MB`}</>}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {d.fileUrl && (() => {
                    const kind = docPreviewKind(d.fileUrl);
                    return kind !== 'other' ? (
                      <button
                        onClick={() => setPreview({ url: d.fileUrl, name: d.fileName || d.name, kind })}
                        className="inline-flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-700 font-medium bg-violet-50 hover:bg-violet-100 px-2.5 py-1.5 rounded-lg transition-colors"
                        aria-label={`Preview ${d.fileName || d.name}`}
                      >
                        <FiEye className="w-3.5 h-3.5" />
                        View
                      </button>
                    ) : null;
                  })()}
                  {d.fileUrl && (
                    <a
                      href={d.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors"
                      aria-label={`Open ${d.fileName || d.name}`}
                    >
                      <FiExternalLink className="w-3.5 h-3.5" />
                      Open
                    </a>
                  )}
                  {canUpload && (
                    <>
                      <button
                        onClick={() => openEdit(d)}
                        className="p-1.5 text-gray-300 hover:text-blue-600 transition-colors rounded opacity-0 group-hover:opacity-100"
                        title="Edit"
                      >
                        <FiEdit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(d.id, d.fileName || d.name)}
                        className="p-1.5 text-gray-300 hover:text-red-700 transition-colors rounded opacity-0 group-hover:opacity-100"
                        title="Delete"
                      >
                        <FiTrash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// Per-unit waitlist: leads that expressed interest in this unit (via LeadUnitInterest),
// oldest first. A demand signal independent of the single primary-unit link.
function UnitWaitlistPanel({ unitId }: { unitId: string }) {
  const { data, isLoading } = useUnitWaitlist(unitId);
  const rows: any[] = Array.isArray(data) ? data : [];
  if (!isLoading && rows.length === 0) return null;
  return (
    <div className="mb-5 sm:mb-6">
      <Section
        icon={<FiUsers className="w-4 h-4 text-rose-600" />}
        title="Waitlist"
        count={rows.length || undefined}
      >
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.interestId} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-[11px] font-medium text-gray-500 w-5 tabular-nums text-center">#{r.position}</span>
                <Avatar size="sm" name={r.lead?.name || 'Lead'} className="w-6 h-6 text-[11px] shrink-0" />
                <span className="text-sm font-medium text-gray-800 truncate">{r.lead?.name || 'Unnamed lead'}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.lead?.budget != null && (
                  <span className="text-xs text-gray-500 tabular-nums">${Number(r.lead.budget).toLocaleString()}</span>
                )}
                <Chip size="sm" color={LEAD_STATUS_COLORS[r.lead?.status] || 'default'} variant="flat" className="text-[11px]">
                  {(r.lead?.status || '').replace('_', ' ')}
                </Chip>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

const LEAD_SOURCES_LIST = ['WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'WALK_IN', 'SIGNAGE', 'COLD_CALL', 'EMAIL_CAMPAIGN', 'BROKER', 'LOOPNET', 'CREXI', 'OTHER'];

function UnitLeadsPanel({ unitId, projectId }: { unitId: string; projectId: string }) {
  const { data: leads, isLoading } = useLeads({ unitId });
  const leadsArr: any[] = Array.isArray(leads) ? leads : [];
  const [tab, setTab] = useState<'leads' | 'activity'>('leads');
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [leadForm, setLeadForm] = useState<Record<string, string>>({ name: '', email: '', phone: '', source: 'WEBSITE', status: 'NEW', budget: '' });
  const createLead = useCreateLead();
  const { hasPermission } = useAuthStore();
  const canAddLead = hasPermission('lead:create');

  const setLF = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setLeadForm((f) => ({ ...f, [field]: e.target.value }));

  const submitLead = async () => {
    if (!leadForm.name.trim()) return addToast({ title: 'Name is required', color: 'warning' });
    try {
      await createLead.mutateAsync({
        projectId,
        unitId,
        name: leadForm.name.trim(),
        email: leadForm.email || undefined,
        phone: leadForm.phone || undefined,
        source: leadForm.source || 'WEBSITE',
        status: leadForm.status || 'NEW',
        budget: leadForm.budget ? parseFloat(leadForm.budget) : undefined,
      });
      addToast({ title: 'Lead added', color: 'success' });
      setLeadForm({ name: '', email: '', phone: '', source: 'WEBSITE', status: 'NEW', budget: '' });
      setAddLeadOpen(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to add lead'), color: 'danger' });
    }
  };

  const activity = leadsArr
    .flatMap((l) =>
      (l.activities || []).map((a: any) => ({ ...a, leadName: l.name || 'Unnamed', leadStatus: l.status })),
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const tabToggle = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canAddLead && (
        <Button size="sm" variant="flat" color="primary" startContent={<FiTarget />} onPress={() => setAddLeadOpen(true)} className="text-xs h-7">
          Add Lead
        </Button>
      )}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
        {(['leads', 'activity'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t === 'leads' ? `Leads${leadsArr.length > 0 ? ` (${leadsArr.length})` : ''}` : 'Activity'}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <Modal isOpen={addLeadOpen} onClose={() => setAddLeadOpen(false)} size="md">
        <ModalContent>
          <ModalHeader>Add Lead to Unit</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Name" size="sm" value={leadForm.name} onChange={setLF('name')} className="sm:col-span-2" />
              <Input label="Email" size="sm" type="email" value={leadForm.email} onChange={setLF('email')} />
              <Input label="Phone" size="sm" value={leadForm.phone} onChange={setLF('phone')} />
              <Select label="Source" size="sm" selectedKeys={[leadForm.source]}
                onSelectionChange={(k) => { const v = Array.from(k)[0] as string; if (v) setLeadForm((f) => ({ ...f, source: v })); }}>
                {LEAD_SOURCES_LIST.map((s) => <SelectItem key={s} textValue={s.replace(/_/g, ' ')}>{s.replace(/_/g, ' ')}</SelectItem>)}
              </Select>
              <Select label="Status" size="sm" selectedKeys={[leadForm.status]}
                onSelectionChange={(k) => { const v = Array.from(k)[0] as string; if (v) setLeadForm((f) => ({ ...f, status: v })); }}>
                {['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING'].map((s) => (
                  <SelectItem key={s} textValue={s.replace(/_/g, ' ')}>{s.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Input label="Budget ($)" size="sm" type="number" value={leadForm.budget} onChange={setLF('budget')} />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setAddLeadOpen(false)}>Cancel</Button>
            <Button color="primary" onPress={submitLead} isLoading={createLead.isPending}>Add Lead</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    <Section
      icon={<FiTarget className="w-4 h-4 text-blue-600" />}
      title="Leads"
      action={tabToggle}
    >
      {isLoading && <div className="text-sm text-gray-500 py-6 text-center">Loading…</div>}

      {!isLoading && leadsArr.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <FiTarget className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-sm font-medium text-gray-500">No leads linked</p>
          <p className="text-xs text-gray-500">{canAddLead ? 'Click "Add Lead" to create one for this unit.' : 'Attach a lead from the Leads page or the project\'s Leads tab.'}</p>
        </div>
      )}

      {!isLoading && leadsArr.length > 0 && tab === 'leads' && (
        <div className="space-y-0.5">
          {leadsArr.map((lead) => (
            <div key={lead.id} className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
              <Avatar size="sm" name={lead.name || '?'} className="w-8 h-8 text-xs shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {lead.name || <span className="text-gray-500 italic font-normal">Unnamed</span>}
                  </p>
                  <Chip size="sm" color={LEAD_STATUS_COLORS[lead.status] || 'default'} variant="flat" className="text-[11px] h-5">
                    {String(lead.status).replace(/_/g, ' ')}
                  </Chip>
                  {lead.source && (
                    <span className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                      {String(lead.source).replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                  {lead.email && <span className="flex items-center gap-1"><FiMail className="w-3 h-3" />{lead.email}</span>}
                  {lead.phone && <span className="flex items-center gap-1"><FiPhone className="w-3 h-3" />{lead.phone}</span>}
                  {lead.budget && <span className="text-gray-500 font-medium">${Number(lead.budget).toLocaleString()}</span>}
                  {lead._count?.activities ? (
                    <span className="flex items-center gap-1"><FiMessageSquare className="w-3 h-3" />{lead._count.activities} activities</span>
                  ) : null}
                </div>
              </div>
              <div className="text-[11px] text-gray-500 shrink-0 flex items-center gap-1 mt-0.5">
                <FiClock className="w-3 h-3" />{fmtDate(lead.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && leadsArr.length > 0 && tab === 'activity' && (
        activity.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">No activity logged yet across leads on this unit.</div>
        ) : (
          <div className="space-y-0.5">
            {activity.map((a: any) => (
              <div key={a.id} className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 mt-0.5 bg-gray-100 text-gray-600`}>
                  {ACTIVITY_TYPE_LABELS[a.type] || a.type}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{a.note}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    <span className="font-medium text-gray-600">{a.leadName}</span>
                    {a.createdByUser?.name && <> · by {a.createdByUser.name}</>}
                    <> · {fmtDate(a.createdAt)}</>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </Section>
    </>
  );
}

