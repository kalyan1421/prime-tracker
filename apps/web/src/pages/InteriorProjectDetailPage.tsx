import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Button, Chip, Tabs, Tab, Tooltip, Progress,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Select, SelectItem,
  useDisclosure, addToast,
} from '@heroui/react';
import {
  FiArrowLeft, FiArrowRight, FiHome, FiCheckCircle, FiClock, FiDollarSign,
  FiEdit2, FiTrash2, FiAlertTriangle, FiPlus, FiFlag, FiPauseCircle,
} from 'react-icons/fi';
import {
  useInteriorProject, useAdvanceInteriorPhase, useApproveInterior, useUpdateInterior,
  useDeleteInterior, useAddInteriorInvoice, useUpdateInteriorInvoice, useVoidInteriorInvoice,
  useVendors,
} from '../hooks/useApi';
import { fmt, fmtDate, errMsg } from '../utils/fmt';
import { LoadingState, ErrorState } from '../components/ui';
import { isShellComplete, anchorBuildingPhase } from '../constants/interior';
import { SnagPanel } from '../components/SnagPanel';
import { InteriorBOQPanel } from '../components/InteriorBOQPanel';
import { InteriorDocumentsPanel } from '../components/InteriorDocumentsPanel';
import { DocumentGateBanner, INTERIOR_PHASE_DOCS } from '../components/DocumentGateChip';
import { useAuthStore } from '../store/authStore';

const PHASE_ORDER = [
  'DESIGN', 'CLIENT_APPROVAL', 'CITY_APPROVAL', 'PROCUREMENT', 'EXECUTION', 'SNAGGING', 'HANDOVER',
] as const;
type Phase = (typeof PHASE_ORDER)[number];

const PHASE_LABEL: Record<string, string> = {
  DESIGN: 'Design', CLIENT_APPROVAL: 'Client Approval', CITY_APPROVAL: 'City Approval',
  PROCUREMENT: 'Procurement', EXECUTION: 'Execution', SNAGGING: 'Snagging', HANDOVER: 'Handover',
};

/**
 * Shell requirement for ENTERING a phase — mirrors interior-state-machine.ts PHASE_GATES.
 * The DOCUMENT half of the same gate is not repeated here: it comes from
 * INTERIOR_PHASE_DOCS, the one web-side mirror of the server's rules, so the page and the
 * Documents tab cannot disagree about which paperwork is missing.
 */
const ENTER_SHELL_GATE: Partial<Record<Phase, boolean>> = {
  PROCUREMENT: true,
  EXECUTION: true,
};

function enterGate(phase: Phase): { shell?: boolean; doc?: string } {
  return { shell: ENTER_SHELL_GATE[phase], doc: INTERIOR_PHASE_DOCS[phase]?.[0] };
}

const CONTRACT_TYPES = ['PER_SQFT', 'FIXED', 'COST_PLUS'] as const;

/**
 * PER_SQFT derives its contract value from rate x area on the server; FIXED and COST_PLUS
 * are entered by hand (client, 2026-09-01). The API honours an explicit contractValue over
 * the derived one, so a form that echoes a stored value back on a PER_SQFT job freezes the
 * total at its old figure — hence this guard rather than always sending the field.
 */
const derivesOwnValue = (contractType: string) => contractType === 'PER_SQFT';

const STATUS_COLOR: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
  NOT_STARTED: 'default', IN_PROGRESS: 'primary', ON_HOLD: 'warning',
  COMPLETED: 'success', CANCELLED: 'danger',
};


export default function InteriorProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission('interior:edit');
  const canApprove = hasPermission('interior:approve');
  const canFinance = hasPermission('interior:finance');

  const { data: project, isLoading, error } = useInteriorProject(id);
  const advance = useAdvanceInteriorPhase();
  const approve = useApproveInterior();
  const update = useUpdateInterior();
  const del = useDeleteInterior();
  const editModal = useDisclosure();
  const deleteModal = useDisclosure();
  const handoverModal = useDisclosure();
  const [signoff, setSignoff] = useState({ handoverSignedBy: '', handoverNotes: '', forceReason: '' });

  const p: any = project;
  const documents: any[] = p?.documents ?? [];
  const invoices: any[] = p?.invoices ?? [];

  const fin = useMemo(() => {
    const contract = p?.contractValue ? Number(p.contractValue) : 0;
    const spend = invoices.reduce((s, inv) => s + Number(inv.amount), 0);
    return { contract, spend, remaining: contract - spend, usedPct: contract > 0 ? Math.min(spend / contract, 1) : 0 };
  }, [p?.contractValue, invoices]);

  if (isLoading) return <LoadingState message="Loading fit-out…" />;
  if (error || !p) return <ErrorState message="Interior project not found." />;

  const phase: Phase = p.phase;
  const idx = PHASE_ORDER.indexOf(phase);
  const next: Phase | null = idx >= 0 && idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : null;
  const gate = next ? enterGate(next) : undefined;
  const docCats = new Set(documents.map((d) => d.category));
  const docBlocked = !!gate?.doc && !docCats.has(gate.doc);
  // The shell gate is a real state, not a standing warning. It used to be shown whenever
  // the next phase happened to have a shell requirement — whether or not the shell was
  // actually finished — because the API did not return the anchor building's phase.
  const shellComplete = isShellComplete(p);
  const shellBlocked = !!gate?.shell && !shellComplete;
  const isTerminal = p.status === 'COMPLETED' || p.status === 'CANCELLED';
  // The handover gate counts anything not RESOLVED as still open — IN_PROGRESS included,
  // matching OPEN_SNAG_STATUSES on the server. Work started is not work finished.
  const openSnags: any[] = (p.snags ?? []).filter((sn: any) => sn.status !== 'RESOLVED');

  const anchorLabel = p.unit
    ? `Unit ${p.unit.unitNumber}`
    : p.building
    ? p.building.name
    : '—';

  const doAdvance = async () => {
    if (!next) return;
    try {
      await advance.mutateAsync({ id: p.id, target: next });
      addToast({ title: `Advanced to ${PHASE_LABEL[next]}`, color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Cannot advance'), color: 'danger' });
    }
  };

  const doHandover = async () => {
    // Open punch-list items block handover unless the override is used. The API demands a
    // reason with `force`, so refuse locally rather than sending a request that 400s.
    const forcing = openSnags.length > 0;
    if (forcing && !signoff.forceReason.trim()) {
      addToast({ title: 'A reason is required to hand over with open punch-list items', color: 'warning' });
      return;
    }
    try {
      await advance.mutateAsync({
        id: p.id,
        target: 'HANDOVER',
        handoverSignedBy: signoff.handoverSignedBy.trim() || undefined,
        handoverNotes: signoff.handoverNotes.trim() || undefined,
        force: forcing || undefined,
        forceReason: forcing ? signoff.forceReason.trim() : undefined,
      });
      addToast({
        title: forcing
          ? `Handed over with ${openSnags.length} open item${openSnags.length === 1 ? '' : 's'} — reason recorded`
          : 'Fit-out handed over',
        color: 'success',
      });
      handoverModal.onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Cannot complete handover'), color: 'danger' });
    }
  };

  const doApprove = async (kind: 'client' | 'city') => {
    try {
      await approve.mutateAsync({ id: p.id, kind });
      addToast({ title: `${kind === 'client' ? 'Client' : 'City'} approval recorded`, color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed'), color: 'danger' });
    }
  };

  const setStatus = async (status: string) => {
    try {
      await update.mutateAsync({ id: p.id, data: { status } });
      addToast({ title: `Status set to ${status.replace('_', ' ').toLowerCase()}`, color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update status'), color: 'danger' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link to="/interior" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <FiArrowLeft /> Interior Portfolio
      </Link>

      {/* ─── Header card ─── */}
      <Card shadow="none" className="border border-gray-200/80 rounded-xl">
        <CardBody className="p-5 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-amber-700 font-semibold">
                <FiHome className="w-3.5 h-3.5" /> Interior / Fit-Out
              </div>
              <h1 className="text-xl sm:text-2xl font-bold break-words mt-1">{p.name}</h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
                {/* Anchor links, now that findById returns the owning project for both anchor
                    shapes. The unit link used to point at /inventory — a cross-project list —
                    which is not the unit and made the fit-out a dead end. */}
                {p.unit?.building?.projectId ? (
                  <Link
                    to={`/projects/${p.unit.building.projectId}/units/${p.unit.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {anchorLabel}
                  </Link>
                ) : p.building?.projectId ? (
                  <Link
                    to={`/projects/${p.building.projectId}/buildings/${p.building.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {anchorLabel}
                  </Link>
                ) : (
                  <span>{anchorLabel}</span>
                )}
                {(p.unit?.building?.projectId || p.building?.projectId) && (
                  <Link
                    to={`/projects/${p.unit?.building?.projectId ?? p.building?.projectId}`}
                    className="text-blue-600 hover:underline"
                  >
                    Project
                  </Link>
                )}
                {p.pm?.name && <span>PM: {p.pm.name}</span>}
                {p.sale?.buyer && <span>Buyer: {p.sale.buyer}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <Chip size="sm" variant="flat" color={STATUS_COLOR[p.status] ?? 'default'}>{p.status}</Chip>
              {canEdit && !isTerminal && (
                <Button size="sm" variant="flat" startContent={<FiEdit2 className="w-3.5 h-3.5" />} onPress={editModal.onOpen}>
                  Edit
                </Button>
              )}
              {canEdit && p.status === 'IN_PROGRESS' && (
                <Button size="sm" variant="flat" color="warning" startContent={<FiPauseCircle className="w-3.5 h-3.5" />} onPress={() => setStatus('ON_HOLD')}>
                  Hold
                </Button>
              )}
              {canEdit && p.status === 'ON_HOLD' && (
                <Button size="sm" variant="flat" color="primary" onPress={() => setStatus('IN_PROGRESS')}>Resume</Button>
              )}
              {canEdit && !isTerminal && (
                <Button size="sm" variant="light" color="danger" isIconOnly aria-label="Delete fit-out" onPress={deleteModal.onOpen}>
                  <FiTrash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Phase rail */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {PHASE_ORDER.map((ph, i) => (
                <div key={ph} className="flex items-center">
                  <Chip
                    size="sm"
                    variant={i === idx ? 'solid' : 'flat'}
                    color={i < idx ? 'success' : i === idx ? 'primary' : 'default'}
                    className={i > idx ? 'opacity-50' : ''}
                    startContent={i < idx ? <FiCheckCircle className="w-3 h-3" /> : undefined}
                  >
                    {PHASE_LABEL[ph]}
                  </Chip>
                  {i < PHASE_ORDER.length - 1 && <FiArrowRight className="w-3 h-3 text-gray-300 mx-0.5" />}
                </div>
              ))}
            </div>

            {/* Gate banner for the next transition */}
            {!isTerminal && next && gate?.doc && docBlocked && (
              <DocumentGateBanner docs={documents} required={[gate.doc]} stageName={PHASE_LABEL[next]} />
            )}
            {!isTerminal && next && shellBlocked && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 flex items-start gap-2 text-xs text-amber-700">
                <FiAlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={14} />
                <span>
                  <strong>{PHASE_LABEL[next]}</strong> requires the shell to be complete — the
                  building is still in{' '}
                  <strong>{(anchorBuildingPhase(p) ?? 'an unknown phase').replace(/_/g, ' ').toLowerCase()}</strong>.
                  No parallel fit-out before shell completion.
                </span>
              </div>
            )}

            {/* Phase actions */}
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && !isTerminal && next && (
                <Button
                  size="sm" color={next === 'HANDOVER' ? 'success' : 'primary'}
                  endContent={next === 'HANDOVER' ? <FiFlag className="w-3.5 h-3.5" /> : <FiArrowRight className="w-3.5 h-3.5" />}
                  isDisabled={docBlocked || shellBlocked} isLoading={advance.isPending}
                  onPress={next === 'HANDOVER' ? () => { setSignoff({ handoverSignedBy: '', handoverNotes: '', forceReason: '' }); handoverModal.onOpen(); } : doAdvance}
                >
                  {next === 'HANDOVER' ? 'Complete handover' : `Advance to ${PHASE_LABEL[next]}`}
                </Button>
              )}
              {next === 'HANDOVER' && !isTerminal && (
                <span className="text-xs text-gray-500">Handover marks the project complete and triggers the client's TI payment.</span>
              )}
              {p.status === 'COMPLETED' && p.handoverAt && (
                <span className="inline-flex items-center gap-1 text-sm text-green-700">
                  <FiCheckCircle /> Handed over {fmtDate(p.handoverAt)}{p.handoverSignedBy ? ` · signed by ${p.handoverSignedBy}` : ''}
                </span>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ─── Financial + approvals strip ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* TI budget (isolated) */}
        <Card shadow="none" className="border border-gray-200/80 rounded-xl lg:col-span-2">
          <CardBody className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1.5">
                <FiDollarSign className="w-3.5 h-3.5" /> TI Budget
              </span>
              <Tooltip content="Interior spend is tracked separately and excluded from the main project budget.">
                <span className="text-[11px] text-gray-500 border border-gray-200 rounded-full px-2 py-0.5 cursor-default">
                  isolated from project budget
                </span>
              </Tooltip>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-4">
              <Metric label="Contract" value={fmt(fin.contract)} />
              <Metric label="Spent" value={fmt(fin.spend)} />
              <Metric label={fin.remaining < 0 ? 'Over by' : 'Remaining'} value={fmt(Math.abs(fin.remaining))} tone={fin.remaining < 0 ? 'rose' : 'emerald'} />
            </div>
            <Progress
              aria-label="TI budget used" value={Math.round(fin.usedPct * 100)} size="sm" className="mt-3"
              color={fin.remaining < 0 ? 'danger' : fin.usedPct > 0.9 ? 'warning' : 'success'}
            />
            {p.contractType === 'PER_SQFT' && p.ratePerSqft && (
              <p className="text-xs text-gray-500 mt-2">
                {fmt(Number(p.ratePerSqft))}/sqft × {p.area ? Number(p.area).toLocaleString() : '—'} sqft
              </p>
            )}
          </CardBody>
        </Card>

        {/* Approvals + dates */}
        <Card shadow="none" className="border border-gray-200/80 rounded-xl">
          <CardBody className="p-5 space-y-3">
            <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Approvals & dates</span>
            <ApprovalRow
              label="Client approval" at={p.clientApprovedAt}
              canRecord={canApprove && phase === 'CLIENT_APPROVAL' && !p.clientApprovedAt}
              onRecord={() => doApprove('client')} loading={approve.isPending}
            />
            <ApprovalRow
              label="City approval" at={p.cityApprovedAt}
              canRecord={canApprove && phase === 'CITY_APPROVAL' && !p.cityApprovedAt}
              onRecord={() => doApprove('city')} loading={approve.isPending}
            />
            <div className="flex justify-between text-xs text-gray-500 pt-1 border-t border-gray-100">
              <span>Target handover</span>
              <span className="tabular-nums">{p.targetEnd ? fmtDate(p.targetEnd) : '—'}</span>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ─── Tabs ─── */}
      <Card shadow="none" className="border border-gray-200/80 rounded-xl">
        <CardBody className="p-4">
          <Tabs aria-label="Interior detail" variant="underlined">
            <Tab key="scope" title={`Scope / BOQ${p.scopeItems?.length ? ` (${p.scopeItems.length})` : ''}`}>
              <div className="pt-3">
                <InteriorBOQPanel projectId={p.id} items={p.scopeItems ?? []} contractValue={fin.contract || undefined} />
              </div>
            </Tab>

            <Tab key="invoices" title={`Invoices${invoices.length ? ` (${invoices.length})` : ''}`}>
              <div className="pt-3">
                <InvoicesPanel projectId={p.id} invoices={invoices} spend={fin.spend} canFinance={canFinance} />
              </div>
            </Tab>

            <Tab key="snags" title={`Snags${p.snags?.length ? ` (${p.snags.filter((s: any) => s.status !== 'RESOLVED').length})` : ''}`}>
              <div className="pt-3">
                <SnagPanel
                  projectId={p.id}
                  snags={(p.snags ?? []).map((s: any) => ({ ...s, assignee: s.assignee?.name }))}
                />
              </div>
            </Tab>

            <Tab key="documents" title="Documents">
              <div className="pt-3">
                <InteriorDocumentsPanel interiorProjectId={p.id} currentPhase={p.phase} />
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>

      {/* Handover sign-off modal */}
      <Modal isOpen={handoverModal.isOpen} onClose={handoverModal.onClose} size="sm">
        <ModalContent>
          <ModalHeader>{openSnags.length > 0 ? 'Hand over with open items?' : 'Complete handover'}</ModalHeader>
          <ModalBody className="space-y-3">
            <p className="text-sm text-gray-600">
              Record the client sign-off. This marks the fit-out COMPLETED and flips the client's TI installment to due.
            </p>

            {/* Open punch-list items normally block handover. The override exists for the
                real case — an agreed handover held up by a cosmetic snag whose contractor
                has left site — and it costs a written reason, kept beside the sign-off. */}
            {openSnags.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                  <FiAlertTriangle size={13} />
                  {openSnags.length} punch-list item{openSnags.length === 1 ? '' : 's'} still open
                </p>
                <ul className="text-xs text-amber-800 list-disc pl-4 space-y-0.5 max-h-24 overflow-y-auto">
                  {openSnags.slice(0, 6).map((sn: any) => (
                    <li key={sn.id} className="truncate">{sn.description}</li>
                  ))}
                  {openSnags.length > 6 && <li className="italic">…and {openSnags.length - 6} more</li>}
                </ul>
                <Input
                  size="sm"
                  isRequired
                  label="Reason for handing over anyway"
                  placeholder="e.g. Client accepted; contractor returns 12 Sep for the skirting"
                  value={signoff.forceReason}
                  onChange={(e) => setSignoff((st) => ({ ...st, forceReason: e.target.value }))}
                />
                <p className="text-[11px] text-amber-700">
                  Recorded on the fit-out and in the audit log.
                </p>
              </div>
            )}
            <Input
              label="Signed off by (client representative)"
              placeholder="e.g. Priya Menon"
              value={signoff.handoverSignedBy}
              onChange={(e) => setSignoff((s) => ({ ...s, handoverSignedBy: e.target.value }))}
            />
            <Input
              label="Notes (optional)"
              placeholder="e.g. All snags cleared, keys handed over"
              value={signoff.handoverNotes}
              onChange={(e) => setSignoff((s) => ({ ...s, handoverNotes: e.target.value }))}
            />
            <p className="text-[11px] text-gray-500">
              Tip: upload the signed handover certificate and site photos in the Documents tab.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={handoverModal.onClose}>Cancel</Button>
            <Button
              size="sm"
              color={openSnags.length > 0 ? 'warning' : 'success'}
              isLoading={advance.isPending}
              isDisabled={openSnags.length > 0 && !signoff.forceReason.trim()}
              onPress={doHandover}
            >
              {openSnags.length > 0
                ? `Hand over with ${openSnags.length} open item${openSnags.length === 1 ? '' : 's'}`
                : 'Confirm handover'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Edit modal */}
      {editModal.isOpen && (
        <EditInteriorModal project={p} onClose={editModal.onClose} update={update} />
      )}

      {/* Delete confirm */}
      <Modal isOpen={deleteModal.isOpen} onClose={deleteModal.onClose} size="sm">
        <ModalContent>
          <ModalHeader>Delete this fit-out?</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-600">
              This archives <span className="font-medium">{p.name}</span> (status set to CANCELLED). Its invoices and snags are retained.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={deleteModal.onClose}>Cancel</Button>
            <Button
              size="sm" color="danger" isLoading={del.isPending}
              onPress={async () => {
                try {
                  await del.mutateAsync(p.id);
                  addToast({ title: 'Fit-out deleted', color: 'success' });
                  navigate('/interior');
                } catch (e) {
                  addToast({ title: errMsg(e, 'Failed to delete'), color: 'danger' });
                }
              }}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'emerald' }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums truncate ${tone === 'rose' ? 'text-rose-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-gray-900'}`}>
        {value}
      </div>
    </div>
  );
}

function ApprovalRow({ label, at, canRecord, onRecord, loading }: {
  label: string; at?: string | null; canRecord: boolean; onRecord: () => void; loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-gray-600">{label}</span>
      {at ? (
        <span className="inline-flex items-center gap-1 text-xs text-green-700"><FiCheckCircle size={13} /> {fmtDate(at)}</span>
      ) : canRecord ? (
        <Button size="sm" variant="flat" startContent={<FiCheckCircle size={13} />} isLoading={loading} onPress={onRecord}>Record</Button>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-gray-300"><FiClock size={12} /> pending</span>
      )}
    </div>
  );
}

function InvoicesPanel({ projectId, invoices, spend, canFinance }: {
  projectId: string; invoices: any[]; spend: number; canFinance: boolean;
}) {
  const { data: vendors } = useVendors();
  const addInvoice = useAddInteriorInvoice();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ vendorId: '', amount: '', invoiceNo: '', invoiceDate: '' });
  const vendorList: any[] = Array.isArray(vendors) ? vendors : [];

  const submit = async () => {
    if (!form.vendorId) return addToast({ title: 'Select a vendor', color: 'warning' });
    if (!form.amount || Number(form.amount) <= 0) return addToast({ title: 'Enter a positive amount', color: 'warning' });
    try {
      await addInvoice.mutateAsync({
        id: projectId,
        data: {
          vendorId: form.vendorId,
          amount: Number(form.amount),
          invoiceNo: form.invoiceNo.trim() || undefined,
          invoiceDate: form.invoiceDate || undefined,
        },
      });
      addToast({ title: 'Invoice logged', color: 'success' });
      setForm({ vendorId: '', amount: '', invoiceNo: '', invoiceDate: '' });
      setAdding(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to log invoice'), color: 'danger' });
    }
  };

  const STATUS_COLOR_INV: Record<string, 'default' | 'warning' | 'success'> = {
    PENDING: 'warning', APPROVED: 'default', PAID: 'success',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sub-contractor invoices</span>
        {canFinance && (
          <Button size="sm" variant="flat" color="primary" startContent={<FiPlus size={13} />} onPress={() => setAdding((v) => !v)}>
            Log invoice
          </Button>
        )}
      </div>

      {adding && canFinance && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-2.5">
          <div className="flex flex-col sm:flex-row gap-2">
            <Select
              size="sm" label="Vendor" selectedKeys={form.vendorId ? [form.vendorId] : []}
              onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))} className="flex-1"
            >
              {vendorList.map((v) => <SelectItem key={v.id}>{v.name}</SelectItem>)}
            </Select>
            <Input size="sm" type="number" label="Amount" value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="sm:w-32" />
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input size="sm" label="Invoice no." value={form.invoiceNo}
              onChange={(e) => setForm((f) => ({ ...f, invoiceNo: e.target.value }))} className="flex-1" />
            <Input size="sm" type="date" label="Invoice date" value={form.invoiceDate}
              onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))} className="flex-1" />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="light" onPress={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" color="primary" isLoading={addInvoice.isPending} onPress={submit}>Log invoice</Button>
          </div>
        </div>
      )}

      {invoices.length === 0 ? (
        <p className="text-sm text-gray-500 italic py-4 text-center">No sub-contractor invoices yet.</p>
      ) : (
        <div className="space-y-1.5">
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 text-sm border-b border-gray-50 py-1.5">
              <div className="min-w-0">
                <span className="text-gray-700 font-medium">{inv.vendor?.name ?? 'Vendor'}</span>
                {inv.invoiceNo && <span className="text-gray-500 text-xs ml-2">#{inv.invoiceNo}</span>}
                {inv.invoiceDate && <span className="text-gray-500 text-xs ml-2">{fmtDate(inv.invoiceDate)}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {inv.paidAt && <span className="text-[11px] text-gray-500">paid {fmtDate(inv.paidAt)}</span>}
                <Chip size="sm" variant="flat" color={STATUS_COLOR_INV[inv.status] ?? 'default'} className="text-[11px]">{inv.status}</Chip>
                <span className="tabular-nums font-semibold">{fmt(Number(inv.amount))}</span>
                {canFinance && (
                  <InvoiceActions
                    projectId={projectId}
                    invoice={inv}
                    onChanged={() => undefined}
                  />
                )}
              </div>
            </div>
          ))}
          <div className="flex justify-between text-sm font-semibold pt-2">
            <span className="text-gray-500">Total spend</span>
            <span className="tabular-nums">{fmt(spend)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function EditInteriorModal({ project, onClose, update }: { project: any; onClose: () => void; update: ReturnType<typeof useUpdateInterior> }) {
  const [form, setForm] = useState({
    name: project.name ?? '',
    contractType: project.contractType ?? 'PER_SQFT',
    ratePerSqft: project.ratePerSqft != null ? String(project.ratePerSqft) : '',
    area: project.area != null ? String(project.area) : '',
    contractValue: project.contractValue != null ? String(project.contractValue) : '',
    targetEnd: project.targetEnd ? String(project.targetEnd).slice(0, 10) : '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const derived = derivesOwnValue(form.contractType);

  const submit = async () => {
    if (!form.name.trim()) return addToast({ title: 'Name is required', color: 'warning' });
    if (!derived && form.contractValue && Number(form.contractValue) < 0) {
      return addToast({ title: 'Contract value cannot be negative', color: 'warning' });
    }
    try {
      await update.mutateAsync({
        id: project.id,
        data: {
          name: form.name.trim(),
          contractType: form.contractType || undefined,
          ratePerSqft: form.ratePerSqft ? Number(form.ratePerSqft) : undefined,
          area: form.area ? Number(form.area) : undefined,
          // Only for the types with no formula — see derivesOwnValue.
          contractValue: derived ? undefined : form.contractValue ? Number(form.contractValue) : undefined,
          targetEnd: form.targetEnd || undefined,
        },
      });
      addToast({ title: 'Fit-out updated', color: 'success' });
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen onClose={onClose}>
      <ModalContent>
        <ModalHeader>Edit fit-out</ModalHeader>
        <ModalBody className="space-y-3">
          <Input label="Name" value={form.name} onChange={set('name')} />
          <Select
            label="Contract type"
            selectedKeys={[form.contractType]}
            onChange={(e) => setForm((f) => ({ ...f, contractType: e.target.value }))}
          >
            {CONTRACT_TYPES.map((ct) => (
              <SelectItem key={ct} textValue={ct}>{ct.replace('_', ' ')}</SelectItem>
            ))}
          </Select>
          <div className="flex gap-3">
            <Input type="number" label="Rate / sqft" value={form.ratePerSqft} onChange={set('ratePerSqft')} />
            <Input type="number" label="Area (sqft)" value={form.area} onChange={set('area')} />
          </div>
          {derived ? (
            form.ratePerSqft && form.area ? (
              <p className="text-xs text-gray-500">Contract value ≈ {fmt(Number(form.ratePerSqft) * Number(form.area))}</p>
            ) : null
          ) : (
            <Input
              type="number"
              label={form.contractType === 'COST_PLUS' ? 'Contract value ($) — cost plus' : 'Fixed contract value ($)'}
              description="Entered manually — this contract type has no rate x area formula."
              value={form.contractValue}
              onChange={set('contractValue')}
            />
          )}
          <Input type="date" label="Target handover" value={form.targetEnd} onChange={set('targetEnd')} />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>Cancel</Button>
          <Button color="primary" isLoading={update.isPending} onPress={submit}>Save</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * PENDING -> APPROVED -> PAID, plus void (client, 2026-09-01).
 *
 * Until this existed the status column was a decoration: nothing could change it, so every
 * invoice ever logged read PENDING for the rest of its life. Void is destructive — it also
 * reverses the Actual that carries this invoice into the TI spend figures — so it confirms.
 */
function InvoiceActions({ projectId, invoice, onChanged }: {
  projectId: string; invoice: any; onChanged: () => void;
}) {
  const update = useUpdateInteriorInvoice();
  const voidInv = useVoidInteriorInvoice();
  const [confirmingVoid, setConfirmingVoid] = useState(false);

  const move = async (status: string) => {
    try {
      await update.mutateAsync({ id: projectId, invoiceId: invoice.id, data: { status } });
      addToast({ title: `Invoice ${status.toLowerCase()}`, color: 'success' });
      onChanged();
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not update the invoice'), color: 'danger' });
    }
  };

  const doVoid = async () => {
    try {
      await voidInv.mutateAsync({ id: projectId, invoiceId: invoice.id });
      addToast({ title: 'Invoice voided — recorded spend reversed', color: 'success' });
      setConfirmingVoid(false);
      onChanged();
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not void the invoice'), color: 'danger' });
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        {invoice.status === 'PENDING' && (
          <Button size="sm" variant="flat" className="h-6 min-w-0 px-2 text-[11px]"
            isLoading={update.isPending} onPress={() => move('APPROVED')}>
            Approve
          </Button>
        )}
        {invoice.status === 'APPROVED' && (
          <>
            <Button size="sm" variant="flat" color="success" className="h-6 min-w-0 px-2 text-[11px]"
              isLoading={update.isPending} onPress={() => move('PAID')}>
              Mark paid
            </Button>
            <Tooltip content="Undo approval">
              <Button size="sm" isIconOnly variant="light" className="h-6 w-6 min-w-0"
                aria-label="Undo approval" onPress={() => move('PENDING')}>
                <FiArrowLeft className="w-3 h-3 text-gray-400" />
              </Button>
            </Tooltip>
          </>
        )}
        <Tooltip content="Void invoice">
          <Button size="sm" isIconOnly variant="light" color="danger" className="h-6 w-6 min-w-0"
            aria-label="Void invoice" onPress={() => setConfirmingVoid(true)}>
            <FiTrash2 className="w-3 h-3" />
          </Button>
        </Tooltip>
      </div>

      <Modal isOpen={confirmingVoid} onClose={() => setConfirmingVoid(false)} size="sm">
        <ModalContent>
          <ModalHeader>Void this invoice?</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-600">
              {invoice.vendor?.name ?? 'Vendor'}{invoice.invoiceNo ? ` · #${invoice.invoiceNo}` : ''} ·{' '}
              <span className="font-semibold">{fmt(Number(invoice.amount))}</span>
            </p>
            <p className="text-sm text-gray-600">
              This deletes the invoice <strong>and</strong> reverses the spend it recorded, so
              the TI budget, cashflow and fit-out report all stop counting it.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setConfirmingVoid(false)}>Cancel</Button>
            <Button size="sm" color="danger" isLoading={voidInv.isPending} onPress={doVoid}>Void invoice</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
