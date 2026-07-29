import { useParams, useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';
import {
  Chip, Button, Avatar, Textarea, Select, SelectItem, Switch,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure, addToast,
} from '@heroui/react';
import { FiArrowLeft, FiSend, FiTrash2, FiMessageSquare, FiEdit2, FiTarget, FiMail, FiPhone, FiClock, FiFileText, FiDownload, FiHome, FiCreditCard, FiAlignLeft, FiCheck, FiX, FiUpload, FiEye, FiExternalLink, FiTrendingUp, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { useQueryClient } from '@tanstack/react-query';
import {
  useUnit, useUnitComments, useCreateComment, useDeleteComment, useUpdateUnit, useLeads, useDocuments,
  useUnitWaitlist, useCreateLead, useCreateLease, useUpdateLease, useUploadDocument, useDeleteDocument,
  useRenameDocument, useReplaceDocument, useUnitFinancialSummary, useCustomOptions,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';

const COMMENT_TYPE_COLORS: Record<string, string> = {
  MARKETING: 'bg-purple-100 text-purple-700',
  SALES: 'bg-blue-100 text-blue-700',
  FINANCIAL: 'bg-green-100 text-green-700',
};
import { fmt, fmtDate, errMsg } from '../utils/fmt';
import { StatusBadge, LoadingState, ErrorState, PermissionGate } from '../components/ui';
import { CommentChip, type CommentType } from '../components/CommentChip';
import { TimeOnMarketBar } from '../components/TimeOnMarketBar';
import { InteriorPanel } from '../components/InteriorPanel';
import { SoldUnitPanel } from '../components/SoldUnitPanel';
import { LeaseRentSchedule } from '../components/LeaseRentSchedule';
import { ObligationSummaryCard } from '../components/ObligationSummaryCard';


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

// Consistent section card shell: tinted icon, title, optional right-side action/hint.
function Section({
  icon, title, count, action, children, className = '',
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white ${className}`}>
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
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
// Merges every lease (past + current) and every sale (any status) this unit has ever
// had into one reverse-chronological list, with vacancy gaps computed between leases.
// Reads the full, unfiltered-by-status arrays GET /units/:id already returns — no
// separate endpoint or new table needed. A unit that gets sold doesn't lose its past
// tenants: their lease rows are never deleted, just no longer the "current" one.
type HistoryEntry =
  | { id: string; kind: 'lease'; date: string; endDate: string | null; ongoing: boolean; data: any }
  | { id: string; kind: 'sale'; date: string; data: any }
  | { id: string; kind: 'vacant'; date: string; endDate: string };

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

function buildUnitHistory(leases: any[], sales: any[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  const sortedLeases = [...(leases || [])]
    .filter((l) => l.leaseStart)
    .sort((a, b) => new Date(a.leaseStart).getTime() - new Date(b.leaseStart).getTime());

  sortedLeases.forEach((lease, i) => {
    const ongoing = !['EXPIRED', 'TERMINATED'].includes(lease.status);
    entries.push({
      id: `lease-${lease.id}`,
      kind: 'lease',
      date: lease.leaseStart,
      endDate: ongoing ? null : lease.leaseEnd,
      ongoing,
      data: lease,
    });

    // A vacancy gap only makes sense between two leases that actually ended —
    // an ongoing lease has no known end yet, so nothing to measure a gap from.
    const next = sortedLeases[i + 1];
    if (!ongoing && next) {
      const gapMs = new Date(next.leaseStart).getTime() - new Date(lease.leaseEnd).getTime();
      if (gapMs > 24 * 60 * 60 * 1000) {
        entries.push({
          id: `vacant-${lease.id}-${next.id}`,
          kind: 'vacant',
          date: lease.leaseEnd,
          endDate: next.leaseStart,
        });
      }
    }
  });

  for (const sale of sales || []) {
    entries.push({
      id: `sale-${sale.id}`,
      kind: 'sale',
      date: sale.closingDate || sale.updatedAt || sale.createdAt,
      data: sale,
    });
  }

  return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function saleHistoryLabel(status: string): string {
  if (status === 'CLOSED') return 'Sold';
  if (status === 'CANCELLED') return 'Sale fell through';
  return `Sale in progress (${status.replace(/_/g, ' ')})`;
}

function UnitHistoryTimeline({ leases, sales }: { leases: any[]; sales: any[] }) {
  const entries = buildUnitHistory(leases, sales);

  if (entries.length === 0) {
    return <EmptyRow icon={<FiClock className="w-5 h-5" />} text="No history yet" />;
  }

  return (
    <div>
      {entries.map((e, i) => (
        <div key={e.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div
              className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
                e.kind === 'sale'
                  ? e.data.status === 'CLOSED' ? 'bg-emerald-500' : e.data.status === 'CANCELLED' ? 'bg-gray-300' : 'bg-amber-400'
                  : e.kind === 'vacant'
                  ? 'bg-gray-300'
                  : e.ongoing ? 'bg-blue-500' : 'bg-gray-400'
              }`}
            />
            {i < entries.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1 mb-1" />}
          </div>
          <div className={`min-w-0 flex-1 ${i < entries.length - 1 ? 'pb-4' : ''}`}>
            {e.kind === 'lease' && (
              <>
                <p className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                  Leased to {e.data.tenantBrand || e.data.tenantName}
                  {e.ongoing && (
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      Current
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.date)} – {e.ongoing ? 'present' : fmtDate(e.endDate)}
                  {' · '}{fmt(e.data.monthlyRent)}/mo
                </p>
                {!e.ongoing && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Lease {String(e.data.status).toLowerCase()} · {durationLabel(e.date, e.endDate!)}
                  </p>
                )}
              </>
            )}
            {e.kind === 'sale' && (
              <>
                <p className="text-sm font-medium text-gray-900">
                  {saleHistoryLabel(e.data.status)}
                  {e.data.buyer && ` — ${e.data.buyer}`}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(e.date)}
                  {e.data.salePrice != null && ` · ${fmt(e.data.salePrice)}`}
                </p>
                {e.data.status === 'CANCELLED' && e.data.lostReason && (
                  <p className="text-xs text-gray-400 mt-0.5">Reason: {String(e.data.lostReason).replace(/_/g, ' ')}</p>
                )}
              </>
            )}
            {e.kind === 'vacant' && (
              <p className="text-sm text-gray-400 italic">
                Vacant · {fmtDate(e.date)} – {fmtDate(e.endDate)}
              </p>
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
// Leases arrive on the unit payload from GET /units/:id (already used above for
// the History timeline), so this costs no extra request; only the expanded
// LeaseRentSchedule fetches its own periods.
function UnitRentHistory({ leases, canEdit }: { leases: any[]; canEdit: boolean }) {
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
              <div className="mt-3">
                <LeaseRentSchedule leaseId={l.id} canEdit={canEdit} />
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
  const updateUnit = useUpdateUnit();
  const { data: unitTypeOpts = [] } = useCustomOptions('unit_type');
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, string>>({});
  const [primeOwned, setPrimeOwned] = useState(false);
  const { hasPermission } = useAuthStore();
  const canEditUnit = hasPermission('unit:edit');
  const canEditLease = hasPermission('lease:edit');
  const canViewBudget = hasPermission('budget:view');
  const { data: budgetSummary } = useUnitFinancialSummary(canViewBudget ? (unitId || '') : '');
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [leaseModalOpen, setLeaseModalOpen] = useState(false);
  const [leaseIsNew, setLeaseIsNew] = useState(false);
  const [leaseEditId, setLeaseEditId] = useState<string | null>(null);
  const [leaseForm, setLeaseForm] = useState<Record<string, string>>({
    tenantName: '', monthlyRent: '', leaseStart: '', leaseEnd: '', termMonths: '', status: 'ACTIVE',
  });
  const createLease = useCreateLease();
  const updateLease = useUpdateLease();

  const openAddLease = () => {
    setLeaseIsNew(true);
    setLeaseEditId(null);
    setLeaseForm({ tenantName: '', monthlyRent: '', leaseStart: '', leaseEnd: '', termMonths: '', status: 'ACTIVE' });
    setLeaseModalOpen(true);
  };

  const openEditLease = (lease: any) => {
    setLeaseIsNew(false);
    setLeaseEditId(lease.id);
    setLeaseForm({
      tenantName: lease.tenantName || '',
      monthlyRent: lease.monthlyRent != null ? String(Number(lease.monthlyRent)) : '',
      leaseStart: lease.leaseStart ? lease.leaseStart.slice(0, 10) : '',
      leaseEnd: lease.leaseEnd ? lease.leaseEnd.slice(0, 10) : '',
      termMonths: lease.termMonths != null ? String(lease.termMonths) : '',
      status: lease.status || 'ACTIVE',
    });
    setLeaseModalOpen(true);
  };

  const handleSaveLease = async () => {
    if (!leaseForm.tenantName.trim() || !leaseForm.monthlyRent || !leaseForm.leaseStart || !leaseForm.leaseEnd) {
      return addToast({ title: 'Tenant name, rent, and dates are required', color: 'warning' });
    }
    const toDate = (d: string) => new Date(`${d}T12:00:00.000Z`).toISOString();
    const payload = {
      tenantName: leaseForm.tenantName.trim(),
      monthlyRent: parseFloat(leaseForm.monthlyRent),
      leaseStart: toDate(leaseForm.leaseStart),
      leaseEnd: toDate(leaseForm.leaseEnd),
      termMonths: leaseForm.termMonths ? parseInt(leaseForm.termMonths, 10) : undefined,
      status: leaseForm.status || 'ACTIVE',
    };
    try {
      if (leaseIsNew) {
        await createLease.mutateAsync({ ...payload, unitId: unitId! });
        addToast({ title: 'Lease created', color: 'success' });
      } else {
        await updateLease.mutateAsync({ id: leaseEditId!, data: payload });
        addToast({ title: 'Lease updated', color: 'success' });
      }
      await qc.invalidateQueries({ queryKey: ['unit', unitId] });
      setLeaseModalOpen(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save lease'), color: 'danger' });
    }
  };

  const setLease = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setLeaseForm((f) => ({ ...f, [field]: e.target.value }));

  const saveNotes = async () => {
    try {
      await updateUnit.mutateAsync({ id: unitId!, data: { notes: notesDraft || null } });
      await qc.invalidateQueries({ queryKey: ['unit', unitId] });
      addToast({ title: 'Notes saved', color: 'success' });
      setEditingNotes(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save notes'), color: 'danger' });
    }
  };

  if (isLoading) return <LoadingState />;
  if (error || !unit) return <ErrorState />;

  const u = unit as any;
  const activeLease = u.leases?.find((l: any) => !['EXPIRED', 'TERMINATED'].includes(l.status));
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
      await qc.invalidateQueries({ queryKey: ['unit', unitId] });
      addToast({ title: 'Unit updated', color: 'success' });
      onClose();
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
      <Modal isOpen={leaseModalOpen} onClose={() => setLeaseModalOpen(false)} size="md">
        <ModalContent>
          <ModalHeader>{leaseIsNew ? 'Add Lease' : 'Edit Lease'}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Tenant Name" size="sm" value={leaseForm.tenantName} onChange={setLease('tenantName')} className="sm:col-span-2" />
              <Input label="Monthly Rent ($)" size="sm" type="number" value={leaseForm.monthlyRent} onChange={setLease('monthlyRent')} />
              <Input label="Term (months)" size="sm" type="number" value={leaseForm.termMonths} onChange={setLease('termMonths')} />
              <Input label="Start Date" size="sm" type="date" value={leaseForm.leaseStart} onChange={setLease('leaseStart')} />
              <Input label="End Date" size="sm" type="date" value={leaseForm.leaseEnd} onChange={setLease('leaseEnd')} />
              <Select label="Status" size="sm" selectedKeys={[leaseForm.status]}
                onSelectionChange={(k) => { const v = Array.from(k)[0] as string; if (v) setLeaseForm((f) => ({ ...f, status: v })); }}
                className="sm:col-span-2"
              >
                {['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'].map((s) => (
                  <SelectItem key={s} textValue={s}>{s}</SelectItem>
                ))}
              </Select>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setLeaseModalOpen(false)}>Cancel</Button>
            <Button color="primary" onPress={handleSaveLease} isLoading={createLease.isPending || updateLease.isPending}>
              {leaseIsNew ? 'Add Lease' : 'Save Changes'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

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

      {/* Sold unit details */}
      {u.status === 'SOLD' && (() => {
        const closedSale = u.sales?.find((s: any) => s.status === 'CLOSED');
        return closedSale ? <SoldUnitPanel sale={closedSale} /> : null;
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 mb-5 sm:mb-6">
        {/* Active Lease / Tenant Profile — hidden for SOLD units */}
        {u.status !== 'SOLD' && <Section
          icon={<FiHome className="w-4 h-4 text-blue-600" />}
          title="Tenant"
          action={canEditLease ? (
            activeLease ? (
              <button
                onClick={() => openEditLease(activeLease)}
                className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded"
                title="Edit lease"
              >
                <FiEdit2 className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={openAddLease}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
              >
                + Add Lease
              </button>
            )
          ) : undefined}
        >
          {activeLease ? (
            <div className="space-y-4">
              {/* Tenant identity block */}
              <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
                <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm font-bold">
                    {(activeLease.tenantBrand || activeLease.tenantName || '?').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 text-sm leading-tight truncate">
                    {activeLease.tenantBrand || activeLease.tenantName}
                  </p>
                  {activeLease.tenantBrand && activeLease.tenantBrand !== activeLease.tenantName && (
                    <p className="text-xs text-gray-500 truncate">{activeLease.tenantName}</p>
                  )}
                  {activeLease.tenantLegalName && activeLease.tenantLegalName !== activeLease.tenantName && (
                    <p className="text-[11px] text-gray-400 italic truncate">{activeLease.tenantLegalName}</p>
                  )}
                  {activeLease.tenantContact && (
                    <p className="text-xs text-blue-600 mt-0.5 truncate">{activeLease.tenantContact}</p>
                  )}
                </div>
                <div className="shrink-0">
                  {activeLease.status && activeLease.status !== 'ACTIVE' ? (
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                      {activeLease.status}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      Active
                    </span>
                  )}
                </div>
              </div>

              {/* Financial highlight */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-emerald-50 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">Monthly Rent</p>
                  <p className="text-lg font-bold text-emerald-700 tabular-nums mt-0.5">{fmt(activeLease.monthlyRent)}</p>
                  {activeLease.rentPerSqft && (
                    <p className="text-[10px] text-emerald-600">${Number(activeLease.rentPerSqft).toFixed(2)}/sqft/mo</p>
                  )}
                </div>
                {activeLease.securityDeposit && (
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Deposit</p>
                    <p className="text-lg font-bold text-slate-700 tabular-nums mt-0.5">{fmt(activeLease.securityDeposit)}</p>
                  </div>
                )}
              </div>

              {/* Lease timeline */}
              <dl className="text-sm divide-y divide-gray-100">
                <Row label="Start"><span className="text-gray-700">{fmtDate(activeLease.leaseStart)}</span></Row>
                <Row label="End">
                  <span className={`${new Date(activeLease.leaseEnd) < new Date() ? 'text-red-600' : 'text-gray-700'}`}>
                    {fmtDate(activeLease.leaseEnd)}
                  </span>
                </Row>
                {activeLease.termMonths && (
                  <Row label="Term"><span className="text-gray-700">{activeLease.termMonths} months</span></Row>
                )}
                {activeLease.escalationPct && (
                  <Row label="Escalation">
                    <span className="text-gray-700">{Number(activeLease.escalationPct).toFixed(1)}% every {activeLease.escalationFreq || 12} mo</span>
                  </Row>
                )}
              </dl>
            </div>
          ) : (
            <EmptyRow icon={<FiHome className="w-5 h-5" />} text="No active lease" />
          )}
        </Section>}

        {/* Linked Loans */}
        <Section icon={<FiCreditCard className="w-4 h-4 text-violet-600" />} title="Linked Loans" count={u.loans?.length}>
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
          <UnitHistoryTimeline leases={u.leases || []} sales={u.sales || []} />
        </Section>
      </div>

      {/* Rent & deposits — deliberately directly under History. History answers
          "who was here and when"; this answers "how much, and when did it change"
          for those same leases, so the drill-down sits against the summary it
          expands rather than at the foot of the page. Not rendered inside a
          Section: LeaseRentSchedule and ObligationSummaryCard bring their own
          card chrome and would otherwise be a card inside a card. */}
      <div className="mb-5 sm:mb-6 space-y-4">
        <ObligationSummaryCard scope="unit" id={unitId} />

        <div className="flex items-center gap-2.5 pt-1">
          <FiTrendingUp className="w-4 h-4 text-emerald-600" />
          <h2 className="font-semibold text-sm text-gray-800">
            Rent History
            {(u.leases?.length ?? 0) > 1 && (
              <span className="text-gray-400 font-normal ml-1">({u.leases.length} leases)</span>
            )}
          </h2>
        </div>
        <UnitRentHistory leases={u.leases || []} canEdit={canEditLease} />
      </div>

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
    <div className="flex items-center gap-2">
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
        <Textarea
          size="sm"
          minRows={1}
          maxRows={3}
          placeholder="Add a comment..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
        />
        <Button size="sm" color="primary" isIconOnly onPress={handleSubmit} isLoading={createComment.isPending} className="self-start sm:self-auto">
          <FiSend />
        </Button>
      </div>
    </div>
  );
}
