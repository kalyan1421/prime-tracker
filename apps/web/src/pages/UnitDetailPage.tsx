import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  Chip, Button, Avatar, Textarea, Select, SelectItem, Switch,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure, addToast,
} from '@heroui/react';
import { FiArrowLeft, FiSend, FiTrash2, FiMessageSquare, FiEdit2, FiTarget, FiMail, FiPhone, FiClock, FiFileText, FiDownload, FiHome, FiCreditCard, FiAlignLeft } from 'react-icons/fi';
import { useQueryClient } from '@tanstack/react-query';
import {
  useUnit, useUnitComments, useCreateComment, useDeleteComment, useUpdateUnit, useLeads, useDocuments,
  useUnitWaitlist,
} from '../hooks/useApi';

const COMMENT_TYPE_COLORS: Record<string, string> = {
  MARKETING: 'bg-purple-100 text-purple-700',
  SALES: 'bg-blue-100 text-blue-700',
  FINANCIAL: 'bg-green-100 text-green-700',
};
import { StatusBadge, LoadingState, ErrorState, fmt, fmtDate } from '../components/ui';
import { CommentChip, type CommentType } from '../components/CommentChip';
import { TimeOnMarketBar } from '../components/TimeOnMarketBar';
import { InteriorPanel } from '../components/InteriorPanel';

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return typeof msg === 'string' ? msg : fallback;
};

const UNIT_TYPES = ['RETAIL', 'MEDICAL', 'FLEX', 'RESIDENTIAL_LOT', 'OFFICE', 'RESTAURANT', 'EVENT_CENTER'];
const UNIT_STATUSES = ['AVAILABLE', 'UNDER_CONTRACT', 'LEASED', 'SOLD', 'OCCUPIED', 'UNDER_CONSTRUCTION'];

// Single metric cell used inside the unified key-metrics strip.
function Metric({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div className="p-4 sm:p-5">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">{label}</p>
      <p className={`mt-1.5 text-xl sm:text-2xl font-bold tabular-nums ${accent ?? 'text-gray-900'}`}>
        {value}
        {unit && <span className="text-sm font-medium text-gray-400 ml-1">{unit}</span>}
      </p>
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

export default function UnitDetailPage() {
  const { id: projectId, unitId } = useParams<{ id: string; unitId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: unit, isLoading, error } = useUnit(unitId!);
  const updateUnit = useUpdateUnit();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, string>>({});
  const [primeOwned, setPrimeOwned] = useState(false);

  if (isLoading) return <LoadingState />;
  if (error || !unit) return <ErrorState />;

  const u = unit as any;
  const activeLease = u.leases?.find((l: any) => l.status === 'ACTIVE');
  const psf = u.askingPrice && u.sqft ? (Number(u.askingPrice) / u.sqft).toFixed(2) : null;

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
                {UNIT_TYPES.map((t) => <SelectItem key={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
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

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 rounded-2xl border border-gray-200 bg-white overflow-hidden mb-5 sm:mb-6 divide-x divide-y md:divide-y-0 divide-gray-100">
        <Metric label="Size" value={u.sqft ? `${u.sqft.toLocaleString()}` : '\u2014'} unit={u.sqft ? 'sqft' : undefined} />
        <Metric label="Asking Price" value={u.askingPrice ? fmt(u.askingPrice) : '\u2014'} accent="text-emerald-600" />
        <Metric label="Price PSF" value={psf ? `$${psf}` : '\u2014'} />
        <Metric label="Asking Rent" value={u.askingRent ? fmt(u.askingRent) : '\u2014'} unit={u.askingRent ? '/mo' : undefined} accent="text-emerald-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 mb-5 sm:mb-6">
        {/* Active Lease */}
        <Section icon={<FiHome className="w-4 h-4 text-blue-600" />} title="Active Lease">
          {activeLease ? (
            <dl className="text-sm divide-y divide-gray-100">
              <Row label="Tenant"><span className="font-medium text-gray-900">{activeLease.tenantName}</span></Row>
              <Row label="Monthly Rent"><span className="font-semibold text-emerald-600 tabular-nums">{fmt(activeLease.monthlyRent)}</span></Row>
              <Row label="Start"><span className="text-gray-700">{fmtDate(activeLease.startDate)}</span></Row>
              <Row label="End"><span className="text-gray-700">{fmtDate(activeLease.endDate)}</span></Row>
            </dl>
          ) : (
            <EmptyRow icon={<FiHome className="w-5 h-5" />} text="No active lease" />
          )}
        </Section>

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
      </div>

      {/* Notes */}
      {u.notes && (
        <div className="mb-5 sm:mb-6">
          <Section icon={<FiAlignLeft className="w-4 h-4 text-amber-600" />} title="Notes">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{u.notes}</p>
          </Section>
        </div>
      )}

      {/* Leads & Activity */}
      <div className="mb-5 sm:mb-6">
        <UnitLeadsPanel unitId={unitId!} />
      </div>

      {/* Waitlist — demand signal */}
      <UnitWaitlistPanel unitId={unitId!} />

      {/* Interior / Fit-Out */}
      <div className="mb-5 sm:mb-6">
        <InteriorPanel
          unitId={unitId!}
          unitNumber={(unit as any)?.unitNumber}
          unitSqft={(unit as any)?.sqft != null ? Number((unit as any).sqft) : undefined}
        />
      </div>

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

// Sprint B — Unit Docs tab. Lists every document attached directly to this unit
// (booking agreements, deeds, receipts, brochures, possession certificates).
// Uses the existing /documents?unitId= endpoint; upload UI is intentionally
// excluded here for v1 — uploads happen from the project Documents tab which
// already has the category picker and tag flow.
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
};

function UnitDocumentsPanel({ unitId }: { unitId: string }) {
  const { data, isLoading } = useDocuments({ unitId });
  const docs = ((data as any[]) || []);

  return (
    <Section
      icon={<FiFileText className="w-4 h-4 text-violet-600" />}
      title="Documents"
      count={docs.length || undefined}
      action={<span className="text-xs text-gray-400 font-normal">Upload from the project Docs tab</span>}
    >
      {isLoading && <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>}
      {!isLoading && docs.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
            <FiFileText className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-sm font-medium text-gray-500">No documents attached yet</p>
          <p className="text-xs text-gray-400">Go to the project's <span className="font-medium text-gray-500">Documents tab</span> to upload and tag files to this unit.</p>
        </div>
      )}
      {!isLoading && docs.length > 0 && (
        <div className="space-y-0.5">
          {docs.map((d: any) => {
            const cat = d.category || 'OTHER';
            const color = DOC_CATEGORY_COLORS[cat] ?? DOC_CATEGORY_COLORS.OTHER;
            const sizeKb = d.fileSize ? Math.round(d.fileSize / 1024) : null;
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
                {d.fileUrl && (
                  <a
                    href={d.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors"
                    aria-label={`Download ${d.fileName || d.name}`}
                  >
                    <FiDownload className="w-3.5 h-3.5" />
                    Open
                  </a>
                )}
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

function UnitLeadsPanel({ unitId }: { unitId: string }) {
  const { data: leads, isLoading } = useLeads({ unitId });
  const leadsArr: any[] = Array.isArray(leads) ? leads : [];
  const [tab, setTab] = useState<'leads' | 'activity'>('leads');

  const activity = leadsArr
    .flatMap((l) =>
      (l.activities || []).map((a: any) => ({ ...a, leadName: l.name || 'Unnamed', leadStatus: l.status })),
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const tabToggle = (
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
  );

  return (
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
          <p className="text-xs text-gray-400">Attach a lead from the <span className="font-medium text-gray-500">Leads page</span> or the project's <span className="font-medium text-gray-500">Leads tab</span>.</p>
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
