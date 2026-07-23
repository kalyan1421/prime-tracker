import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Chip, Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Select, SelectItem, Textarea, useDisclosure, addToast } from '@heroui/react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { FiBarChart2, FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import {
  useCampaigns, useCampaignPerformance, useCampaignSpendByCampaign,
  useCreateCampaign, useUpdateCampaign, useDeleteCampaign, useRecordCampaignSpend, useProjects,
} from '../hooks/useApi';
import { LoadingState, ErrorState, StatCard, EmptyState } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { fmt, errMsg } from '../utils/fmt';

const CHANNELS = ['META', 'GOOGLE_ADS', 'NEWSPAPER', 'BROKER', 'EMAIL', 'SIGNAGE', 'EVENT', 'OTHER'];
const STATUSES = ['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED'];

// Stable color per channel so chart/chip colors don't reshuffle between renders.
const CHANNEL_FILL: Record<string, string> = {
  META:       '#3b82f6',
  GOOGLE_ADS: '#10b981',
  NEWSPAPER:  '#f59e0b',
  BROKER:     '#a855f7',
  EMAIL:      '#06b6d4',
  SIGNAGE:    '#ef4444',
  EVENT:      '#84cc16',
  OTHER:      '#94a3b8',
};

const STATUS_COLOR: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
  PLANNED: 'default',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'primary',
};

export default function CampaignsPage() {
  const { hasPermission } = useAuthStore();
  const canCreate = hasPermission('campaign:create');
  const canSpend = hasPermission('campaign:spend');
  const canEdit = hasPermission('campaign:edit');
  const canDelete = hasPermission('campaign:delete');

  const [projectId, setProjectId] = useState<string>('');
  const { data: projects } = useProjects();
  const { data: performance, isLoading: perfLoading } = useCampaignPerformance(projectId ? { projectId } : undefined);
  const { data: campaigns } = useCampaigns(projectId ? { projectId } : undefined);
  const { data: spendByCampaign } = useCampaignSpendByCampaign(projectId ? { projectId } : undefined);

  const formModal = useDisclosure();
  const spendModal = useDisclosure();
  const deleteModal = useDisclosure();
  const [spendTarget, setSpendTarget] = useState<any>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const deleteCampaign = useDeleteCampaign();

  if (perfLoading) return <LoadingState />;

  const perf = (performance as any[]) || [];
  const byCampaign = (spendByCampaign as any[]) || [];

  // KPI rollup across the full performance table.
  const totalSpend = perf.reduce((s, c) => s + c.totalSpend, 0);
  const totalLeads = perf.reduce((s, c) => s + c.leadCount, 0);
  const totalConverted = perf.reduce((s, c) => s + c.convertedCount, 0);
  const totalRevenue = perf.reduce((s, c) => s + c.convertedRevenue, 0);
  const overallRoi = totalSpend > 0 ? totalRevenue / totalSpend : null;
  const activeCount = ((campaigns as any[]) || []).filter((c: any) => c.status === 'ACTIVE').length;

  // Full campaign records (with projectId, dates, notes, etc.) keyed by id — the
  // performance rows only carry aggregate/report fields, not the raw editable ones.
  const campaignsById = new Map(((campaigns as any[]) || []).map((c: any) => [c.id, c]));

  const openCreate = () => { setEditTarget(null); formModal.onOpen(); };
  const openEdit = (c: any) => { setEditTarget(campaignsById.get(c.campaignId) ?? null); formModal.onOpen(); };
  const openDelete = (c: any) => { setDeleteTarget(c); deleteModal.onOpen(); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCampaign.mutateAsync(deleteTarget.campaignId);
      addToast({ title: 'Campaign deleted', color: 'success' });
      deleteModal.onClose();
      setDeleteTarget(null);
    } catch (err) {
      addToast({ title: errMsg(err, 'Failed to delete campaign'), color: 'danger' });
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
            <FiBarChart2 className="text-blue-600" /> Ads & Campaigns
          </h1>
          <p className="text-sm text-gray-500 mt-1">Marketing spend, lead attribution, and ROI by campaign.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="">All projects (portfolio)</option>
            {((projects as any[]) || []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {canCreate && (
            <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>
              New Campaign
            </Button>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active campaigns" value={activeCount.toString()} />
        <StatCard label="Total spend" value={fmt(totalSpend)} />
        <StatCard label="Leads / conversions" value={`${totalLeads} / ${totalConverted}`} />
        <StatCard label="Overall ROI" value={overallRoi != null ? `${overallRoi.toFixed(2)}x` : '—'} />
      </div>

      {/* Performance table */}
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-700">Campaign performance</p>
        </CardHeader>
        <CardBody className="pt-0 overflow-x-auto">
          {perf.length === 0 ? (
            <EmptyState
              title="No campaigns yet"
              message="Create a campaign to start tracking ad spend and lead attribution."
              action={canCreate ? <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>New Campaign</Button> : null}
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left py-2 pr-3">Campaign</th>
                  <th className="text-left py-2 pr-3">Channel</th>
                  <th className="text-left py-2 pr-3">Status</th>
                  <th className="text-right py-2 pr-3">Spend</th>
                  <th className="text-right py-2 pr-3">Leads</th>
                  <th className="text-right py-2 pr-3">Converted</th>
                  <th className="text-right py-2 pr-3">CPL</th>
                  <th className="text-right py-2 pr-3">CPA</th>
                  <th className="text-right py-2 pr-3">ROI</th>
                  <th className="text-right py-2"></th>
                </tr>
              </thead>
              <tbody>
                {perf.map((c) => (
                  <tr key={c.campaignId} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-3 font-medium text-gray-800">{c.name}</td>
                    <td className="py-2 pr-3">
                      <Chip size="sm" variant="flat" className="text-[10px]"
                        style={{ backgroundColor: (CHANNEL_FILL[c.channel] || '#94a3b8') + '20', color: CHANNEL_FILL[c.channel] || '#475569' }}>
                        {String(c.channel).replace('_', ' ')}
                      </Chip>
                    </td>
                    <td className="py-2 pr-3">
                      <Chip size="sm" color={STATUS_COLOR[c.status] || 'default'} variant="flat" className="text-[10px]">
                        {c.status}
                      </Chip>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmt(c.totalSpend)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.leadCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.convertedCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{c.cpl != null ? fmt(c.cpl) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{c.cpa != null ? fmt(c.cpa) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium">
                      {c.roi != null ? (
                        <span className={c.roi >= 1 ? 'text-emerald-600' : 'text-rose-600'}>
                          {c.roi.toFixed(2)}x
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canSpend && (
                          <Button size="sm" variant="light" onPress={() => { setSpendTarget(c); spendModal.onOpen(); }}>
                            + Spend
                          </Button>
                        )}
                        {canEdit && (
                          <Button size="sm" variant="light" isIconOnly onPress={() => openEdit(c)} aria-label="Edit campaign">
                            <FiEdit2 className="text-xs text-gray-400" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => openDelete(c)} aria-label="Delete campaign">
                            <FiTrash2 className="text-xs" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Spend by campaign — always includes every campaign, even ones with $0
          spend so far, so nothing is silently missing from the visualization. */}
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-700">Spend by campaign</p>
        </CardHeader>
        <CardBody className="pt-0">
          {byCampaign.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-12">No campaigns yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, byCampaign.length * 36)}>
              <BarChart data={byCampaign} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(n) => `$${n.toLocaleString()}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={140} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="totalSpend" radius={[0, 4, 4, 0]}>
                  {byCampaign.map((c: any) => (
                    <Cell key={c.campaignId} fill={CHANNEL_FILL[c.channel] || '#94a3b8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

      <CampaignFormModal isOpen={formModal.isOpen} onClose={() => { formModal.onClose(); setEditTarget(null); }} projects={(projects as any[]) || []} campaign={editTarget} />
      {spendTarget && (
        <RecordSpendModal isOpen={spendModal.isOpen} onClose={() => { spendModal.onClose(); setSpendTarget(null); }} campaign={spendTarget} />
      )}
      <Modal isOpen={deleteModal.isOpen} onClose={deleteModal.onClose} size="sm">
        <ModalContent>
          <ModalHeader>Delete campaign?</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-600">
              Delete <span className="font-medium text-gray-800">{deleteTarget?.name}</span>? It will be removed from
              lists and dashboards; historical spend and lead attribution are preserved.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={deleteModal.onClose}>Cancel</Button>
            <Button size="sm" color="danger" onPress={handleDelete} isLoading={deleteCampaign.isPending}>Delete</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ---- New / Edit Campaign modal ----

const EMPTY_CAMPAIGN_FORM = { name: '', channel: 'META', projectId: '', plannedBudget: '', status: 'ACTIVE', startDate: '', endDate: '', externalId: '', notes: '' };

function CampaignFormModal({ isOpen, onClose, projects, campaign }: { isOpen: boolean; onClose: () => void; projects: any[]; campaign?: any }) {
  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const isEdit = !!campaign;
  const [form, setForm] = useState(EMPTY_CAMPAIGN_FORM);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Re-seed the form whenever the modal opens, from the campaign being edited
  // (or blank for create). Project is intentionally excluded from edit payloads —
  // UpdateCampaignDto has no projectId field, so it can't be changed after creation.
  useEffect(() => {
    if (!isOpen) return;
    setForm(campaign ? {
      name: campaign.name ?? '',
      channel: campaign.channel ?? 'META',
      projectId: campaign.projectId ?? '',
      plannedBudget: campaign.plannedBudget != null ? String(campaign.plannedBudget) : '',
      status: campaign.status ?? 'ACTIVE',
      startDate: campaign.startDate ? String(campaign.startDate).slice(0, 10) : '',
      endDate: campaign.endDate ? String(campaign.endDate).slice(0, 10) : '',
      externalId: campaign.externalId ?? '',
      notes: campaign.notes ?? '',
    } : EMPTY_CAMPAIGN_FORM);
  }, [isOpen, campaign]);

  const submit = async () => {
    if (!form.name.trim() || !form.channel) {
      addToast({ title: 'Name and channel are required', color: 'warning' });
      return;
    }
    const shared = {
      name: form.name.trim(),
      channel: form.channel,
      plannedBudget: form.plannedBudget ? parseFloat(form.plannedBudget) : undefined,
      status: form.status,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      externalId: form.externalId || undefined,
      notes: form.notes || undefined,
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: campaign.id, data: shared });
        addToast({ title: 'Campaign updated', color: 'success' });
      } else {
        await create.mutateAsync({ ...shared, projectId: form.projectId || undefined });
        addToast({ title: 'Campaign created', color: 'success' });
      }
      onClose();
    } catch (err) {
      addToast({ title: errMsg(err, isEdit ? 'Failed to update campaign' : 'Failed to create campaign'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>{isEdit ? 'Edit Campaign' : 'New Campaign'}</ModalHeader>
        <ModalBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input size="sm" label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} className="sm:col-span-2" />
            <Select size="sm" label="Channel *" selectedKeys={new Set([form.channel])} onSelectionChange={(k) => set('channel', Array.from(k)[0] as string)}>
              {CHANNELS.map((c) => <SelectItem key={c}>{c.replace('_', ' ')}</SelectItem>)}
            </Select>
            {isEdit ? (
              <Input size="sm" label="Project" isReadOnly isDisabled value={campaign.project?.name ?? 'All Projects (portfolio-wide)'}
                description="Project can't be changed after a campaign is created" />
            ) : (
              <Select size="sm" label="Project" placeholder="Portfolio-wide" selectedKeys={form.projectId ? new Set([form.projectId]) : new Set()} onSelectionChange={(k) => set('projectId', (Array.from(k)[0] as string) || '')}>
                <>
                  <SelectItem key="">All Projects (portfolio-wide)</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id}>{p.name}</SelectItem>)}
                </>
              </Select>
            )}
            <Input size="sm" label="Planned budget" type="number" value={form.plannedBudget} onChange={(e) => set('plannedBudget', e.target.value)} />
            <Select size="sm" label="Status" selectedKeys={new Set([form.status])} onSelectionChange={(k) => set('status', Array.from(k)[0] as string)}>
              {STATUSES.map((s) => <SelectItem key={s}>{s}</SelectItem>)}
            </Select>
            <Input size="sm" label="Start date" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            <Input size="sm" label="End date" type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
            <Input size="sm" label="External ID" placeholder="Meta Ad Set / Google Campaign ID" value={form.externalId} onChange={(e) => set('externalId', e.target.value)} className="sm:col-span-2" />
            <Textarea size="sm" label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} minRows={2} className="sm:col-span-2" />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={submit} isLoading={create.isPending || update.isPending}>{isEdit ? 'Save Changes' : 'Create'}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ---- Record spend modal ----

function RecordSpendModal({ isOpen, onClose, campaign }: { isOpen: boolean; onClose: () => void; campaign: any }) {
  const record = useRecordCampaignSpend();
  const [form, setForm] = useState({ amount: '', spentOn: new Date().toISOString().slice(0, 10), source: 'MANUAL', externalRef: '' });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.amount || !form.spentOn) {
      addToast({ title: 'Amount and date are required', color: 'warning' });
      return;
    }
    try {
      await record.mutateAsync({
        campaignId: campaign.campaignId,
        data: {
          amount: parseFloat(form.amount),
          spentOn: form.spentOn,
          source: form.source,
          externalRef: form.externalRef || undefined,
        },
      });
      addToast({ title: 'Spend recorded', color: 'success' });
      onClose();
      setForm({ amount: '', spentOn: new Date().toISOString().slice(0, 10), source: 'MANUAL', externalRef: '' });
    } catch (err: any) {
      addToast({ title: errMsg(err, 'Failed to record spend'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalContent>
        <ModalHeader>Log spend · {campaign.name}</ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <Input size="sm" label="Amount *" type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
            <Input size="sm" label="Date *" type="date" value={form.spentOn} onChange={(e) => set('spentOn', e.target.value)} />
            <Select size="sm" label="Source" selectedKeys={new Set([form.source])} onSelectionChange={(k) => set('source', Array.from(k)[0] as string)}>
              <SelectItem key="MANUAL">Manual entry</SelectItem>
              <SelectItem key="AGENCY_REPORT">Agency report</SelectItem>
              <SelectItem key="META_API">Meta API import</SelectItem>
              <SelectItem key="GOOGLE_API">Google Ads import</SelectItem>
            </Select>
            <Input size="sm" label="External ref" placeholder="Invoice ID / line item" value={form.externalRef} onChange={(e) => set('externalRef', e.target.value)} />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={submit} isLoading={record.isPending}>Save</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
