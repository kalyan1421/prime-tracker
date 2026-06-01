import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  Card, CardBody, CardHeader, Chip, Button, Avatar, Textarea, Select, SelectItem, Switch,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure, addToast,
} from '@heroui/react';
import { FiArrowLeft, FiSend, FiTrash2, FiMessageSquare, FiEdit2, FiTarget, FiMail, FiPhone, FiClock, FiFileText, FiDownload } from 'react-icons/fi';
import { useQueryClient } from '@tanstack/react-query';
import {
  useUnit, useUnitComments, useCreateComment, useDeleteComment, useUpdateUnit, useLeads, useDocuments,
} from '../hooks/useApi';

const COMMENT_TYPE_COLORS: Record<string, string> = {
  MARKETING: 'bg-purple-100 text-purple-700',
  SALES: 'bg-blue-100 text-blue-700',
  FINANCIAL: 'bg-green-100 text-green-700',
};
import { StatCard, StatusBadge, LoadingState, ErrorState, fmt, fmtDate } from '../components/ui';
import { CommentChip, type CommentType } from '../components/CommentChip';
import { TimeOnMarketBar } from '../components/TimeOnMarketBar';
import { InteriorPanel } from '../components/InteriorPanel';

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return typeof msg === 'string' ? msg : fallback;
};

const UNIT_TYPES = ['RETAIL', 'MEDICAL', 'FLEX', 'RESIDENTIAL_LOT', 'OFFICE', 'RESTAURANT', 'EVENT_CENTER'];
const UNIT_STATUSES = ['AVAILABLE', 'UNDER_CONTRACT', 'LEASED', 'SOLD', 'OCCUPIED', 'UNDER_CONSTRUCTION'];

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
    <div>
      <button
        className="flex items-center gap-1 text-blue-600 text-sm font-medium mb-4 cursor-pointer hover:underline"
        onClick={() => navigate(`/projects/${projectId}/units`)}
      >
        <FiArrowLeft />
        Back to Units
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Unit {u.unitNumber}</h1>
          <p className="text-sm text-gray-500 mt-1 break-words">
            {u.building?.name}
            {u.building?.project?.name && <> &middot; {u.building.project.name}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={u.unitType} />
          <StatusBadge status={u.status} />
          {/* Slice 4: time-on-market shown only for AVAILABLE units */}
          {u.status === 'AVAILABLE' && u.availableSince && (
            <TimeOnMarketBar availableSince={u.availableSince} />
          )}
          {u.primeOwned && <Chip size="sm" color="success" variant="flat">Prime Owned</Chip>}
          <Button size="sm" variant="flat" color="primary" startContent={<FiEdit2 />} onPress={openEdit}>
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

      {/* Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <StatCard label="Size" value={u.sqft ? `${u.sqft.toLocaleString()} sqft` : '\u2014'} />
        <StatCard label="Asking Price" value={u.askingPrice ? fmt(u.askingPrice) : '\u2014'} />
        <StatCard label="Price PSF" value={psf ? `$${psf}` : '\u2014'} />
        <StatCard label="Asking Rent" value={u.askingRent ? `${fmt(u.askingRent)}/mo` : '\u2014'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Active Lease */}
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Active Lease</p>
          </CardHeader>
          <CardBody className="pt-0">
            {activeLease ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Tenant</span>
                  <span className="font-medium">{activeLease.tenantName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Monthly Rent</span>
                  <span className="font-medium">{fmt(activeLease.monthlyRent)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Start</span>
                  <span>{fmtDate(activeLease.startDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">End</span>
                  <span>{fmtDate(activeLease.endDate)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No active lease</p>
            )}
          </CardBody>
        </Card>

        {/* Linked Loans */}
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Linked Loans</p>
          </CardHeader>
          <CardBody className="pt-0">
            {u.loans?.length > 0 ? (
              <div className="space-y-3">
                {u.loans.map((loan: any) => (
                  <div key={loan.id} className="text-sm space-y-1 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Lender</span>
                      <span className="font-medium">{loan.lender || '\u2014'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Type</span>
                      <span>{loan.loanType?.replace(/_/g, ' ') || '\u2014'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Monthly Payment</span>
                      <span>{loan.monthlyPayment ? fmt(loan.monthlyPayment) : '\u2014'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Principal</span>
                      <span>{loan.principalAmt ? fmt(loan.principalAmt) : '\u2014'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No linked loans</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Notes */}
      {u.notes && (
        <Card shadow="sm" className="mb-6">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Notes</p>
          </CardHeader>
          <CardBody className="pt-0">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{u.notes}</p>
          </CardBody>
        </Card>
      )}

      {/* Leads & Activity Section */}
      <UnitLeadsPanel unitId={unitId!} />

      {/* Interior / Fit-Out (Phase 1) */}
      <InteriorPanel unitId={unitId!} />

      {/* Sprint B: Documents scoped to this unit */}
      <UnitDocumentsPanel unitId={unitId!} />

      {/* Comments Section */}
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <FiMessageSquare className="text-purple-600" />
            <p className="font-semibold text-sm text-gray-600">
              Comments {u._count?.comments > 0 && `(${u._count.comments})`}
            </p>
          </div>
        </CardHeader>
        <CardBody className="pt-0">
          <InlineComments unitId={unitId!} />
        </CardBody>
      </Card>
    </div>
  );
}

const LEAD_STATUS_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger'> = {
  NEW: 'default',
  CONTACTED: 'primary',
  QUALIFIED: 'secondary',
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
    <Card shadow="sm">
      <CardHeader className="pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FiFileText className="text-violet-600" />
          <p className="font-semibold text-sm text-gray-600">
            Documents {docs.length > 0 && `(${docs.length})`}
          </p>
        </div>
        <span className="text-xs text-gray-400">Upload from the project Docs tab</span>
      </CardHeader>
      <CardBody className="pt-0">
        {isLoading && <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>}
        {!isLoading && docs.length === 0 && (
          <div className="text-sm text-gray-400 py-4 text-center">
            No documents attached to this unit yet.
          </div>
        )}
        {!isLoading && docs.length > 0 && (
          <div className="space-y-1">
            {docs.map((d: any) => {
              const cat = d.category || 'OTHER';
              const color = DOC_CATEGORY_COLORS[cat] ?? DOC_CATEGORY_COLORS.OTHER;
              const sizeKb = d.fileSize ? Math.round(d.fileSize / 1024) : null;
              return (
                <div key={d.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-b-0">
                  <FiFileText className="text-gray-400 shrink-0 w-4 h-4" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm text-gray-800 truncate">{d.fileName || d.name}</p>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color.bg} ${color.text}`}>
                        {String(cat).replace(/_/g, ' ')}
                      </span>
                      {d.versionNumber > 1 && (
                        <span className="text-[10px] text-gray-500">v{d.versionNumber}</span>
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
                      className="shrink-0 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
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
      </CardBody>
    </Card>
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

  return (
    <Card shadow="sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <FiTarget className="text-blue-600" />
            <p className="font-semibold text-sm text-gray-600">
              Leads {leadsArr.length > 0 && `(${leadsArr.length})`}
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={tab === 'leads' ? 'flat' : 'light'}
              color={tab === 'leads' ? 'primary' : 'default'}
              onPress={() => setTab('leads')}
            >
              Leads
            </Button>
            <Button
              size="sm"
              variant={tab === 'activity' ? 'flat' : 'light'}
              color={tab === 'activity' ? 'primary' : 'default'}
              onPress={() => setTab('activity')}
            >
              Activity
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardBody className="pt-0">
        {isLoading && <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>}
        {!isLoading && leadsArr.length === 0 && (
          <div className="text-sm text-gray-400 py-4 text-center">
            No leads linked to this unit yet. Attach one from the Leads page or the project's Leads tab.
          </div>
        )}
        {!isLoading && leadsArr.length > 0 && tab === 'leads' && (
          <div className="space-y-2">
            {leadsArr.map((lead) => (
              <div key={lead.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-b-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-800 truncate">{lead.name || <span className="text-gray-400 italic">Unnamed</span>}</p>
                    <Chip size="sm" color={LEAD_STATUS_COLORS[lead.status] || 'default'} variant="flat" className="text-[10px]">
                      {String(lead.status).replace('_', ' ')}
                    </Chip>
                    {lead.source && (
                      <Chip size="sm" variant="bordered" className="text-[10px]">{String(lead.source).replace('_', ' ')}</Chip>
                    )}
                  </div>
                  <div className="flex gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                    {lead.email && <span className="flex items-center gap-1"><FiMail />{lead.email}</span>}
                    {lead.phone && <span className="flex items-center gap-1"><FiPhone />{lead.phone}</span>}
                    {lead.budget && <span>${Number(lead.budget).toLocaleString()}</span>}
                    {lead._count?.activities ? (
                      <span className="flex items-center gap-1"><FiMessageSquare />{lead._count.activities}</span>
                    ) : null}
                  </div>
                </div>
                <div className="text-xs text-gray-400 shrink-0 flex items-center gap-1">
                  <FiClock />{fmtDate(lead.updatedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
        {!isLoading && leadsArr.length > 0 && tab === 'activity' && (
          activity.length === 0 ? (
            <div className="text-sm text-gray-400 py-4 text-center">No activity logged yet across leads on this unit.</div>
          ) : (
            <div className="space-y-2">
              {activity.map((a: any) => (
                <div key={a.id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-b-0">
                  <Chip size="sm" variant="flat" className="text-[10px] shrink-0">{ACTIVITY_TYPE_LABELS[a.type] || a.type}</Chip>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{a.note}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      <span className="font-medium">{a.leadName}</span>
                      {a.createdByUser?.name && <> · by {a.createdByUser.name}</>}
                      <> · {fmtDate(a.createdAt)}</>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </CardBody>
    </Card>
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
