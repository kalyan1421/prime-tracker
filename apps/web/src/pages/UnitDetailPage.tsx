import { useParams, useNavigate } from 'react-router-dom';
import { useState, useRef, useMemo } from 'react';
import {
  Chip, Button, Avatar, Textarea, Select, SelectItem, Switch,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure, addToast,
} from '@heroui/react';
import { FiAlertTriangle, FiArrowLeft, FiSend, FiTrash2, FiMessageSquare, FiEdit2, FiTarget, FiMail, FiPhone, FiClock, FiFileText, FiDownload, FiHome, FiCreditCard, FiAlignLeft, FiCheck, FiX, FiUpload, FiEye, FiExternalLink, FiTrendingUp, FiChevronDown, FiChevronRight, FiDollarSign, FiLogOut, FiRepeat, FiLayers } from 'react-icons/fi';
import { useQueryClient } from '@tanstack/react-query';
import { MentionTextarea } from '../components/MentionTextarea';
import {
  useUnit, useUnitComments, useCreateComment, useDeleteComment, useUpdateUnit, useLeads, useDocuments,
  useUnitWaitlist, useCreateLead, useCreateLease, useUpdateLease, useCreateSale, useUploadDocument, useDeleteDocument,
  useRenameDocument, useReplaceDocument, useUnitFinancialSummary, useCustomOptions,
  useLeaseRentPeriods, useUnitObligationSummary, useAssignableUsers, useUnitHistory,
  useTasks,
  useLeaseRentInvoices,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';

const COMMENT_TYPE_COLORS: Record<string, string> = {
  MARKETING: 'bg-purple-100 text-purple-700',
  SALES: 'bg-blue-100 text-blue-700',
  FINANCIAL: 'bg-green-100 text-green-700',
};
import { fmt, fmtDate, fmtPct, errMsg } from '../utils/fmt';
import { StatusBadge, LoadingState, ErrorState, PermissionGate } from '../components/ui';
import { CommentChip, type CommentType } from '../components/CommentChip';
import { TimeOnMarketBar } from '../components/TimeOnMarketBar';
import { InteriorPanel } from '../components/InteriorPanel';
import { SoldUnitPanel } from '../components/SoldUnitPanel';
import { LeaseRentSchedule } from '../components/LeaseRentSchedule';
import { LeaseObligationsPanel } from '../components/LeaseObligationsPanel';
import { EndTenancyDialog, AssignTenantDialog } from '../components/TenancyTransitionDialogs';
import { UnitConstructionPanel } from '../components/ConstructionBoard';
import { BackfillTenancyDialog } from '../components/BackfillTenancyDialog';
import { HistoricalRecordControls } from '../components/HistoricalRecordControls';
import { RentCollectionPanel } from '../components/RentCollectionPanel';
import { ObligationSummaryCard } from '../components/ObligationSummaryCard';
import { EMPTY_LEASE, validateLeaseForm, buildLeasePayload, LeaseFormFields, leaseToForm } from '../components/LeaseFormFields';
import {
  TENANTED_STATUSES, tenancyState, fmtChangeValue, changeDelta, summariseChanges,
} from '../utils/tenancy';


const UNIT_STATUSES = ['AVAILABLE', 'UNDER_CONTRACT', 'LEASED', 'SOLD', 'OCCUPIED', 'UNDER_CONSTRUCTION'];

// Single metric cell used inside the unified key-metrics strip.
function Metric({ label, value, unit, accent, sub }: { label: string; value: string; unit?: string; accent?: string; sub?: string }) {
  return (
    <div className="p-4 sm:p-5">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">{label}</p>
      <p className={`mt-1.5 text-xl sm:text-2xl font-bold tabular-nums ${accent ?? 'text-gray-900'}`}>
        {value}
        {unit && <span className="text-sm font-medium text-gray-400 ml-1">{unit}</span>}
      </p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
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
  icon, title, count, action, children, empty, className = '',
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Short word for "there is nothing here" — e.g. "None". Collapses the body. */
  empty?: string | null;
  className?: string;
}) {
  if (empty) {
    return (
      <div className={`rounded-2xl border border-gray-200 bg-white ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            {icon}
            <h2 className="font-semibold text-sm text-gray-800">{title}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{empty}</span>
            {action}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          {icon}
          <h2 className="font-semibold text-sm text-gray-800">
            {title}
            {count != null && count > 0 && <span className="text-gray-400 font-normal ml-1">({count})</span>}
          </h2>
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
      <p className="text-sm text-gray-400">{text}</p>
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

  const tiles = [
    { label: 'Total vacant', value: daysLabel(summary.totalDaysVacant ?? 0), tone: 'text-gray-700', note: since },
    { label: 'Total leased', value: daysLabel(summary.totalDaysLeased ?? 0), tone: 'text-emerald-700', note: since },
    { label: 'Tenancies', value: String(summary.tenancyCount ?? 0), tone: 'text-gray-700', note: null },
    { label: 'Rent collected', value: fmt(summary.lifetimeRentCollected ?? 0), tone: 'text-emerald-700', note: null },
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
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t.label}</p>
            <p className={`text-sm font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
            {t.note && <p className="text-[10px] text-amber-600 mt-0.5">{t.note}</p>}
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
        <p className="text-xs text-gray-400 mt-2">
          Tracked history begins {fmtDate(summary.firstEventAt)} — earlier activity was never recorded.
          {' '}Add it with a historical record.
        </p>
      )}
    </div>
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
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      Current
                    </span>
                  )}
                  {e.isHistorical && (
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                      Historical
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.startDate)} – {e.isOngoing ? 'present' : fmtDate(e.endDate)}
                  {' · '}{fmt(e.data.monthlyRent)}/mo
                  {e.data.rentPerSqft != null && ` · ${fmt(e.data.rentPerSqft)}/sqft`}
                </p>
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
                  <p className="text-xs text-gray-400 mt-0.5">
                    Lease {String(e.data.status).toLowerCase()} · {durationLabel(e.startDate, e.endDate)}
                  </p>
                )}
              </>
            )}
            {e.kind === 'sale' && (
              <>
                <p className="text-sm font-medium text-gray-900">{e.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.startDate)}
                  {e.data.salePrice != null && ` · ${fmt(e.data.salePrice)}`}
                </p>
                {e.data.status === 'CANCELLED' && e.data.lostReason && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Reason: {String(e.data.lostReason).replace(/_/g, ' ')}
                  </p>
                )}
              </>
            )}
            {e.kind === 'vacancy' && (
              <p className="text-sm text-gray-400 italic">
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
                <span className="text-xs text-gray-400">
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
                    className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${
                      e.data.isScheduled ? 'bg-gray-100 text-gray-500' : 'bg-teal-100 text-teal-700'
                    }`}
                  >
                    {e.data.isScheduled ? 'Scheduled' : 'Manual'}
                  </span>
                  {/* The schedule is generated for the whole term, so most rows are
                      still ahead. Saying so keeps a "History" panel from asserting
                      future rent as though it had already been charged. */}
                  {e.isProjected && (
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">
                      Upcoming
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                  {fmtDate(e.startDate)}
                  {' · '}{fmt(e.data.from)} → {fmt(e.data.to)}/mo
                  <span className={e.data.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                    {' '}({e.data.delta >= 0 ? '+' : '−'}{fmt(Math.abs(e.data.delta))})
                  </span>
                  {e.data.escalationPct != null && ` · ${fmtPct(e.data.escalationPct)}`}
                </p>
                {e.data.reason && (
                  <p className="text-xs text-gray-400 mt-0.5">
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
                    <span className="text-gray-400"> · {summariseChanges(e.data.changes)}</span>
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
                          <span className="text-gray-400"> {fmtChangeValue(c.from, c.type)}</span>
                          <span className="text-gray-300"> → </span>
                          <span className="text-gray-800 font-medium">{fmtChangeValue(c.to, c.type)}</span>
                        </span>
                        {delta && (
                          <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 tabular-nums">
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
  leases, canEdit, canCollect, unitId, buildingId, unitStatus, onLeaseDeleted,
}: {
  leases: any[];
  canEdit: boolean;
  /** `rent:collect` — recording money received, deliberately not `lease:edit`. */
  canCollect: boolean;
  unitId: string | undefined;
  /** Needed so obligation writes invalidate the BUILDING rollup too, not just the unit's. */
  buildingId: string | undefined;
  unitStatus?: string;
  /** Refresh the unit + its timeline after a historical record is removed. */
  onLeaseDeleted?: () => void;
}) {
  // A sold unit's rent schedule is closed. Without this the page still offered
  // "Regenerate future" and "Add rent change", which would mint post-sale periods —
  // precisely the rows the timeline above suppresses as impossible. The API refuses
  // them too; this is so the button says so before it is clicked.
  const scheduleLocked =
    unitStatus === 'SOLD'
      ? 'This unit has been sold, so its rent schedule is closed. Rent cannot be scheduled ' +
        'for a unit Prime no longer owns.'
      : null;
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
          <div key={l.id}>
            <button
              type="button"
              onClick={() => toggle(l.id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-gray-400 shrink-0">
                  {open ? <FiChevronDown className="w-4 h-4" /> : <FiChevronRight className="w-4 h-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate flex items-center gap-2">
                    {l.tenantBrand || l.tenantName || 'Unnamed tenant'}
                    {ongoing ? (
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        Current
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        {String(l.status).toLowerCase()}
                      </span>
                    )}
                    {/* Says the ledger below was typed in, not observed — which changes how
                        much you should trust it and what it takes to delete it. */}
                    {l.isHistorical && (
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
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
              <div className="mt-3 space-y-5">
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    Rent schedule — what is owed
                  </p>
                  <LeaseRentSchedule leaseId={l.id} canEdit={canEdit} lockedReason={scheduleLocked} />
                </div>
                <div className="space-y-2">
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
                <div className="space-y-2">
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
                {l.isHistorical && <HistoricalRecordControls lease={l} onDeleted={onLeaseDeleted} />}
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
  const qc = useQueryClient();
  const { data: unit, isLoading, error } = useUnit(unitId!);

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
  const canEditUnit = hasPermission('unit:edit');
  const canEditSale = hasPermission('sales:edit');
  const canEditLease = hasPermission('lease:edit');
  const canViewLeases = hasPermission('lease:view');
  // Recording rent is `rent:collect`, not `lease:edit` — an AR/AP clerk banks a
  // cheque without being able to rewrite the lease terms behind it.
  const canCollectRent = hasPermission('rent:collect');
  const canViewBudget = hasPermission('budget:view');
  const { data: budgetSummary } = useUnitFinancialSummary(canViewBudget ? (unitId || '') : '');
  // Derived from `unit` (not `u`) because the early returns below sit between here and
  // where `activeLease` is computed — hooks cannot live after a conditional return.
  const activeLeaseId = (unit as any)?.leases?.find(
    (l: any) => !['EXPIRED', 'TERMINATED'].includes(l.status),
  )?.id as string | undefined;
  const { data: rentPeriods = [] } = useLeaseRentPeriods(activeLeaseId);
  const { data: obligationSummary } = useUnitObligationSummary(unitId);
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

  const openAddLease = (leaseStatus: string = 'ACTIVE') => {
    setLeaseIsNew(true);
    setLeaseEditId(null);
    setLeaseForm({ ...EMPTY_LEASE, unitId: unitId || '', status: leaseStatus });
    setLeaseErrors({});
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
    setLeaseModalOpen(true);
  };

  const handleSaveLease = async () => {
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
      setLeaseModalOpen(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save lease'), color: 'danger' });
    }
  };

  // Quick-add for a SOLD unit with no sale record yet. Editing an EXISTING closed
  // sale (buyer, price, dates, broker) happens inside SoldUnitPanel — this only
  // covers the case where the unit's status was flipped to SOLD but nobody has
  // recorded the deal yet, mirroring the "+ Add Lease" fallback above.
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [saleForm, setSaleForm] = useState<Record<string, string>>({
    buyer: '', salePrice: '', depositAmt: '', closingDate: '', notes: '',
  });
  const createSale = useCreateSale();

  const openAddSale = () => {
    setSaleForm({ buyer: '', salePrice: '', depositAmt: '', closingDate: '', notes: '' });
    setSaleModalOpen(true);
  };

  const handleSaveSale = async () => {
    if (!saleForm.salePrice) {
      return addToast({ title: 'Sale price is required', color: 'warning' });
    }
    const toDate = (d: string) => (d ? new Date(`${d}T12:00:00.000Z`).toISOString() : undefined);
    try {
      await createSale.mutateAsync({
        projectId: projectId!,
        unitId: unitId!,
        status: 'CLOSED',
        buyer: saleForm.buyer.trim() || undefined,
        salePrice: parseFloat(saleForm.salePrice),
        depositAmt: saleForm.depositAmt ? parseFloat(saleForm.depositAmt) : undefined,
        closingDate: toDate(saleForm.closingDate),
        notes: saleForm.notes.trim() || undefined,
      });
      addToast({ title: 'Sale recorded', color: 'success' });
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
    (useLeaseRentInvoices(leaseEditId ?? undefined).data as any[]) ?? [];
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
          status: form.status || undefined,
          sqft: form.sqft ? parseInt(form.sqft, 10) : null,
          askingPrice: form.askingPrice ? parseFloat(form.askingPrice) : null,
          askingRent: form.askingRent ? parseFloat(form.askingRent) : null,
          primeOwned,
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
              {/* Slice 4: time-on-market shown only for AVAILABLE units */}
              {u.status === 'AVAILABLE' && u.availableSince && (
                <TimeOnMarketBar availableSince={u.availableSince} />
              )}
              {u.primeOwned && <Chip size="sm" color="success" variant="flat">Prime Owned</Chip>}
            </div>
          </div>
          <Button size="sm" variant="flat" color="primary" startContent={<FiEdit2 />} onPress={openEdit} className="shrink-0 font-medium">
            Edit
          </Button>
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
              <Input
                label="Size (sqft)"
                type="number"
                value={form.sqft ?? ''}
                onChange={set('sqft')}
                size="sm"
              />
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
            <div className="mt-3">
              <Switch isSelected={primeOwned} onValueChange={setPrimeOwned} size="sm">
                Prime Owned
              </Switch>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>Cancel</Button>
            <Button color="primary" onPress={handleSave} isLoading={updateUnit.isPending}>Save</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Lease Modal */}
      <Modal isOpen={leaseModalOpen} onClose={() => setLeaseModalOpen(false)} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>{leaseIsNew ? 'Add Lease' : 'Edit Lease'}</ModalHeader>
          <ModalBody>
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
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setLeaseModalOpen(false)}>Cancel</Button>
            <Button color="primary" onPress={handleSaveLease} isLoading={createLease.isPending || updateLease.isPending}>
              {leaseIsNew ? 'Add Lease' : 'Save Changes'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Add Sale Modal — quick-add for a SOLD unit with no sale record yet.
          Broker attribution and further edits happen inside SoldUnitPanel once
          this exists. */}
      <Modal isOpen={saleModalOpen} onClose={() => setSaleModalOpen(false)} size="md">
        <ModalContent>
          <ModalHeader>Add Sale</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Buyer" size="sm" value={saleForm.buyer} onChange={setSale('buyer')} className="sm:col-span-2" />
              <Input label="Sale Price ($)" size="sm" type="number" value={saleForm.salePrice} onChange={setSale('salePrice')} />
              <Input label="Deposit Amount ($)" size="sm" type="number" value={saleForm.depositAmt} onChange={setSale('depositAmt')} />
              <Input label="Closing Date" size="sm" type="date" value={saleForm.closingDate} onChange={setSale('closingDate')} className="sm:col-span-2" />
              <Input label="Notes" size="sm" value={saleForm.notes} onChange={setSale('notes')} className="sm:col-span-2" />
            </div>
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

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 rounded-2xl border border-gray-200 bg-white overflow-hidden mb-5 sm:mb-6 divide-x divide-y md:divide-y-0 divide-gray-100">
        <Metric label="Size" value={u.sqft ? `${u.sqft.toLocaleString()}` : '\u2014'} unit={u.sqft ? 'sqft' : undefined} />
        {u.status === 'SOLD' ? (() => {
          const closedSale = u.sales?.find((s: any) => s.status === 'CLOSED');
          const sp = closedSale?.salePrice != null ? Number(closedSale.salePrice) : null;
          const soldPsf = sp && u.sqft ? (sp / u.sqft).toFixed(2) : null;
          return (
            <>
              <Metric label="Sale Price" value={sp != null ? fmt(sp) : '\u2014'} accent="text-emerald-600" />
              <Metric label="Price PSF" value={soldPsf ? `$${soldPsf}` : '\u2014'} />
              <Metric label="Closed" value={fmtDate(closedSale?.closingDate)} />
            </>
          );
        })() : (
          <>
            <Metric label="Asking Price" value={u.askingPrice ? fmt(u.askingPrice) : '\u2014'} accent="text-emerald-600" />
            <Metric label="Price PSF" value={psf ? `$${psf}` : '\u2014'} />
            <Metric label="Asking Rent" value={u.askingRent ? fmt(u.askingRent) : '\u2014'} unit={u.askingRent ? '/mo' : undefined} accent="text-emerald-600" sub={rentPsf ? `$${rentPsf}/sqft/yr` : undefined} />
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
              <span className="text-xs text-gray-400 shrink-0">Ask someone with sales access to record it.</span>
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
      <div className="columns-1 lg:columns-2 gap-5 sm:gap-6 mb-5 sm:mb-6 [&>*]:break-inside-avoid [&>*]:mb-5 sm:[&>*]:mb-6">
        {/* Active Lease / Tenant Profile — hidden for SOLD units */}
        {u.status !== 'SOLD' && <Section
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
                  className="text-gray-400 hover:text-violet-600 transition-colors p-1 rounded"
                  title="Assign lease to a new tenant (the lease itself continues)"
                >
                  <FiRepeat className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setEndLease(activeLease)}
                  className="text-gray-400 hover:text-rose-600 transition-colors p-1 rounded"
                  title="End tenancy — records the move-out and releases the unit"
                >
                  <FiLogOut className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => openEditLease(activeLease)}
                  className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded"
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
            /* A past tenancy is dimmed as a whole, so the page never reads as though
               someone is still in the unit. */
            <div className={`space-y-4 ${tenancy!.isPast ? 'opacity-60' : ''}`}>
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
                    <p className="text-[11px] text-gray-400 italic truncate">{shownLease.tenantLegalName}</p>
                  )}
                  {shownLease.tenantContact && (
                    <p className="text-xs text-blue-600 mt-0.5 truncate">{shownLease.tenantContact}</p>
                  )}
                </div>
                <div className="shrink-0">
                  {/* Derived, not `status`. A lease whose term ran out last month must
                      not wear a green "Active" chip just because nobody closed it. */}
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${tenancy!.chip}`}>
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

              {/* Financial highlight */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-emerald-50 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">Monthly Rent</p>
                  <p className="text-lg font-bold text-emerald-700 tabular-nums mt-0.5">{fmt(shownLease.monthlyRent)}</p>
                  {shownLease.rentPerSqft && (
                    <p className="text-[10px] text-emerald-600">${Number(shownLease.rentPerSqft).toFixed(2)}/sqft/mo</p>
                  )}
                </div>
                {shownLease.securityDeposit && (
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Deposit</p>
                    <p className="text-lg font-bold text-slate-700 tabular-nums mt-0.5">{fmt(shownLease.securityDeposit)}</p>
                    {depositAgreed > 0 && (
                      <p className="text-[10px] text-slate-500">
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
                  <span className={`${new Date(shownLease.leaseEnd) < new Date() ? 'text-red-600' : 'text-gray-700'}`}>
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
                    <span className="text-gray-400">None</span>
                  )}
                </Row>
                {/* TI flows Prime -> tenant, the opposite direction to the deposit, so it
                    is never summed with it. Sourced from the lease obligation ledger. */}
                <Row label="TI allowance">
                  {tiAgreed > 0 ? (
                    <span className="text-gray-700">
                      {fmt(tiAgreed)}
                      <span className="text-gray-400">
                        {tiPending > 0 ? ` · ${fmt(tiPending)} left to fund` : ' · fully funded'}
                      </span>
                    </span>
                  ) : (
                    <span className="text-gray-400">None</span>
                  )}
                </Row>
              </dl>
            </div>
          ) : (
            <EmptyRow icon={<FiHome className="w-5 h-5" />} text="No active lease" />
          )}
        </Section>}

        {/* Construction — the site work covering this unit. Sits beside the tenant and
            rent history on purpose: "is anything happening to this unit" and "who is in
            it" are the two questions this page exists to answer, and until now the first
            one lived in Monday. */}
        <Section
          icon={<FiLayers className="w-4 h-4 text-amber-600" />}
          title="Construction"
          count={constructionItems.length}
          empty={constructionItems.length ? null : 'None'}
        >
          <UnitConstructionPanel unitId={unitId!} canEdit={hasPermission('task:edit')} />
        </Section>

        {/* Linked Loans */}
        <Section
          icon={<FiCreditCard className="w-4 h-4 text-violet-600" />}
          title="Linked Loans"
          count={u.loans?.length}
          empty={u.loans?.length ? null : 'None'}
        >
          {u.loans?.length > 0 ? (
            <div className="space-y-4">
              {u.loans.map((loan: any) => (
                <dl key={loan.id} className="text-sm divide-y divide-gray-100 rounded-xl border border-gray-100 px-3">
                  <Row label="Lender"><span className="font-medium text-gray-900">{loan.lender || '\u2014'}</span></Row>
                  <Row label="Type"><span className="text-gray-700">{loan.loanType?.replace(/_/g, ' ') || '\u2014'}</span></Row>
                  <Row label="Monthly Payment"><span className="text-gray-700 tabular-nums">{loan.monthlyPayment ? fmt(loan.monthlyPayment) : '\u2014'}</span></Row>
                  <Row label="Principal"><span className="text-gray-700 tabular-nums">{loan.principalAmt ? fmt(loan.principalAmt) : '\u2014'}</span></Row>
                </dl>
              ))}
            </div>
          ) : (
            <EmptyRow icon={<FiCreditCard className="w-5 h-5" />} text="No linked loans" />
          )}
        </Section>

        {/* Budget — budget/committed/actual/remaining scoped to this unit */}
        {canViewBudget && (
          <Section icon={<FiCreditCard className="w-4 h-4 text-emerald-600" />} title="Budget">
            <dl className="text-sm divide-y divide-gray-100">
              <Row label="Budget"><span className="text-gray-700 tabular-nums">{fmt(Number((budgetSummary as any)?.budgetTotal ?? 0))}</span></Row>
              <Row label="Committed"><span className="text-gray-700 tabular-nums">{fmt(Number((budgetSummary as any)?.committedTotal ?? 0))}</span></Row>
              <Row label="Actual"><span className="text-gray-700 tabular-nums">{fmt(Number((budgetSummary as any)?.actualTotal ?? 0))}</span></Row>
              <Row label="Remaining">
                <span className={`tabular-nums font-medium ${Number((budgetSummary as any)?.variance ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {fmt(Number((budgetSummary as any)?.variance ?? 0))}
                </span>
              </Row>
            </dl>
          </Section>
        )}
      </div>

      {/* History — full lease + sale timeline, survives the unit changing status
          (e.g. a past tenant stays visible after the unit is later sold) */}
      <div className="mb-5 sm:mb-6">
        <Section icon={<FiClock className="w-4 h-4 text-slate-600" />} title="History">
          <UnitHistoryTimeline unitId={unitId} />
        </Section>
      </div>

      {/* Rent & deposits — deliberately directly under History. History answers
          "who was here and when"; this answers "how much, and when did it change"
          for those same leases, so the drill-down sits against the summary it
          expands rather than at the foot of the page. Not rendered inside a
          Section: LeaseRentSchedule, RentCollectionPanel, LeaseObligationsPanel and
          ObligationSummaryCard bring their own card chrome and would otherwise be a
          card inside a card.

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
                  <span className="text-gray-400 font-normal ml-1">({u.leases.length} leases)</span>
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
            unitStatus={u.status}
            onLeaseDeleted={refreshUnit}
          />
        </div>
      )}

      {/* Notes — always visible so users can add notes even when empty */}
      {(u.notes || canEditUnit) && (
        <div className="mb-5 sm:mb-6">
          <Section
            icon={<FiAlignLeft className="w-4 h-4 text-amber-600" />}
            title="Notes"
            action={canEditUnit && !editingNotes ? (
              <button
                onClick={() => { setNotesDraft(u.notes ?? ''); setEditingNotes(true); }}
                className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded"
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
                {u.notes || <span className="text-gray-400 italic">No notes yet{canEditUnit ? ' — click edit to add' : ''}</span>}
              </p>
            )}
          </Section>
        </div>
      )}

      {/* Leads & Activity */}
      <div className="mb-5 sm:mb-6">
        <UnitLeadsPanel unitId={unitId!} projectId={projectId!} />
      </div>

      {/* Waitlist — demand signal */}
      <UnitWaitlistPanel unitId={unitId!} />

      {/* Interior / Fit-Out */}
      <PermissionGate permission="interior:view">
        <div className="mb-5 sm:mb-6">
          <InteriorPanel
            unitId={unitId!}
            unitNumber={(unit as any)?.unitNumber}
            unitSqft={(unit as any)?.sqft != null ? Number((unit as any).sqft) : undefined}
          />
        </div>
      </PermissionGate>

      {/* Documents scoped to this unit */}
      <div className="mb-5 sm:mb-6">
        <UnitDocumentsPanel unitId={unitId!} />
      </div>

      {/* Comments */}
      <div className="mb-5 sm:mb-6">
        <Section
          icon={<FiMessageSquare className="w-4 h-4 text-purple-600" />}
          title="Comments"
          count={u._count?.comments > 0 ? u._count.comments : undefined}
        >
          <InlineComments unitId={unitId!} />
        </Section>
      </div>
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
  OTHER:                  { bg: 'bg-zinc-100',    text: 'text-zinc-700' },
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
      icon={<FiFileText className="w-4 h-4 text-violet-600" />}
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

      {isLoading && <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>}

      {!isLoading && docs.length === 0 && !showUploadForm && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
            <FiFileText className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-sm font-medium text-gray-500">No documents yet</p>
          {canUpload
            ? <p className="text-xs text-gray-400">Click <span className="font-medium text-gray-500">Upload</span> to attach a file directly to this unit.</p>
            : <p className="text-xs text-gray-400">Upload from the project's Documents tab.</p>
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
                  {editErr && <p className="text-xs text-red-500">{editErr}</p>}
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
                      : <span className="text-xs text-gray-400">Current: {d.fileName}</span>
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
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium ${color.bg} ${color.text}`}>
                      {String(cat).replace(/_/g, ' ')}
                    </span>
                    {d.versionNumber > 1 && (
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">v{d.versionNumber}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
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
                        className="p-1.5 text-gray-300 hover:text-blue-500 transition-colors rounded opacity-0 group-hover:opacity-100"
                        title="Edit"
                      >
                        <FiEdit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(d.id, d.fileName || d.name)}
                        className="p-1.5 text-gray-300 hover:text-red-500 transition-colors rounded opacity-0 group-hover:opacity-100"
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
        icon={<FiTarget className="w-4 h-4 text-rose-600" />}
        title="Waitlist"
        count={rows.length || undefined}
      >
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.interestId} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-[11px] font-medium text-gray-400 w-5 tabular-nums text-center">#{r.position}</span>
                <Avatar size="sm" name={r.lead?.name || 'Lead'} className="w-6 h-6 text-[9px] shrink-0" />
                <span className="text-sm font-medium text-gray-800 truncate">{r.lead?.name || 'Unnamed lead'}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.lead?.budget != null && (
                  <span className="text-xs text-gray-500 tabular-nums">${Number(r.lead.budget).toLocaleString()}</span>
                )}
                <Chip size="sm" color={LEAD_STATUS_COLORS[r.lead?.status] || 'default'} variant="flat" className="text-[10px]">
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
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
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
      {isLoading && <div className="text-sm text-gray-400 py-6 text-center">Loading…</div>}

      {!isLoading && leadsArr.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <FiTarget className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-sm font-medium text-gray-500">No leads linked</p>
          <p className="text-xs text-gray-400">{canAddLead ? 'Click "Add Lead" to create one for this unit.' : 'Attach a lead from the Leads page or the project\'s Leads tab.'}</p>
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
                    {lead.name || <span className="text-gray-400 italic font-normal">Unnamed</span>}
                  </p>
                  <Chip size="sm" color={LEAD_STATUS_COLORS[lead.status] || 'default'} variant="flat" className="text-[10px] h-5">
                    {String(lead.status).replace(/_/g, ' ')}
                  </Chip>
                  {lead.source && (
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                      {String(lead.source).replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                  {lead.email && <span className="flex items-center gap-1"><FiMail className="w-3 h-3" />{lead.email}</span>}
                  {lead.phone && <span className="flex items-center gap-1"><FiPhone className="w-3 h-3" />{lead.phone}</span>}
                  {lead.budget && <span className="text-gray-500 font-medium">${Number(lead.budget).toLocaleString()}</span>}
                  {lead._count?.activities ? (
                    <span className="flex items-center gap-1"><FiMessageSquare className="w-3 h-3" />{lead._count.activities} activities</span>
                  ) : null}
                </div>
              </div>
              <div className="text-[11px] text-gray-400 shrink-0 flex items-center gap-1 mt-0.5">
                <FiClock className="w-3 h-3" />{fmtDate(lead.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && leadsArr.length > 0 && tab === 'activity' && (
        activity.length === 0 ? (
          <div className="text-sm text-gray-400 py-6 text-center">No activity logged yet across leads on this unit.</div>
        ) : (
          <div className="space-y-0.5">
            {activity.map((a: any) => (
              <div key={a.id} className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium shrink-0 mt-0.5 bg-gray-100 text-gray-600`}>
                  {ACTIVITY_TYPE_LABELS[a.type] || a.type}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{a.note}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
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

function InlineComments({ unitId }: { unitId: string }) {
  const { data, isLoading } = useUnitComments(unitId);
  const createComment = useCreateComment();
  const deleteComment = useDeleteComment();
  // /users/assignable is gated on project:view, which every role holds — unlike
  // /users (user:manage), which would 403 for anyone who can actually post a comment.
  const { data: mentionUsers } = useAssignableUsers();
  const [text, setText] = useState('');
  const [commentType, setCommentType] = useState('MARKETING');

  const comments = ((data as any[]) || []).slice().sort((a: any, b: any) => {
    const ORDER = ['MARKETING', 'SALES', 'FINANCIAL'];
    const ai = ORDER.indexOf(a.commentType);
    const bi = ORDER.indexOf(b.commentType);
    if (ai !== bi) return ai - bi;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const handleSubmit = async () => {
    if (!text.trim()) return;
    try {
      await createComment.mutateAsync({ unitId, content: text.trim(), commentType });
      setText('');
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to add comment'), color: 'danger' });
    }
  };

  return (
    <div>
      {isLoading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-gray-400 mb-3">No comments yet</p>
      ) : (
        <div className="space-y-3 mb-4">
          {comments.map((c: any) => (
            <div key={c.id} className="flex gap-2">
              <Avatar size="sm" name={c.user?.name} src={c.user?.avatarUrl} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold">{c.user?.name}</span>
                  <CommentChip type={c.commentType as CommentType} size="sm" />
                  <span className="text-xs text-gray-400">{fmtDate(c.createdAt)}</span>
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    isIconOnly
                    className="ml-auto h-5 w-5 min-w-5"
                    onPress={() => deleteComment.mutate({ id: c.id, source: 'unit' })}
                  >
                    <FiTrash2 className="text-[10px]" />
                  </Button>
                </div>
                <p className="text-sm text-gray-700 break-words">{c.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <Select
          size="sm"
          aria-label="Comment type"
          className="w-full sm:w-[140px]"
          selectedKeys={[commentType]}
          onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string; if (v) setCommentType(v); }}
        >
          {['MARKETING', 'SALES', 'FINANCIAL'].map((t) => <SelectItem key={t}>{t}</SelectItem>)}
        </Select>
        <MentionTextarea
          minRows={1}
          maxRows={3}
          placeholder="Add a comment… use @ to mention someone"
          value={text}
          onChange={setText}
          onSubmit={handleSubmit}
          users={(mentionUsers as any[]) || []}
          className="flex-1"
        />
        <Button size="sm" color="primary" isIconOnly onPress={handleSubmit} isLoading={createComment.isPending} className="self-start sm:self-auto">
          <FiSend />
        </Button>
      </div>
    </div>
  );
}
