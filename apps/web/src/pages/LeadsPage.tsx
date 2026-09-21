import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Card, CardBody, Button, Input, Select, SelectItem, Chip, Avatar,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Textarea, Tooltip, useDisclosure, addToast,
} from '@heroui/react';
import {
  FiTarget, FiPlus, FiEdit2, FiTrash2, FiPhone, FiMail,
  FiMessageSquare, FiRefreshCw, FiSearch, FiClock, FiChevronRight,
  FiHome, FiBarChart2, FiUser, FiUsers, FiCalendar, FiPhoneCall, FiGrid, FiList, FiX,
} from 'react-icons/fi';
import {
  useLeads, useLeadActivities, useProjectOptions, useUnits, useBuildings, useCampaigns, useUsers, useAssignableUsers,
  useCreateLead, useUpdateLead, useDeleteLead, useAddLeadActivity, useConvertLead,
  useLead, useAddLeadInterest, useRemoveLeadInterest, useBrokers, useCustomOptions,
  useSiteVisits, useSiteVisit, useCancelSiteVisit,
} from '../hooks/useApi';
import { RequestSiteVisitModal } from '../components/RequestSiteVisitModal';
import { RecordVisitOutcomeModal } from '../components/RecordVisitOutcomeModal';
import { LeadCallCalendar } from '../components/LeadCallCalendar';
import { LeadsGrid } from '../components/LeadsGrid';
import { LeadsCalendar } from '../components/LeadsCalendar';
import { LeadCommentThread } from '../components/LeadCommentThread';
import { fmtDate, errMsg } from '../utils/fmt';
import { LoadingState, ErrorState, EmptyState, Pagination, wideSelectProps } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { LeadDocumentsPanel } from '../components/LeadDocumentsPanel';
import { usePagination } from '../hooks/usePagination';

/**
 * Days until a follow-up is due: negative = overdue, 0 = today, positive = upcoming.
 * null when no date is set.
 *
 * Compared as CALENDAR DAYS, not instants. followUpDate is a DATE column and arrives as
 * UTC midnight, so a naive `new Date(x) < new Date()` marks today's follow-up overdue for
 * every hour of the local day after midnight UTC — the same timezone trap that already
 * produced a time-of-day-dependent test failure elsewhere in this repo.
 */
function followUpDays(lead: any): number | null {
  if (!lead?.followUpDate) return null;
  const d = String(lead.followUpDate).slice(0, 10).split('-').map(Number);
  if (d.length !== 3 || d.some(Number.isNaN)) return null;
  const due = Date.UTC(d[0], d[1] - 1, d[2]);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86_400_000);
}

// Sentinel for the "no campaign" chip. A real campaign id can never collide with it.
const NO_CAMPAIGN = '__none__';

const LEAD_SOURCES = ['WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'WALK_IN', 'SIGNAGE', 'COLD_CALL', 'EMAIL_CAMPAIGN', 'BROKER', 'LOOPNET', 'CREXI', 'OTHER'];
const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'FOLLOW_UP', 'NOTE', 'STATUS_CHANGE'];

const PAGE_SIZE = 20;

const STATUS_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger'> = {
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

// Subtle dark-accent tokens for chips/rails. Per the redesign brief: tinted background
// + darker text (~700) instead of saturated solid fills. Pairs all meet 4.5:1 contrast
// on white (WCAG AA — Quick Reference §1 color-contrast).
const STATUS_TOKEN: Record<string, { bg: string; text: string; dot: string; rail: string }> = {
  NEW:           { bg: 'bg-gray-100',   text: 'text-gray-700',   dot: 'bg-gray-400',   rail: 'bg-gray-300' },
  CONTACTED:     { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500',    rail: 'bg-blue-500' },
  POTENTIAL:     { bg: 'bg-sky-50',      text: 'text-sky-700',     dot: 'bg-sky-500',     rail: 'bg-sky-500' },
  QUALIFIED:     { bg: 'bg-indigo-50',   text: 'text-indigo-700',  dot: 'bg-indigo-500',  rail: 'bg-indigo-500' },
  SITE_VISIT:    { bg: 'bg-teal-50',     text: 'text-teal-700',    dot: 'bg-teal-500',    rail: 'bg-teal-500' },
  PROPOSAL_SENT: { bg: 'bg-violet-50',   text: 'text-violet-700',  dot: 'bg-violet-500',  rail: 'bg-violet-500' },
  NEGOTIATING:   { bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-500',   rail: 'bg-amber-500' },
  CONVERTED:     { bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500', rail: 'bg-emerald-500' },
  LOST:          { bg: 'bg-rose-50',     text: 'text-rose-700',    dot: 'bg-rose-500',    rail: 'bg-rose-500' },
  DEAD:          { bg: 'bg-gray-100',    text: 'text-gray-600',    dot: 'bg-gray-400',    rail: 'bg-gray-400' },
};

// "Stale" = no activity in 14+ days, and not in a terminal status (CONVERTED/LOST/DEAD).
// The 14-day threshold is intentionally aggressive so reps notice deals going cold
// — escalates to red at 30 days. Matches the dashboard's stale-leads list.
function staleDays(lead: { updatedAt: string; status: string }): number | null {
  if (['CONVERTED', 'LOST', 'DEAD'].includes(lead.status)) return null;
  const days = Math.floor((Date.now() - new Date(lead.updatedAt).getTime()) / 86_400_000);
  return days >= 14 ? days : null;
}

const SOURCE_LABELS: Record<string, string> = {
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  SOCIAL_MEDIA: 'Social Media',
  WALK_IN: 'Walk-In',
  SIGNAGE: 'Signage',
  COLD_CALL: 'Cold Call',
  EMAIL_CAMPAIGN: 'Email Campaign',
  BROKER: 'Broker',
  LOOPNET: 'LoopNet',
  CREXI: 'Crexi',
  EVENT: 'Event',
  OTHER: 'Other',
};

function ActivityTimeline({ leadId }: { leadId: string }) {
  const { data: activities, isLoading } = useLeadActivities(leadId);
  const addActivity = useAddLeadActivity();
  const [type, setType] = useState('NOTE');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!note.trim()) return;
    try {
      await addActivity.mutateAsync({ leadId, data: { type, note: note.trim() } });
      setNote('');
      setType('NOTE');
      setAdding(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to add activity'), color: 'danger' });
    }
  };

  // Tinted Feather icons, matching every other icon on this page (FiHome, FiMail,
  // FiBarChart2…) — raw emoji render differently per OS/browser and sit outside the
  // app's color-token system.
  const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
    CALL: <FiPhone className="w-3.5 h-3.5" />,
    EMAIL: <FiMail className="w-3.5 h-3.5" />,
    MEETING: <FiUsers className="w-3.5 h-3.5" />,
    SITE_VISIT: <FiHome className="w-3.5 h-3.5" />,
    FOLLOW_UP: <FiClock className="w-3.5 h-3.5" />,
    NOTE: <FiMessageSquare className="w-3.5 h-3.5" />,
    STATUS_CHANGE: <FiRefreshCw className="w-3.5 h-3.5" />,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Activity Timeline</p>
        <Button size="sm" variant="flat" color="primary" onPress={() => setAdding((v) => !v)}>
          <FiPlus /> Log Activity
        </Button>
      </div>

      {adding && (
        <Card shadow="sm" className="border border-blue-100">
          <CardBody className="space-y-3">
            <Select
              size="sm"
              label="Activity Type"
              selectedKeys={new Set([type])}
              onSelectionChange={(keys) => setType(Array.from(keys)[0] as string)}
            >
              {ACTIVITY_TYPES.map((t) => (
                <SelectItem key={t} textValue={t.replace('_', ' ')}>{t.replace('_', ' ')}</SelectItem>
              ))}
            </Select>
            <Textarea
              size="sm"
              label="Notes"
              placeholder="Add a note..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              minRows={2}
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="light" onPress={() => { setAdding(false); setNote(''); }}>Cancel</Button>
              <Button size="sm" color="primary" onPress={handleAdd} isLoading={addActivity.isPending} isDisabled={!note.trim()}>
                Save
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {isLoading && <p className="text-sm text-gray-500 text-center py-4">Loading...</p>}
      {!isLoading && (!activities || activities.length === 0) && (
        <p className="text-sm text-gray-500 text-center py-4">No activities yet</p>
      )}
      <div className="space-y-2">
        {(activities || []).map((act: any) => (
          <div key={act.id} className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center shrink-0">
              {ACTIVITY_ICONS[act.type] || <FiMessageSquare className="w-3.5 h-3.5" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-gray-700">{act.type.replace('_', ' ')}</p>
                <span className="text-[11px] text-gray-500">{fmtDate(act.createdAt)}</span>
                {act.createdByUser && (
                  <span className="text-[11px] text-gray-500">· {act.createdByUser.name}</span>
                )}
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{act.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConvertToSaleModal({ isOpen, onClose, lead }: { isOpen: boolean; onClose: () => void; lead: any }) {
  const { data: units } = useUnits(lead?.projectId || '');
  const convertLead = useConvertLead();
  const [form, setForm] = useState({ unitId: '', buyer: lead?.name || '', salePrice: lead?.budget ? String(Number(lead.budget)) : '', contractDate: '', closingDate: '' });
  const setF = (f: string, v: string) => setForm((prev) => ({ ...prev, [f]: v }));

  const availableUnits = ((units as any[]) || []).filter((u: any) => u.status !== 'SOLD');

  const handleConvert = async () => {
    if (!form.unitId || !form.buyer || !form.salePrice) {
      addToast({ title: 'Unit, buyer name, and sale price are required', color: 'warning' });
      return;
    }
    if (form.contractDate && form.closingDate && new Date(form.contractDate) > new Date(form.closingDate)) {
      addToast({ title: 'Expected close date must be after contract date', color: 'warning' });
      return;
    }
    try {
      await convertLead.mutateAsync({
        id: lead.id,
        unitId: form.unitId,
        saleData: { buyer: form.buyer, salePrice: parseFloat(form.salePrice), contractDate: form.contractDate || undefined, closingDate: form.closingDate || undefined },
      });
      addToast({ title: 'Lead converted to sale!', color: 'success' });
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to convert lead'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} scrollBehavior="inside" size="md">
      <ModalContent>
        <ModalHeader>Convert Lead to Sale</ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">This will create a new sale record and mark the lead as Converted.</p>
            <Select
              size="sm"
              label="Unit *"
              selectedKeys={form.unitId ? new Set([form.unitId]) : new Set()}
              onSelectionChange={(k) => setF('unitId', Array.from(k)[0] as string)}
            >
              {availableUnits.map((u: any) => (
                <SelectItem key={u.id} textValue={`${u.unitNumber} — ${u.building?.name || ''} (${u.status})`}>{u.unitNumber} — {u.building?.name || ''} ({u.status})</SelectItem>
              ))}
            </Select>
            <Input size="sm" label="Buyer Name *" value={form.buyer} onChange={(e) => setF('buyer', e.target.value)} />
            <Input size="sm" label="Sale Price ($) *" type="number" min={0} value={form.salePrice} onChange={(e) => setF('salePrice', e.target.value)} />
            <Input size="sm" label="Contract Date" type="date" value={form.contractDate} onChange={(e) => setF('contractDate', e.target.value)} />
            <Input size="sm" label="Expected Close Date" type="date" value={form.closingDate} onChange={(e) => setF('closingDate', e.target.value)} />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="success" onPress={handleConvert} isLoading={convertLead.isPending}>
            Convert to Sale
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function LeadDetailPanel({ lead: selected, onClose }: { lead: any; onClose: () => void }) {
  const { isOpen: isConvertOpen, onOpen: onConvertOpen, onClose: onConvertClose } = useDisclosure();
  const { isOpen: isVisitOpen, onOpen: onVisitOpen, onClose: onVisitClose } = useDisclosure();
  const { hasPermission } = useAuthStore();
  const updateLead = useUpdateLead();

  // The parent holds the clicked row as component state, so it is a snapshot taken at
  // click time — an edit made from inside this panel invalidated the query but left
  // that snapshot untouched, and the panel kept showing the old status. Prefer the
  // live record and fall back to the snapshot only until the first fetch lands.
  const { data: fresh } = useLead(selected?.id);
  const lead = fresh ?? selected;
  // Status options are configurable per org, so read them rather than hard-coding
  // the enum — the same source the filter chips and the edit form use.
  const { data: statusOpts = [] } = useCustomOptions('lead_status');

  // Moving a lead along the pipeline is the single most frequent action on this page,
  // and it used to require opening the edit modal, changing one field and saving.
  // The project Leads tab already had an inline control; this makes the two match.
  const changeStatus = async (next: string) => {
    if (!next || next === lead.status) return;
    try {
      await updateLead.mutateAsync({ id: lead.id, data: { status: next } });
      addToast({ title: `Moved to ${next.replace('_', ' ').toLowerCase()}`, color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not update status'), color: 'danger' });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-800">{lead.name || 'Unnamed Lead'}</h3>
          <p className="text-xs text-gray-500">{lead.project?.name}</p>
        </div>
        <Select
          aria-label="Lead status"
          size="sm"
          variant="flat"
          className="w-[150px] shrink-0"
          selectedKeys={lead.status ? new Set([lead.status]) : new Set()}
          isDisabled={updateLead.isPending}
          onSelectionChange={(keys) => changeStatus(Array.from(keys)[0] as string)}
          renderValue={() => (
            <span className="text-xs font-semibold uppercase tracking-wide">
              {(lead.status || '').replace('_', ' ')}
            </span>
          )}
        >
          {(statusOpts as any[]).map((o) => (
            <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
          ))}
        </Select>
        {/* The panel opens by clicking a row but had no way out — on narrow screens it
            sits under the list and pushes everything down with no exit. */}
        <Tooltip content="Close">
          <Button
            isIconOnly size="sm" variant="light"
            aria-label="Close lead details"
            className="shrink-0 -mr-1"
            onPress={onClose}
          >
            <FiX className="w-4 h-4" />
          </Button>
        </Tooltip>
      </div>

      {/* The linked unit/building. The lead card shows this, but the detail panel did
          not, so a lead attached to a unit read as if it had none. */}
      {(lead.unit || lead.building) && (
        <div className="mb-3 flex items-center gap-1.5 text-xs text-gray-600">
          <FiHome className="shrink-0 text-gray-400" />
          {lead.unit
            ? <span>Unit <span className="font-medium">{lead.unit.unitNumber}</span></span>
            : <span>Building <span className="font-medium">{lead.building.name}</span></span>}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
        {lead.email && (
          <div className="flex items-center gap-1.5 text-gray-600">
            <FiMail className="shrink-0" />
            <span className="truncate text-xs">{lead.email}</span>
          </div>
        )}
        {lead.phone && (
          <div className="flex items-center gap-1.5 text-gray-600">
            <FiPhone className="shrink-0" />
            <span className="text-xs">{lead.phone}</span>
          </div>
        )}
        {lead.source && (
          <div className="text-xs text-gray-500">
            <span className="font-medium">Source:</span> {SOURCE_LABELS[lead.source] || lead.source}
          </div>
        )}
        {lead.budget && (
          <div className="text-xs text-gray-500">
            <span className="font-medium">Budget:</span> ${Number(lead.budget).toLocaleString()}
          </div>
        )}
        {lead.unitInterest && (
          <div className="text-xs text-gray-500 sm:col-span-2">
            <span className="font-medium">Interest:</span> {lead.unitInterest}
          </div>
        )}
        {lead.assignedUser && (
          <div className="text-xs text-gray-500 sm:col-span-2 flex items-center gap-1.5">
            <span className="font-medium">Assigned:</span>
            <Avatar size="sm" name={lead.assignedUser.name} src={lead.assignedUser.avatarUrl} className="w-4 h-4" />
            {lead.assignedUser.name}
          </div>
        )}
      </div>

      {lead.notes && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">{lead.notes}</div>
      )}

      {lead.status !== 'CONVERTED' && lead.status !== 'LOST' && lead.status !== 'DEAD' && (
        <div className="mb-4 flex gap-2">
          {hasPermission('siteVisit:request') && (
            <Button
              size="sm" color="primary" variant="flat" className="flex-1"
              startContent={<FiCalendar className="w-3.5 h-3.5" />}
              onPress={onVisitOpen}
            >
              Request site visit
            </Button>
          )}
          <Button size="sm" color="success" variant="flat" onPress={onConvertOpen} className="flex-1">
            Convert to Sale
          </Button>
        </div>
      )}

      <LeadCommentThread leadId={lead.id} />

      <LeadCallCalendar leadId={lead.id} />

      <LeadSiteVisits leadId={lead.id} lead={lead} />

      <LeadInterests leadId={lead.id} projectId={lead.projectId} />

      <LeadDocumentsPanel leadId={lead.id} />

      <div className="flex-1 overflow-auto">
        <ActivityTimeline leadId={lead.id} />
      </div>

      <ConvertToSaleModal isOpen={isConvertOpen} onClose={onConvertClose} lead={lead} />
      <RequestSiteVisitModal isOpen={isVisitOpen} onClose={onVisitClose} lead={lead} />
    </div>
  );
}

/**
 * The lead's own site visits. Deliberately on the panel rather than only the dashboard:
 * the dashboard answers "what needs me today", this answers "where are we with THIS lead",
 * and a rep reading a lead should not have to reconstruct that from the activity log.
 */
function LeadSiteVisits({ leadId, lead }: { leadId: string; lead: any }) {
  const { hasPermission } = useAuthStore();
  const { data } = useSiteVisits(hasPermission('siteVisit:view') ? { leadId } : undefined);
  const cancelVisit = useCancelSiteVisit();
  const [moving, setMoving] = useState<any>(null);
  const [outcomeFor, setOutcomeFor] = useState<any>(null);
  const visits: any[] = (data as any[]) || [];
  if (!hasPermission('siteVisit:view') || visits.length === 0) return null;

  const canAct = hasPermission('siteVisit:request');
  const STATUS_COLOR: Record<string, any> = {
    REQUESTED: 'warning', CONFIRMED: 'success', REJECTED: 'danger',
    CANCELLED: 'default', RESCHEDULED: 'default', COMPLETED: 'success', NO_SHOW: 'danger',
  };

  const doCancel = async (v: any) => {
    if (!confirm('Cancel this site visit? The slot goes back into the pool.')) return;
    try {
      await cancelVisit.mutateAsync({ id: v.id });
      addToast({ title: 'Site visit cancelled', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not cancel the visit'), color: 'danger' });
    }
  };

  return (
    <div className="mb-4">
      <p className="text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
        <FiCalendar className="w-3.5 h-3.5" aria-hidden="true" /> Site visits
      </p>
      <div className="space-y-1">
        {visits.map((v: any) => {
          const when = new Intl.DateTimeFormat('en-US', {
            timeZone: v.timezone || 'America/Chicago',
            weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
          }).format(new Date(v.startsAt));
          const isLive = v.status === 'REQUESTED' || v.status === 'CONFIRMED';
          const past = new Date(v.startsAt).getTime() < Date.now();
          // An outcome is only meaningful once a confirmed visit has actually happened.
          const needsOutcome = v.status === 'CONFIRMED' && past && !v.completedAt;
          return (
            <div key={v.id} className="px-2 py-1.5 rounded border border-gray-200 bg-white">
              <div className="flex items-center gap-2 text-xs">
                <span className="tabular-nums text-gray-700">{when}</span>
                <Chip size="sm" variant="flat" color={STATUS_COLOR[v.status] ?? 'default'}>
                  {v.status.replace('_', ' ')}
                </Chip>
                {/* A RESCHEDULED row is history — it says the first date was agreed and moved,
                    which is exactly what the chain is for. */}
                {v.rescheduledFromId && <span className="text-gray-500">(moved)</span>}
                <span className="ml-auto text-gray-500">{v.host?.name ?? ''}</span>
              </div>
              {v.decisionNote && v.status === 'REJECTED' && (
                <p className="text-[11px] text-red-700 mt-0.5">“{v.decisionNote}”</p>
              )}
              {v.outcomeNote && (
                <p className="text-[11px] text-gray-600 mt-0.5">“{v.outcomeNote}”</p>
              )}
              {canAct && (isLive || v.status === 'REJECTED') && (
                <div className="flex items-center gap-1 mt-1">
                  {needsOutcome && (
                    <Button size="sm" variant="flat" color="primary" className="h-7 min-w-0 px-2 text-[11px]"
                      onPress={() => setOutcomeFor(v)}>
                      Record outcome
                    </Button>
                  )}
                  {/* Rejected visits are rebooked from here — that is the whole point of
                      keeping them on the record rather than deleting them. */}
                  <Button size="sm" variant="light" className="h-7 min-w-0 px-2 text-[11px]"
                    onPress={() => setMoving(v)}>
                    {v.status === 'REJECTED' ? 'Rebook' : 'Move'}
                  </Button>
                  {isLive && (
                    <Button size="sm" variant="light" color="danger" className="h-7 min-w-0 px-2 text-[11px]"
                      onPress={() => doCancel(v)} isDisabled={cancelVisit.isPending}>
                      Cancel
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {moving && (
        <RequestSiteVisitModal
          isOpen={!!moving}
          onClose={() => setMoving(null)}
          lead={lead}
          rescheduleOf={moving}
        />
      )}
      {outcomeFor && (
        <RecordVisitOutcomeModal
          isOpen={!!outcomeFor}
          onClose={() => setOutcomeFor(null)}
          visit={outcomeFor}
        />
      )}
    </div>
  );
}

// Multi-unit interest: the units this lead is considering. A lead can be on several
// units' waitlists (and a unit can have many interested leads).
function LeadInterests({ leadId, projectId }: { leadId: string; projectId: string }) {
  const { data: detail } = useLead(leadId);
  const { data: unitsData } = useUnits(projectId);
  const addInterest = useAddLeadInterest();
  const removeInterest = useRemoveLeadInterest();
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState('');

  const interests: any[] = detail?.unitInterests ?? [];
  const units: any[] = (unitsData as any[]) || [];
  const interestedUnitIds = new Set(interests.map((i) => i.unitId));
  const available = units.filter((u) => !interestedUnitIds.has(u.id));

  const add = async () => {
    if (!pick) return;
    try {
      await addInterest.mutateAsync({ leadId, unitId: pick });
      setPick('');
      setAdding(false);
      addToast({ title: 'Unit of interest added', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to add interest'), color: 'danger' });
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Units of interest {interests.length > 0 && `(${interests.length})`}
        </p>
        <Button size="sm" variant="light" onPress={() => setAdding((v) => !v)}>+ Add</Button>
      </div>
      {interests.length === 0 && !adding && (
        <p className="text-xs text-gray-500">Not on any unit waitlist yet.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {interests.map((i) => (
          <Chip
            key={i.id}
            size="sm"
            variant="flat"
            onClose={() => removeInterest.mutate(i.id)}
          >
            Unit {i.unit?.unitNumber ?? '—'}
          </Chip>
        ))}
      </div>
      {adding && (
        <div className="flex gap-2 mt-2">
          <Select
            size="sm" aria-label="Unit" selectedKeys={pick ? [pick] : []} className="flex-1"
            onSelectionChange={(k) => setPick((Array.from(k)[0] as string) || '')}
          >
            {available.map((u) => <SelectItem key={u.id} textValue={`Unit ${u.unitNumber}`}>Unit {u.unitNumber}</SelectItem>)}
          </Select>
          <Button size="sm" color="primary" onPress={add} isLoading={addInterest.isPending} isDisabled={!pick}>Add</Button>
        </div>
      )}
    </div>
  );
}

function LeadFormModal({
  isOpen,
  onClose,
  lead,
  projectId: defaultProjectId,
}: {
  isOpen: boolean;
  onClose: () => void;
  lead?: any;
  projectId?: string;
}) {
  // Unscoped: lead capture is cross-project work for SALES/MARKETING — they can
  // attribute a lead to any project, not only ones they're a member of (dashboards
  // and project lists stay scoped; this picker deliberately does not).
  const { data: projects } = useProjectOptions();
  const { data: users } = useAssignableUsers();
  const { data: leadStatusOpts = [] } = useCustomOptions('lead_status');
  const { data: formViaOpts = [] } = useCustomOptions('lead_via');
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const isEdit = !!lead;

  const buildForm = () => ({
    projectId: lead?.projectId || defaultProjectId || '',
    name: lead?.name || '',
    email: lead?.email || '',
    phone: lead?.phone || '',
    source: lead?.source || 'WEBSITE',
    status: lead?.status || 'NEW',
    unitId: lead?.unitId || '',
    buildingId: lead?.buildingId || '',
    unitInterest: lead?.unitInterest || '',
    budget: lead?.budget ? String(Number(lead.budget)) : '',
    notes: lead?.notes || '',
    assignedTo: lead?.assignedTo || '',
    campaignId: lead?.campaignId || '',
    // A DATE column round-trips as a full ISO instant ("2026-09-30T00:00:00.000Z"), which
    // <input type="date"> refuses to display. Slice to the calendar day it represents.
    followUpDate: lead?.followUpDate ? String(lead.followUpDate).slice(0, 10) : '',
    via: lead?.via || '',
  });

  const [form, setForm] = useState(buildForm);
  // Set once the user picks a Source by hand; after that it is never auto-derived.

  // Reset form every time the modal opens or switches to a different lead.
  useEffect(() => {
    if (isOpen) setForm(buildForm());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, lead?.id]);

  const campaignSelected = !!form.campaignId;

  // Scoped to the selected building once one is picked — otherwise every unit in the
  // project showed up regardless of building, which made "pick a building, then a
  // unit" read as if the building choice did nothing.
  const { data: formUnits } = useUnits(form.projectId || '', form.buildingId || undefined);
  const { data: formBuildings } = useBuildings(form.projectId || '');
  // Campaign options: portfolio-wide campaigns (projectId null) + campaigns tied to
  // this project. The picker shows both so a lead on Spur Plaza can attribute to
  // either a Spur-specific campaign or a brand-wide Prime Developers push.
  // PLANNED as well as ACTIVE: a campaign is created PLANNED by default, so filtering
  // to ACTIVE alone meant a campaign you had just set up never appeared here. PAUSED and
  // COMPLETED stay out — you should not attribute new leads to those.
  // Fetched unfiltered because the API takes a single status value, then narrowed here.
  const ATTRIBUTABLE = ['PLANNED', 'ACTIVE'];
  const { data: portfolioCampaigns } = useCampaigns();
  const { data: projectCampaigns } = useCampaigns(form.projectId ? { projectId: form.projectId } : undefined);
  const campaignOptions = (() => {
    const out: Array<{ id: string; name: string; channel: string }> = [];
    const seen = new Set<string>();
    for (const c of ((projectCampaigns as any[]) || [])) {
      if (ATTRIBUTABLE.includes(c.status) && !seen.has(c.id)) { out.push(c); seen.add(c.id); }
    }
    // Portfolio-wide campaigns apply whether or not a project is chosen, so the picker no
    // longer waits on a project. A lead often arrives FROM a campaign and the project is
    // the thing you work out afterwards — forcing the reverse order lost the attribution.
    for (const c of ((portfolioCampaigns as any[]) || [])) {
      if (ATTRIBUTABLE.includes(c.status) && (!c.projects || c.projects.length === 0) && !seen.has(c.id)) {
        out.push(c); seen.add(c.id);
      }
    }
    return out;
  })();

  /**
   * A campaign already says where the lead came from, so Source stops being a question the
   * user has to answer — it is derived from the campaign's channel unless they set it
   * themselves. Mapping is deliberately conservative: anything without a clean equivalent
   * lands on OTHER rather than being guessed into a wrong bucket.
   */
  const SOURCE_FOR_CHANNEL: Record<string, string> = {
    META: 'SOCIAL_MEDIA',
    GOOGLE_ADS: 'WEBSITE',
    EMAIL: 'EMAIL_CAMPAIGN',
    BROKER: 'BROKER',
    SIGNAGE: 'SIGNAGE',
    EVENT: 'WALK_IN',
    NEWSPAPER: 'OTHER',
    OTHER: 'OTHER',
  };

  const set = (field: string, val: string) => {
    setForm((f) => {
      if (field === 'projectId' && val !== f.projectId) return { ...f, projectId: val, unitId: '', buildingId: '' };
      // A lead links to a unit OR a building, never both — same "exactly one of" rule
      // Sale/Lease/Loan already enforce server-side. The helper text below the field
      // says so too, but it's easy to miss a small caption after the fact; a toast at
      // the moment of the switch is the same information delivered where it's seen.
      if (field === 'unitId' && val) {
        if (f.buildingId) addToast({ title: 'Switched to unit — building link cleared', color: 'default' });
        return { ...f, unitId: val, buildingId: '' };
      }
      if (field === 'buildingId' && val) {
        if (f.unitId) addToast({ title: 'Switched to building — unit link cleared', color: 'default' });
        return { ...f, buildingId: val, unitId: '' };
      }
      return { ...f, [field]: val };
    });
  };

  const handleSubmit = async () => {
    if (!form.projectId || !form.source) {
      addToast({ title: 'Project and Source are required', color: 'warning' });
      return;
    }
    if (!form.name.trim()) {
      addToast({ title: 'Name is required', color: 'warning' });
      return;
    }
    if (!form.phone.trim()) {
      addToast({ title: 'Phone is required', color: 'warning' });
      return;
    }
    try {
      const payload: Record<string, unknown> = {
        // Create only: a lead cannot move between projects, and UpdateLeadDto has no
        // such field, so sending it on edit is a 400.
        ...(isEdit ? {} : { projectId: form.projectId }),
        source: form.source,
        status: form.status,
        name: form.name.trim(),
        email: form.email || undefined,
        phone: form.phone.trim(),
        unitId: form.unitId || (isEdit ? null : undefined),
        buildingId: form.buildingId || (isEdit ? null : undefined),
        unitInterest: form.unitInterest || undefined,
        budget: form.budget ? parseFloat(form.budget) : undefined,
        notes: form.notes || undefined,
        assignedTo: form.assignedTo || (isEdit ? null : undefined),
        campaignId: form.campaignId || (isEdit ? null : undefined),
        // Same clear-on-edit shape as the fields above: '' means "unset it" when editing,
        // and "don't send it" on create. Sending '' would fail IsDateString validation.
        followUpDate: form.followUpDate || (isEdit ? null : undefined),
        via: form.via || (isEdit ? null : undefined),
      };
      if (isEdit) {
        await updateLead.mutateAsync({ id: lead.id, data: payload });
        addToast({ title: 'Lead updated', color: 'success' });
      } else {
        await createLead.mutateAsync(payload);
        addToast({ title: 'Lead created', color: 'success' });
      }
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, `Failed to ${isEdit ? 'update' : 'create'} lead`), color: 'danger' });
    }
  };

  const isPending = createLead.isPending || updateLead.isPending;

  return (
    <Modal isOpen={isOpen} onClose={onClose} scrollBehavior="inside" size="lg">
      <ModalContent>
        <ModalHeader>{isEdit ? 'Edit Lead' : 'New Lead'}</ModalHeader>
        <ModalBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Campaign leads the form: a lead usually arrives FROM a campaign and the
                project is worked out afterwards, so asking for the project first inverted
                the real order and cost the attribution when nobody went back for it.
                Choosing one also fills in Source, which is why that field stops being
                required below. */}
            <Select
              size="sm"
              label="Campaign"
              placeholder="No specific campaign"
              selectedKeys={form.campaignId ? new Set([form.campaignId]) : new Set()}
              onSelectionChange={(keys) => {
                const id = (Array.from(keys)[0] as string) || '';
                setForm((f) => {
                  const chan = campaignOptions.find((c: any) => c.id === id)?.channel;
                  const derived = chan ? SOURCE_FOR_CHANNEL[String(chan)] : undefined;
                  return { ...f, campaignId: id, ...(derived ? { source: derived } : {}) };
                });
              }}
              className="sm:col-span-2"
              description={
                campaignOptions.length === 0
                  ? (form.projectId
                      ? 'No planned or active campaign is linked to this project yet.'
                      : 'No portfolio-wide campaign is planned or active. Pick a project to see its own.')
                  : campaignSelected
                    ? 'Source is taken from this campaign — change it below only if it differs.'
                    : undefined
              }
            >
              {campaignOptions.map((c: any) => (
                <SelectItem key={c.id} textValue={c.name}>{c.name} · {String(c.channel).replace('_', ' ')}</SelectItem>
              ))}
            </Select>
            {!defaultProjectId && (
              <div className="sm:col-span-2">
                <Select
                  size="sm"
                  label="Project *"
                  selectedKeys={form.projectId ? new Set([form.projectId]) : new Set()}
                  onSelectionChange={(keys) => set('projectId', Array.from(keys)[0] as string)}
                >
                  {(projects || []).map((p: any) => (
                    <SelectItem key={p.id} textValue={p.name}>{p.name}</SelectItem>
                  ))}
                </Select>
              </div>
            )}
            <Input size="sm" label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} isRequired />
            <Input size="sm" label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            <Input size="sm" label="Phone *" value={form.phone} onChange={(e) => set('phone', e.target.value)} isRequired />
            <Input size="sm" label="Budget ($)" type="number" min={0} value={form.budget} onChange={(e) => set('budget', e.target.value)} />
            <Select
              size="sm"
              label={campaignSelected ? 'Source' : 'Source *'}
              selectedKeys={new Set([form.source])}
              onSelectionChange={(keys) => set('source', Array.from(keys)[0] as string)}
            >
              {LEAD_SOURCES.map((s) => (
                <SelectItem key={s} textValue={SOURCE_LABELS[s] || s}>{SOURCE_LABELS[s] || s}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              label="Status"
              selectedKeys={new Set([form.status])}
              onSelectionChange={(keys) => set('status', Array.from(keys)[0] as string)}
            >
              {leadStatusOpts.map((o) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              label="Building"
              {...wideSelectProps}
              placeholder={form.projectId ? (form.buildingId ? undefined : 'No specific building') : 'Select a project first'}
              selectedKeys={form.buildingId ? new Set([form.buildingId]) : new Set()}
              onSelectionChange={(keys) => {
                const val = (Array.from(keys)[0] as string) || '';
                set('buildingId', val);
              }}
              isDisabled={!form.projectId}
              className="sm:col-span-2"
            >
              {((formBuildings as any[]) || []).map((b: any) => (
                <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              label="Unit"
              placeholder={form.projectId ? (form.unitId ? undefined : 'No specific unit') : 'Select a project first'}
              selectedKeys={form.unitId ? new Set([form.unitId]) : new Set()}
              onSelectionChange={(keys) => {
                const val = (Array.from(keys)[0] as string) || '';
                set('unitId', val);
              }}
              isDisabled={!form.projectId}
              className="sm:col-span-2"
            >
              {((formUnits as any[]) || []).map((u: any) => (
                <SelectItem key={u.id} textValue={`${u.unitNumber}${u.building?.name ? ` — ${u.building.name}` : ''}${u.status ? ` (${u.status.replace('_', ' ')})` : ''}`}>
                  {u.unitNumber}{u.building?.name ? ` — ${u.building.name}` : ''}{u.status ? ` · ${u.status.replace('_', ' ')}` : ''}
                </SelectItem>
              ))}
            </Select>
            {(form.buildingId || form.unitId) && (
              <p className="text-xs text-gray-500 sm:col-span-2 -mt-1">
                {form.buildingId && !form.unitId && 'Lead linked to building. Selecting a unit will switch the link.'}
                {form.unitId && !form.buildingId && 'Lead linked to unit. Selecting a building will switch the link.'}
              </p>
            )}
            {/* Follow-up + VIA share a row and BOTH use an outside label: the date input
                needs it (an inside floating label overlaps dd/mm/yyyy at size="sm"), and
                matching the select to it keeps the row aligned.

                Neither may carry `description`. HeroUI's outside label is absolutely
                positioned until a helper exists, at which point it becomes `relative` and
                falls BELOW the control — which is exactly how the "VIA" caption ended up
                under its own box. The hints live in the placeholder and a tooltip instead. */}
            <Input
              size="sm"
              type="date"
              label="Follow-up Date"
              labelPlacement="outside"
              value={form.followUpDate}
              onChange={(e) => set('followUpDate', e.target.value)}
            />
            <Select
              size="sm"
              label="VIA"
              labelPlacement="outside"
              placeholder="How they engaged"
              selectedKeys={form.via ? new Set([form.via]) : new Set()}
              onSelectionChange={(keys) => set('via', (Array.from(keys)[0] as string) || '')}
            >
              {formViaOpts.map((o: any) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <p className="sm:col-span-2 -mt-1 text-xs text-gray-500">
              Follow-up is the day we next owe this lead a touch. VIA is what they did —
              favourited, downloaded the brochure — not where they came from.
            </p>
            <Select
              size="sm"
              label="Assigned To"
              placeholder="Unassigned"
              selectedKeys={form.assignedTo ? new Set([form.assignedTo]) : new Set()}
              onSelectionChange={(keys) => set('assignedTo', (Array.from(keys)[0] as string) || '')}
              className="sm:col-span-2"
            >
              {((users as any[]) || []).filter((u: any) => u.isActive !== false).map((u: any) => (
                <SelectItem key={u.id} textValue={u.name}>{u.name}{u.role ? ` · ${String(u.role).replace('_', ' ')}` : ''}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm"
              label="Notes on interest"
              placeholder="e.g. 2BR preference, parking required"
              value={form.unitInterest}
              onChange={(e) => set('unitInterest', e.target.value)}
              className="sm:col-span-2"
            />
            <Textarea
              size="sm"
              label="Notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              minRows={2}
              className="sm:col-span-2"
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={handleSubmit} isLoading={isPending}>
            {isEdit ? 'Save Changes' : 'Create Lead'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default function LeadsPage() {
  const { hasPermission, user } = useAuthStore();
  const { data: leadStatusOpts = [] } = useCustomOptions('lead_status');
  const LEAD_STATUSES = leadStatusOpts.map((o) => o.value);
  const LEAD_STATUS_LABELS: Record<string, string> = Object.fromEntries(leadStatusOpts.map((o) => [o.value, o.label]));
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Debounce search — otherwise every keystroke fires its own GET /leads. Same 300ms
  // pattern ProjectsPage already uses for its search box.
  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    clearTimeout((handleSearch as any)._t);
    (handleSearch as any)._t = setTimeout(() => setDebouncedSearch(val), 300);
  }, []);
  // assignee filter: '' = all, 'mine' = current user, 'unassigned' = no assignee, else a user id
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [brokerFilter, setBrokerFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [viaFilter, setViaFilter] = useState('');
  // Cards vs grid is a per-person working preference, not shared state, so it lives in
  // localStorage. Wrapped because storage throws in private windows and a broken read
  // must not take the page down with it.
  const [view, setView] = useState<'cards' | 'grid' | 'calendar'>(() => {
    try {
      const v = localStorage.getItem('leads-view');
      return v === 'grid' || v === 'calendar' ? v : 'cards';
    } catch { return 'cards'; }
  });
  const setViewPersisted = (v: 'cards' | 'grid' | 'calendar') => {
    setView(v);
    try { localStorage.setItem('leads-view', v); } catch { /* private window — ignore */ }
  };
  const { data: brokersData } = useBrokers();
  const brokers: any[] = (brokersData as any[]) || [];
  const { data: campaignsData } = useCampaigns();
  const campaignList: any[] = (campaignsData as any[]) || [];
  const { data: viaOpts = [] } = useCustomOptions('lead_via');
  const VIA_LABELS: Record<string, string> = Object.fromEntries(viaOpts.map((o: any) => [o.value, o.label]));
  const [selectedLead, setSelectedLead] = useState<any>(null);
  // Deep links from notifications: /leads?lead=<id> (and &visit=<id> for context).
  // Every site-visit and @mention notification points here, and without this they all
  // landed on a bare list with nothing selected. `visit` alone is still honoured because
  // notifications sent before this existed carry only that.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLeadId = searchParams.get('lead');
  const deepVisitId = searchParams.get('visit');
  const { data: deepLead } = useLead(deepLeadId || '');
  // Only needed for the legacy visit-only form; skipped the moment a lead id is present.
  const { data: deepVisit } = useSiteVisit(!deepLeadId && deepVisitId ? deepVisitId : undefined);
  const resolvedDeepLeadId = deepLeadId || (deepVisit as any)?.leadId;
  const { data: leadFromVisit } = useLead(!deepLeadId && resolvedDeepLeadId ? resolvedDeepLeadId : '');

  useEffect(() => {
    const target = (deepLead as any) ?? (leadFromVisit as any);
    if (!target) return;
    setSelectedLead(target);
    // Consume the params so a later manual selection is not fought by a stale URL, and so
    // reloading the page does not keep yanking the panel back to the linked lead.
    setSearchParams({}, { replace: true });
  }, [deepLead, leadFromVisit, setSearchParams]);
  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const [editLead, setEditLead] = useState<any>(null);

  const { data: users } = useAssignableUsers();

  // status / campaign / via are filtered CLIENT-SIDE on purpose. The page already fetches
  // the whole scoped set and paginates in the browser, and pushing these to the server
  // would collapse their own counts to zero the moment one was picked — selecting
  // "Site Visit" would re-query for SITE_VISIT only, leaving every other status reading 0
  // in the very dropdown you pick from. Search / assignee / broker stay server-side:
  // they narrow the base set and have no counter to keep honest.
  const leadsQuery = {
    search: debouncedSearch || undefined,
    brokerId: brokerFilter || undefined,
    ...(assigneeFilter === 'mine' && user?.id ? { assignedTo: user.id } : {}),
    ...(assigneeFilter === 'unassigned' ? { unassigned: true } : {}),
    ...(assigneeFilter && assigneeFilter !== 'mine' && assigneeFilter !== 'unassigned'
      ? { assignedTo: assigneeFilter }
      : {}),
  };
  const { data: leads, isLoading, error } = useLeads(leadsQuery as any);
  const deleteLead = useDeleteLead();

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this lead?')) return;
    try {
      await deleteLead.mutateAsync(id);
      if (selectedLead?.id === id) setSelectedLead(null);
      addToast({ title: 'Lead deleted', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete lead'), color: 'danger' });
    }
  };

  const openEdit = (lead: any) => {
    setEditLead(lead);
    onFormOpen();
  };

  const openNew = () => {
    setEditLead(null);
    onFormOpen();
  };

  const handleFormClose = () => {
    setEditLead(null);
    onFormClose();
  };

  // Sorted most-stale-first — the header surfaces a stale count, so the list underneath
  // should actually triage by it instead of rendering in raw API order. Non-stale/terminal
  // leads (staleDays() === null) sort after every stale one, in their original relative order.
  // The server-filtered set, before any of the three client-side narrowings. Every count
  // shown to the user is derived from THIS array, so the numbers stay truthful whichever
  // filter happens to be active.
  const baseLeads = useMemo(() => {
    const arr = (leads as any[]) || [];
    return arr.slice().sort((a, b) => (staleDays(b) ?? -1) - (staleDays(a) ?? -1));
  }, [leads]);

  // Each filter gets its own predicate so the counters below can leave ONE of them out.
  const matchStatus = useCallback(
    (l: any) => !statusFilter || l.status === statusFilter, [statusFilter]);
  const matchCampaign = useCallback((l: any) => !campaignFilter
    || (campaignFilter === NO_CAMPAIGN ? !l.campaignId : l.campaignId === campaignFilter), [campaignFilter]);
  const matchVia = useCallback((l: any) => !viaFilter || l.via === viaFilter, [viaFilter]);

  const leadsArr = useMemo(
    () => baseLeads.filter((l: any) => matchStatus(l) && matchCampaign(l) && matchVia(l)),
    [baseLeads, matchStatus, matchCampaign, matchVia],
  );

  const { page, setPage, totalPages, paged: pagedLeads, total } = usePagination(
    leadsArr,
    PAGE_SIZE,
    [debouncedSearch, statusFilter, assigneeFilter, brokerFilter, campaignFilter, viaFilter],
  );

  // FACET counts: each counter is computed over the set narrowed by every filter EXCEPT
  // its own. Counting over the fully-filtered set would drive every other option to zero;
  // counting over the raw set would advertise "New 5" while a campaign filter guarantees
  // that picking New yields nothing. Leaving out only its own dimension is the one reading
  // that answers the question the user is actually asking: "if I picked this instead, how
  // many would I get?"
  const statusFacet = useMemo(
    () => baseLeads.filter((l: any) => matchCampaign(l) && matchVia(l)),
    [baseLeads, matchCampaign, matchVia],
  );
  const campaignFacet = useMemo(
    () => baseLeads.filter((l: any) => matchStatus(l) && matchVia(l)),
    [baseLeads, matchStatus, matchVia],
  );

  const pipelineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of statusFacet) counts[l.status] = (counts[l.status] ?? 0) + 1;
    return counts;
  }, [statusFacet]);

  // Campaign chip counts, plus a bucket for leads with no campaign at all — without it
  // the chips cannot express "unattributed", which is the group marketing most wants.
  const campaignCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of campaignFacet) {
      const key = l.campaignId || NO_CAMPAIGN;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [campaignFacet]);

  // The "All" campaign chip must agree with the chips beside it, so it counts the same
  // facet they do rather than the raw set.
  const campaignAllCount = campaignFacet.length;
  const totalCount = baseLeads.length;

  // Stale aggregate — shows on the strip as a small dot when any leads are stale.
  const staleCount = useMemo(
    () => leadsArr.filter((l: any) => staleDays(l) != null).length,
    [leadsArr],
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* ── List column ──────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <FiTarget className="text-xl text-blue-600" />
            <h1 className="text-lg font-semibold text-gray-900">Leads</h1>
            <span className="text-sm text-gray-500 tabular-nums">{totalCount}</span>
            {staleCount > 0 && (
              <Tooltip content={`${staleCount} lead${staleCount === 1 ? '' : 's'} with no activity in 14+ days`}>
                <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700">
                  <FiClock className="w-3 h-3" />
                  <span className="tabular-nums">{staleCount}</span> stale
                </span>
              </Tooltip>
            )}
          </div>
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openNew} aria-label="Create a new lead">
            New Lead
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Input
            size="sm"
            placeholder="Search name, email, phone…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            startContent={<FiSearch className="text-gray-400" />}
            className="max-w-sm"
            isClearable
            onClear={() => handleSearch('')}
            aria-label="Search leads"
          />
          <Select
            size="sm"
            aria-label="Filter by status"
            placeholder="All statuses"
            className="w-[190px]"
            selectedKeys={statusFilter ? new Set([statusFilter]) : new Set()}
            onSelectionChange={(keys) => setStatusFilter((Array.from(keys)[0] as string) || '')}
          >
            {LEAD_STATUSES.map((sv) => {
              const label = LEAD_STATUS_LABELS[sv] || sv.replace('_', ' ');
              const count = pipelineCounts[sv] ?? 0;
              return (
                // textValue is mandatory: HeroUI derives the trigger's text from children,
                // and multi-expression children render a BLANK trigger instead of the label.
                <SelectItem key={sv} textValue={label}>
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_TOKEN[sv]?.dot ?? 'bg-gray-400'}`} aria-hidden="true" />
                      {label}
                    </span>
                    <span className="tabular-nums text-gray-500">{count}</span>
                  </span>
                </SelectItem>
              );
            })}
          </Select>
          {viaOpts.length > 0 && (
            <Select
              size="sm"
              aria-label="Filter by engagement signal"
              placeholder="All VIA"
              className="w-[150px]"
              selectedKeys={viaFilter ? new Set([viaFilter]) : new Set()}
              onSelectionChange={(keys) => setViaFilter((Array.from(keys)[0] as string) || '')}
            >
              {viaOpts.map((o: any) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
          )}
          <Select
            size="sm"
            aria-label="Filter by assignee"
            placeholder="All assignees"
            className="max-w-[200px]"
            selectedKeys={assigneeFilter ? new Set([assigneeFilter]) : new Set()}
            onSelectionChange={(keys) => setAssigneeFilter((Array.from(keys)[0] as string) || '')}
            startContent={<FiUser className="text-gray-400 w-3.5 h-3.5" />}
          >
            {[
              { key: 'mine', label: 'Assigned to me' },
              { key: 'unassigned', label: 'Unassigned' },
              ...((users as any[]) || [])
                .filter((u: any) => u.isActive !== false && u.id !== user?.id)
                .map((u: any) => ({ key: u.id as string, label: u.name as string })),
            ].map((opt) => (
              <SelectItem key={opt.key}>{opt.label}</SelectItem>
            ))}
          </Select>
          {brokers.length > 0 && (
            <Select
              size="sm"
              aria-label="Filter by broker"
              placeholder="All brokers"
              className="w-[160px]"
              selectedKeys={brokerFilter ? [brokerFilter] : []}
              onSelectionChange={(keys) => setBrokerFilter((Array.from(keys)[0] as string) || '')}
            >
              {brokers.map((b: any) => (
                <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
              ))}
            </Select>
          )}
          <div className="ml-auto inline-flex rounded-lg border border-gray-200 overflow-hidden" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => setViewPersisted('cards')}
              aria-pressed={view === 'cards'}
              aria-label="Card view"
              className={`px-2 py-1.5 text-xs font-medium flex items-center gap-1 ${
                view === 'cards' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <FiList className="w-3.5 h-3.5" /> Cards
            </button>
            <button
              type="button"
              onClick={() => setViewPersisted('grid')}
              aria-pressed={view === 'grid'}
              aria-label="Grid view"
              className={`px-2 py-1.5 text-xs font-medium flex items-center gap-1 ${
                view === 'grid' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <FiGrid className="w-3.5 h-3.5" /> Grid
            </button>
            <button
              type="button"
              onClick={() => setViewPersisted('calendar')}
              aria-pressed={view === 'calendar'}
              aria-label="Calendar view"
              className={`px-2 py-1.5 text-xs font-medium flex items-center gap-1 border-l border-gray-200 ${
                view === 'calendar' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <FiCalendar className="w-3.5 h-3.5" /> Calendar
            </button>
          </div>
          {(statusFilter || assigneeFilter || brokerFilter || campaignFilter || viaFilter) && (
            <Button
              size="sm"
              variant="flat"
              startContent={<FiRefreshCw className="w-3 h-3" />}
              onPress={() => {
                setStatusFilter(''); setAssigneeFilter(''); setBrokerFilter('');
                setCampaignFilter(''); setViaFilter('');
              }}
              aria-label="Clear filters"
            >
              Clear filters
            </Button>
          )}
        </div>

        {/* Ads-campaign chips. Chips rather than another dropdown because campaign is the
            one filter marketing scans across — seeing the spread of counts side by side is
            the point, and a closed dropdown hides exactly that. */}
        {campaignList.length > 0 && (
          <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
            <span className="shrink-0 text-[11px] font-medium text-gray-500 uppercase tracking-wide pr-1">
              Campaign
            </span>
            <button
              type="button"
              onClick={() => setCampaignFilter('')}
              className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                !campaignFilter
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
              aria-pressed={!campaignFilter}
              aria-label="Show leads from all campaigns"
            >
              All
              <span className="tabular-nums opacity-80">{campaignAllCount}</span>
            </button>
            {campaignList.map((c: any) => {
              const count = campaignCounts[c.id] ?? 0;
              const active = campaignFilter === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCampaignFilter(active ? '' : c.id)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                  aria-pressed={active}
                  aria-label={`Filter by campaign ${c.name}, ${count} leads`}
                >
                  <FiBarChart2 className="w-2.5 h-2.5" aria-hidden="true" />
                  {c.name}
                  <span className="tabular-nums opacity-80">{count}</span>
                </button>
              );
            })}
            {(campaignCounts[NO_CAMPAIGN] ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setCampaignFilter(campaignFilter === NO_CAMPAIGN ? '' : NO_CAMPAIGN)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  campaignFilter === NO_CAMPAIGN
                    ? 'bg-gray-100 text-gray-700 border-gray-400'
                    : 'bg-white text-gray-500 border-dashed border-gray-300 hover:bg-gray-50'
                }`}
                aria-pressed={campaignFilter === NO_CAMPAIGN}
                aria-label={`Filter to leads with no campaign, ${campaignCounts[NO_CAMPAIGN]} leads`}
              >
                No campaign
                <span className="tabular-nums opacity-80">{campaignCounts[NO_CAMPAIGN]}</span>
              </button>
            )}
          </div>
        )}

        {/* List body */}
        {isLoading && <LoadingState />}
        {error && <ErrorState message="Failed to load leads" />}
        {/* One empty state for all three views — it used to render ALONGSIDE the grid and
            calendar, so filtering to zero showed "No leads yet" above a bare table header.
            The message also distinguishes "nothing exists" from "your filters exclude
            everything", which are very different problems for the user. */}
        {!isLoading && leadsArr.length === 0 && (() => {
          const filtered = !!(debouncedSearch || statusFilter || assigneeFilter
            || brokerFilter || campaignFilter || viaFilter);
          return (
            <EmptyState
              title={filtered ? 'No leads match these filters' : 'No leads yet'}
              message={filtered
                ? 'Try widening the search, or clear the filters to see everything.'
                : 'Start adding marketing leads to track your pipeline'}
              action={filtered ? (
                <Button
                  size="sm" variant="flat" startContent={<FiRefreshCw className="w-3 h-3" />}
                  onPress={() => {
                    setStatusFilter(''); setAssigneeFilter(''); setBrokerFilter('');
                    setCampaignFilter(''); setViaFilter(''); handleSearch('');
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openNew}>New Lead</Button>
              )}
            />
          );
        })()}

        {leadsArr.length > 0 && (view === 'calendar' ? (
          // Calendar reads the WHOLE filtered set, not the current page — a diary that
          // only showed page 1 of the month would be actively misleading.
          <LeadsCalendar leads={leadsArr} onSelect={setSelectedLead} />
        ) : view === 'grid' ? (
          <LeadsGrid
            leads={pagedLeads}
            statusToken={STATUS_TOKEN}
            statusLabels={LEAD_STATUS_LABELS}
            sourceLabels={SOURCE_LABELS}
            viaLabels={VIA_LABELS}
            selectedId={selectedLead?.id}
            onSelect={setSelectedLead}
          />
        ) : (
          <div className="space-y-1.5">
            {pagedLeads.map((lead: any) => {
              const t = STATUS_TOKEN[lead.status] ?? STATUS_TOKEN.NEW;
              const stale = staleDays(lead);
              const isSelected = selectedLead?.id === lead.id;
              return (
                <div
                  key={lead.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedLead(lead)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedLead(lead); } }}
                  aria-label={`Lead ${lead.name || 'Unnamed'}, status ${lead.status.replace('_', ' ')}`}
                  aria-pressed={isSelected}
                  className={`group relative flex items-stretch bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm cursor-pointer transition-all ${
                    isSelected ? 'border-blue-400 shadow-sm' : ''
                  }`}
                >
                  {/* Left rail — colored by status, signals selection too */}
                  <div
                    className={`w-1 rounded-l-lg ${t.rail} ${isSelected ? 'w-1.5' : ''} transition-all`}
                    aria-hidden="true"
                  />

                  <div className="flex-1 min-w-0 px-3 py-2.5">
                    {/* Row 1: identity + status + asset/campaign attribution */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 truncate max-w-[16rem]">
                          {lead.name || <span className="text-gray-500 italic font-normal">Unnamed lead</span>}
                        </p>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${t.bg} ${t.text}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${t.dot}`} aria-hidden="true" />
                          {lead.status.replace('_', ' ')}
                        </span>
                        {lead.unit && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-sky-50 text-sky-700">
                            <FiHome className="w-2.5 h-2.5" />
                            Unit {lead.unit.unitNumber}
                          </span>
                        )}
                        {lead.building && !lead.unit && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-purple-50 text-purple-700">
                            <FiHome className="w-2.5 h-2.5" />
                            {lead.building.name}
                          </span>
                        )}
                        {lead.campaign && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700">
                            <FiBarChart2 className="w-2.5 h-2.5" />
                            {lead.campaign.name}
                          </span>
                        )}
                        {lead.broker && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            <FiUsers size={9} /> {lead.broker.name}
                          </span>
                        )}
                        {(() => {
                          const fu = followUpDays(lead);
                          if (fu == null) return null;
                          const overdue = fu < 0;
                          const today = fu === 0;
                          return (
                            <Tooltip content={
                              overdue ? `Follow-up was due ${Math.abs(fu)}d ago`
                                : today ? 'Follow-up due today'
                                  : `Follow-up in ${fu}d`
                            }>
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${
                                overdue ? 'bg-rose-50 text-rose-700'
                                  : today ? 'bg-amber-50 text-amber-700'
                                    : 'bg-gray-100 text-gray-600'
                              }`}>
                                <FiCalendar className="w-2.5 h-2.5" />
                                {overdue ? `${Math.abs(fu)}d late` : today ? 'Today' : fmtDate(lead.followUpDate)}
                              </span>
                            </Tooltip>
                          );
                        })()}
                        {stale != null && (
                          <Tooltip content={`No activity in ${stale} days`}>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${
                              stale >= 30 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                            }`}>
                              <FiClock className="w-2.5 h-2.5" />
                              <span className="tabular-nums">{stale}d</span>
                            </span>
                          </Tooltip>
                        )}
                      </div>
                      {/* Actions — only visible on hover/focus to keep cards clean */}
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        <Tooltip content="Edit lead">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            aria-label="Edit lead"
                            onPress={() => openEdit(lead)}
                            className="min-w-8 w-8 h-8"
                          >
                            <FiEdit2 className="w-3.5 h-3.5" />
                          </Button>
                        </Tooltip>
                        {hasPermission('lead:delete') && (
                          <Tooltip content="Delete lead">
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              color="danger"
                              aria-label="Delete lead"
                              onPress={() => handleDelete(lead.id)}
                              className="min-w-8 w-8 h-8"
                            >
                              <FiTrash2 className="w-3.5 h-3.5" />
                            </Button>
                          </Tooltip>
                        )}
                        <FiChevronRight className="w-4 h-4 text-gray-300 ml-0.5" aria-hidden="true" />
                      </div>
                    </div>

                    {/* Row 2: metadata — contact, source, project, budget, activity, assignee */}
                    <div className="flex items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500 flex-wrap">
                      <span className="text-gray-500">{SOURCE_LABELS[lead.source] || lead.source}</span>
                      {lead.via && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] font-medium">
                          {VIA_LABELS[lead.via] || lead.via.replace(/_/g, ' ')}
                        </span>
                      )}
                      {lead.email && (
                        <span className="flex items-center gap-1 max-w-[14rem] truncate">
                          <FiMail className="w-3 h-3 shrink-0" />
                          <span className="truncate">{lead.email}</span>
                        </span>
                      )}
                      {lead.phone && (
                        <span className="flex items-center gap-1">
                          <FiPhone className="w-3 h-3" />
                          {lead.phone}
                        </span>
                      )}
                      {lead.project?.name && <span className="text-blue-600">{lead.project.name}</span>}
                      {lead.budget && (
                        <span className="tabular-nums">${Number(lead.budget).toLocaleString()}</span>
                      )}
                      {lead._count?.activities > 0 && (
                        <span className="flex items-center gap-1">
                          <FiMessageSquare className="w-3 h-3" />
                          <span className="tabular-nums">{lead._count.activities}</span>
                        </span>
                      )}
                      {/* "How many times have we called, and what came of the last one" — the
                          question a rep otherwise has to open the timeline to answer. */}
                      {lead.callCount > 0 && (
                        <Tooltip content={lead.lastCall
                          ? `Last call ${fmtDate(lead.lastCall.occurredAt)}${lead.lastCall.note ? `: ${lead.lastCall.note}` : ''}`
                          : `${lead.callCount} call${lead.callCount === 1 ? '' : 's'}`}>
                          <span className="flex items-center gap-1 text-gray-600">
                            <FiPhoneCall className="w-3 h-3" />
                            <span className="tabular-nums">{lead.callCount}</span>
                          </span>
                        </Tooltip>
                      )}
                      {lead.assignedUser && (
                        <span className="ml-auto flex items-center gap-1.5">
                          <Avatar size="sm" name={lead.assignedUser.name} src={lead.assignedUser.avatarUrl} className="w-4 h-4 text-[11px]" />
                          <span className="text-gray-500">{lead.assignedUser.name}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* The calendar renders the whole filtered set by month, so paging it would be
            meaningless — and a "1-25 of 60" footer under a full month is just confusing. */}
        {view !== 'calendar' && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="leads"
            onPrev={() => setPage((p) => p - 1)}
            onNext={() => setPage((p) => p + 1)}
          />
        )}
      </div>

      {/* ── Detail panel ─────────────────────────────────────────────── */}
      {selectedLead && (
        <div className="w-full lg:w-[380px] lg:shrink-0">
          <Card shadow="sm" className="h-full">
            <CardBody className="overflow-auto">
              <LeadDetailPanel lead={selectedLead} onClose={() => setSelectedLead(null)} />
            </CardBody>
          </Card>
        </div>
      )}

      <LeadFormModal
        isOpen={isFormOpen}
        onClose={handleFormClose}
        lead={editLead}
      />
    </div>
  );
}
