import { Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, Chip, Progress } from '@heroui/react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import {
  FiTarget, FiUsers, FiTrendingUp, FiClock, FiLink2, FiMail, FiPhone,
  FiAlertCircle, FiActivity,
} from 'react-icons/fi';
import { useLeadDashboard, useProjects } from '../hooks/useApi';
import { LoadingState, ErrorState, StatCard, fmtDate } from '../components/ui';
import { useState } from 'react';

const STATUS_ORDER = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'CONVERTED', 'LOST', 'DEAD'];

// Funnel coloring — warm at the top of the funnel, cool/successful at the bottom.
const STATUS_FILL: Record<string, string> = {
  NEW:           '#94a3b8',
  CONTACTED:     '#60a5fa',
  QUALIFIED:     '#3b82f6',
  PROPOSAL_SENT: '#a855f7',
  NEGOTIATING:   '#f59e0b',
  CONVERTED:     '#10b981',
  LOST:          '#ef4444',
  DEAD:          '#71717a',
};

// Source pie colors — one stable color per known source so the legend stays consistent across reloads.
const SOURCE_FILL = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#84cc16', '#6366f1', '#94a3b8'];

const ACTIVITY_LABELS: Record<string, string> = {
  CALL: 'Call', EMAIL: 'Email', MEETING: 'Meeting', SITE_VISIT: 'Site visit',
  FOLLOW_UP: 'Follow-up', NOTE: 'Note', STATUS_CHANGE: 'Status change',
};

export default function LeadDashboardPage() {
  const [projectId, setProjectId] = useState<string>('');
  const { data: projects } = useProjects();
  const { data, isLoading, error } = useLeadDashboard(projectId ? { projectId } : undefined);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load dashboard" />;
  if (!data) return null;

  const d = data as any;
  const funnel = STATUS_ORDER.map((s) => ({ status: s, count: d.byStatus[s] ?? 0 }));
  const conversionPct = d.conversionRate != null ? (d.conversionRate * 100).toFixed(1) : '—';

  // Attribution donut data
  const attribution = [
    { name: 'Unit', value: d.attribution.withUnit, fill: '#3b82f6' },
    { name: 'Building', value: d.attribution.withBuilding, fill: '#8b5cf6' },
    { name: 'Unattached', value: Math.max(0, d.attribution.unattached), fill: '#e5e7eb' },
  ].filter((s) => s.value > 0);

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header + filter */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
            <FiTarget className="text-blue-600" /> Lead Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">Pipeline health, sources, stale leads, and attribution.</p>
        </div>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="">All projects</option>
          {((projects as any[]) || []).map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total leads" value={d.totalLeads.toString()} />
        <StatCard label="Conversion rate" value={`${conversionPct}%`} />
        <StatCard label="Active" value={
          Object.entries(d.byStatus).filter(([s]) => !['LOST', 'DEAD', 'CONVERTED'].includes(s))
            .reduce((sum: number, [, n]) => sum + (n as number), 0).toString()
        } />
        <StatCard label="Stale (14d+)" value={d.staleLeads.length.toString()} />
      </div>

      {/* Pipeline funnel + Attribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card shadow="sm" className="lg:col-span-2">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-700">Pipeline funnel</p>
          </CardHeader>
          <CardBody className="pt-0">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={funnel} layout="vertical" margin={{ left: 30 }}>
                <XAxis type="number" allowDecimals={false} />
                <YAxis dataKey="status" type="category" width={120} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {funnel.map((row) => (
                    <Cell key={row.status} fill={STATUS_FILL[row.status]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <FiLink2 className="text-blue-600" />
              <p className="font-semibold text-sm text-gray-700">Attribution health</p>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {attribution.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No leads yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={attribution} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {attribution.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="text-xs text-gray-500 mt-2 space-y-1">
              <div className="flex justify-between"><span>Linked to a unit</span><span className="font-medium text-gray-700">{d.attribution.withUnit}</span></div>
              <div className="flex justify-between"><span>Linked to a building</span><span className="font-medium text-gray-700">{d.attribution.withBuilding}</span></div>
              <div className="flex justify-between"><span>Linked to a campaign</span><span className="font-medium text-gray-700">{d.attribution.withCampaign}</span></div>
              <div className="flex justify-between"><span>No asset link</span><span className="font-medium text-rose-600">{Math.max(0, d.attribution.unattached)}</span></div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Sources + Stale leads */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-700">Top sources</p>
          </CardHeader>
          <CardBody className="pt-0">
            {d.bySource.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No source data</div>
            ) : (
              <div className="space-y-2">
                {d.bySource.slice(0, 7).map((row: any, idx: number) => {
                  const pct = d.totalLeads > 0 ? (row.count / d.totalLeads) * 100 : 0;
                  return (
                    <div key={row.source}>
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>{row.source.replace('_', ' ')}</span>
                        <span className="font-medium">{row.count}</span>
                      </div>
                      <Progress size="sm" value={pct} aria-label={row.source}
                        classNames={{ indicator: '' }}
                        style={{ '--heroui-primary': SOURCE_FILL[idx % SOURCE_FILL.length] } as React.CSSProperties}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card shadow="sm" className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <FiClock className="text-amber-600" />
              <p className="font-semibold text-sm text-gray-700">Stale leads (no activity in 14+ days)</p>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {d.staleLeads.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">Nothing stale — clean pipeline.</div>
            ) : (
              <div className="space-y-1">
                {d.staleLeads.map((l: any) => {
                  const daysSince = Math.floor((Date.now() - new Date(l.updatedAt).getTime()) / 86_400_000);
                  return (
                    <Link key={l.id} to="/leads" className="block">
                      <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 -mx-2 px-2 rounded">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{l.name || <span className="italic text-gray-400">Unnamed</span>}</p>
                          <Chip size="sm" variant="flat" className="text-[10px]" style={{ backgroundColor: STATUS_FILL[l.status] + '20', color: STATUS_FILL[l.status] }}>
                            {l.status.replace('_', ' ')}
                          </Chip>
                          {l.project?.name && <span className="text-xs text-blue-600 truncate">{l.project.name}</span>}
                        </div>
                        <span className="text-xs text-rose-600 shrink-0 ml-2">{daysSince}d</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Recent activity */}
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <FiActivity className="text-blue-600" />
            <p className="font-semibold text-sm text-gray-700">Recent activity</p>
          </div>
        </CardHeader>
        <CardBody className="pt-0">
          {d.recentActivity.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8">No activity logged yet.</div>
          ) : (
            <div className="space-y-1">
              {d.recentActivity.map((a: any) => (
                <div key={a.id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-b-0">
                  <Chip size="sm" variant="flat" className="text-[10px] shrink-0">{ACTIVITY_LABELS[a.type] || a.type}</Chip>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{a.note}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      <Link to="/leads" className="text-blue-600 hover:underline">{a.lead?.name || 'Unnamed'}</Link>
                      {a.createdByUser?.name && <> · by {a.createdByUser.name}</>}
                      <> · {fmtDate(a.createdAt)}</>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
