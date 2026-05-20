import { useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Select, SelectItem, Textarea, useDisclosure, addToast } from '@heroui/react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { FiBarChart2, FiPlus, FiDollarSign, FiTarget, FiTrendingUp, FiActivity } from 'react-icons/fi';
import {
  useCampaigns, useCampaignPerformance, useCampaignSpendTrend, useCreateCampaign, useRecordCampaignSpend, useProjects,
} from '../hooks/useApi';
import { LoadingState, ErrorState, StatCard, EmptyState } from '../components/ui';
import { useAuthStore } from '../store/authStore';

const CHANNELS = ['META', 'GOOGLE_ADS', 'NEWSPAPER', 'BROKER', 'EMAIL', 'SIGNAGE', 'EVENT', 'OTHER'];
const STATUSES = ['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED'];

// Stable color per channel so the trend chart legend doesn't reshuffle between renders.
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

const fmtMoney = (n: number) => n >= 1_00_000 ? `₹${(n / 1_00_000).toFixed(1)}L` : `₹${n.toLocaleString()}`;

export default function CampaignsPage() {
  const { hasPermission } = useAuthStore();
  const canCreate = hasPermission('campaign:create');
  const canSpend = hasPermission('campaign:spend');

  const [projectId, setProjectId] = useState<string>('');
  const { data: projects } = useProjects();
  const { data: performance, isLoading: perfLoading } = useCampaignPerformance(projectId ? { projectId } : undefined);
  const { data: trend } = useCampaignSpendTrend(projectId ? { projectId, monthsBack: 6 } : { monthsBack: 6 });
  const { data: campaigns } = useCampaigns(projectId ? { projectId } : undefined);

  const newModal = useDisclosure();
  const spendModal = useDisclosure();
  const [spendTarget, setSpendTarget] = useState<any>(null);

  if (perfLoading) return <LoadingState />;

  const perf = (performance as any[]) || [];
  const trendData = (trend as any)?.series || [];
  const channels: string[] = (trend as any)?.channels || [];

  // KPI rollup across the full performance table.
  const totalSpend = perf.reduce((s, c) => s + c.totalSpend, 0);
  const totalLeads = perf.reduce((s, c) => s + c.leadCount, 0);
  const totalConverted = perf.reduce((s, c) => s + c.convertedCount, 0);
  const totalRevenue = perf.reduce((s, c) => s + c.convertedRevenue, 0);
  const overallRoi = totalSpend > 0 ? totalRevenue / totalSpend : null;
  const activeCount = ((campaigns as any[]) || []).filter((c: any) => c.status === 'ACTIVE').length;

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
            <Button size="sm" color="primary" startContent={<FiPlus />} onPress={newModal.onOpen}>
              New Campaign
            </Button>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active campaigns" value={activeCount.toString()} />
        <StatCard label="Total spend" value={fmtMoney(totalSpend)} />
        <StatCard label="Leads / conversions" value={`${totalLeads} / ${totalConverted}`} />
        <StatCard label="Overall ROI" value={overallRoi != null ? `${overallRoi.toFixed(2)}x` : '—'} />
      </div>

      {/* Monthly spend chart */}
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-700">Monthly spend by channel (last 6 months)</p>
        </CardHeader>
        <CardBody className="pt-0">
          {trendData.length === 0 || channels.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-12">No spend logged yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(n) => n >= 1_00_000 ? `${(n / 1_00_000).toFixed(1)}L` : n.toLocaleString()} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Legend />
                {channels.map((ch) => (
                  <Line key={ch} type="monotone" dataKey={ch} stroke={CHANNEL_FILL[ch] || '#94a3b8'} strokeWidth={2} dot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

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
              action={canCreate ? <Button size="sm" color="primary" startContent={<FiPlus />} onPress={newModal.onOpen}>New Campaign</Button> : null}
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
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtMoney(c.totalSpend)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.leadCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.convertedCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{c.cpl != null ? fmtMoney(c.cpl) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{c.cpa != null ? fmtMoney(c.cpa) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium">
                      {c.roi != null ? (
                        <span className={c.roi >= 1 ? 'text-emerald-600' : 'text-rose-600'}>
                          {c.roi.toFixed(2)}x
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 text-right">
                      {canSpend && (
                        <Button size="sm" variant="light" onPress={() => { setSpendTarget(c); spendModal.onOpen(); }}>
                          + Spend
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <NewCampaignModal isOpen={newModal.isOpen} onClose={newModal.onClose} projects={(projects as any[]) || []} />
      {spendTarget && (
        <RecordSpendModal isOpen={spendModal.isOpen} onClose={() => { spendModal.onClose(); setSpendTarget(null); }} campaign={spendTarget} />
      )}
    </div>
  );
}

// ---- New Campaign modal ----

function NewCampaignModal({ isOpen, onClose, projects }: { isOpen: boolean; onClose: () => void; projects: any[] }) {
  const create = useCreateCampaign();
  const [form, setForm] = useState({ name: '', channel: 'META', projectId: '', plannedBudget: '', status: 'ACTIVE', startDate: '', endDate: '', externalId: '', notes: '' });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || !form.channel) {
      addToast({ title: 'Name and channel are required', color: 'warning' });
      return;
    }
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        channel: form.channel,
        projectId: form.projectId || undefined,
        plannedBudget: form.plannedBudget ? parseFloat(form.plannedBudget) : undefined,
        status: form.status,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        externalId: form.externalId || undefined,
        notes: form.notes || undefined,
      });
      addToast({ title: 'Campaign created', color: 'success' });
      onClose();
      setForm({ name: '', channel: 'META', projectId: '', plannedBudget: '', status: 'ACTIVE', startDate: '', endDate: '', externalId: '', notes: '' });
    } catch {
      addToast({ title: 'Failed to create campaign', color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>New Campaign</ModalHeader>
        <ModalBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input size="sm" label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} className="sm:col-span-2" />
            <Select size="sm" label="Channel *" selectedKeys={new Set([form.channel])} onSelectionChange={(k) => set('channel', Array.from(k)[0] as string)}>
              {CHANNELS.map((c) => <SelectItem key={c}>{c.replace('_', ' ')}</SelectItem>)}
            </Select>
            <Select size="sm" label="Project" placeholder="Portfolio-wide" selectedKeys={form.projectId ? new Set([form.projectId]) : new Set()} onSelectionChange={(k) => set('projectId', (Array.from(k)[0] as string) || '')}>
              {projects.map((p) => <SelectItem key={p.id}>{p.name}</SelectItem>)}
            </Select>
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
          <Button size="sm" color="primary" onPress={submit} isLoading={create.isPending}>Create</Button>
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
      const msg = err?.response?.data?.message ?? 'Failed to record spend';
      addToast({ title: msg, color: 'danger' });
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
