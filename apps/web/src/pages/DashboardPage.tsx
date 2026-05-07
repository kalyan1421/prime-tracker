import { Card, CardHeader, CardBody, Avatar } from '@heroui/react';
import { FiAlertTriangle, FiTrendingUp, FiMessageSquare, FiTarget } from 'react-icons/fi';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useDashboard, useLeads } from '../hooks/useApi';
import { StatCard, StatusBadge, LoadingState, ErrorState, fmt, fmtDate } from '../components/ui';
import { useAuthStore } from '../store/authStore';

const PHASE_COLORS: Record<string, string> = {
  PRE_DEVELOPMENT: '#805AD5', PERMITTING: '#DD6B20', CONSTRUCTION: '#3182CE',
  LEASE_UP: '#319795', STABILIZED: '#38A169', SOLD_REFI: '#00B5D8',
};
const ALERT_BG: Record<string, string> = {
  CRITICAL: 'bg-red-50 border-l-red-400',
  HIGH: 'bg-orange-50 border-l-orange-400',
  MEDIUM: 'bg-yellow-50 border-l-yellow-400',
  LOW: 'bg-blue-50 border-l-blue-400',
};

// Separate component so useLeads() is only called for SALES role
function SalesDashboardCards({ unitsAvailable, underContract }: { unitsAvailable: number; underContract: number }) {
  const { data: leads } = useLeads();
  const leadsArr = (leads as any[]) || [];
  const activeLeads = leadsArr.filter((l: any) => !['CONVERTED', 'LOST', 'DEAD'].includes(l.status)).length;

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard label="Units Available" value={String(unitsAvailable)} variant="revenue" colorScheme="green" />
      <StatCard label="Under Contract" value={String(underContract)} variant="revenue" colorScheme="brand" />
      <StatCard label="Active Leads" value={String(activeLeads)} variant="revenue" colorScheme="orange" />
      <StatCard label="Total Leads" value={String(leadsArr.length)} variant="revenue" colorScheme="purple" />
    </div>
  );
}

const SALES_MILESTONE_PHASES = ['LEASE_UP', 'STABILIZED', 'SOLD_REFI'];

export default function DashboardPage() {
  const { user } = useAuthStore();
  const role = user?.role || '';
  const { data, isLoading, error } = useDashboard();
  const navigate = useNavigate();

  if (isLoading) return <LoadingState message="Loading dashboard..." />;
  if (error) return <ErrorState />;
  if (!data) return null;

  const d = data as any;

  const isFounder = ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'].includes(role);
  const isViewer = role === 'VIEWER';
  const showConstructionBudget = ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP', 'PROJECT_MANAGER', 'CONSTRUCTION'].includes(role);
  const showCashFlow = ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'].includes(role);
  const showAlerts = !isViewer;
  const showMilestones = !isViewer;
  const showComments = !isViewer;

  const phaseData = Object.entries(d.projectsByPhase || {}).map(([name, value]) => ({
    name: name.replace(/_/g, ' '),
    value: value as number,
    color: PHASE_COLORS[name] || '#A0AEC0',
  }));

  const unitData = Object.entries(d.unitsByStatus || {}).map(([name, value]) => ({
    name: name.replace(/_/g, ' '),
    count: value as number,
  }));

  const variancePct = d.totalBudget > 0
    ? ((d.totalBudget - d.totalActuals) / d.totalBudget * 100)
    : 0;

  const unitsAvailable = d.unitsByStatus?.AVAILABLE || 0;
  const underContract = d.unitsByStatus?.UNDER_CONTRACT || 0;

  const isSalesRole = ['SALES', 'MARKETING'].includes(role);
  const filteredMilestones = isSalesRole
    ? (d.recentMilestones || []).filter((m: any) => SALES_MILESTONE_PHASES.includes(m.phase))
    : (d.recentMilestones || []);

  const filteredComments = isSalesRole
    ? (d.recentComments || []).filter((c: any) => ['SALES', 'MARKETING'].includes(c.commentType))
    : (d.recentComments || []);

  const constructionBudgetCard = (
    <Card shadow="sm">
      <CardHeader className="pb-2">
        <p className="font-semibold text-sm text-amber-700">🏗️ Construction Health</p>
      </CardHeader>
      <CardBody className="pt-0">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Total Budget"
            value={fmt(d.totalBudget)}
            helpText={`${d.totalProjects} projects`}
            colorScheme="brand"
            variant="construction"
          />
          <StatCard
            label="Total Actuals"
            value={fmt(d.totalActuals)}
            helpText={`${d.totalBudget > 0 ? ((d.totalActuals / d.totalBudget) * 100).toFixed(0) : 0}% spent`}
            colorScheme="orange"
            variant="construction"
          />
          <StatCard
            label="Committed"
            value={fmt(d.totalCommitted)}
            colorScheme="purple"
            variant="construction"
          />
          <StatCard
            label="Budget Variance"
            value={fmt(d.budgetVariance)}
            helpText={`${variancePct.toFixed(1)}% remaining`}
            trend={d.budgetVariance >= 0 ? 'increase' : 'decrease'}
            colorScheme={d.budgetVariance >= 0 ? 'green' : 'red'}
            variant="construction"
          />
        </div>
      </CardBody>
    </Card>
  );

  const cashFlowCard = (
    <Card shadow="sm">
      <CardHeader className="pb-2">
        <p className="font-semibold text-sm text-blue-700">💰 Monthly Cash Flow</p>
      </CardHeader>
      <CardBody className="pt-0">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Lease Income"
            value={fmt(d.totalMonthlyLeaseIncome || 0)}
            helpText={`${fmt((d.totalMonthlyLeaseIncome || 0) * 12)}/yr`}
            colorScheme="green"
            variant="revenue"
          />
          <StatCard
            label="Debt Service"
            value={fmt(d.totalMonthlyMortgage || 0)}
            helpText={`${fmt((d.totalMonthlyMortgage || 0) * 12)}/yr`}
            colorScheme="red"
            variant="revenue"
          />
          <StatCard
            label="Net Cash Flow"
            value={fmt(d.netMonthlyIncome || 0)}
            helpText={`${fmt((d.netMonthlyIncome || 0) * 12)}/yr`}
            trend={(d.netMonthlyIncome || 0) >= 0 ? 'increase' : 'decrease'}
            colorScheme={(d.netMonthlyIncome || 0) >= 0 ? 'green' : 'red'}
            variant="revenue"
          />
        </div>
      </CardBody>
    </Card>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Portfolio Dashboard</h1>

      {/* FOUNDER: Two-column layout */}
      {isFounder && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
            {constructionBudgetCard}
            {cashFlowCard}
          </div>
          <div className="mb-6">
            <Card shadow="sm">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <FiTarget className="text-blue-600" />
                  <p className="font-semibold text-sm text-blue-700">Sales & Availability</p>
                </div>
              </CardHeader>
              <CardBody className="pt-0">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Units Available" value={String(unitsAvailable)} variant="revenue" colorScheme="green" />
                  <StatCard label="Under Contract" value={String(underContract)} variant="revenue" colorScheme="brand" />
                  <StatCard label="Leased" value={String(d.unitsByStatus?.LEASED || 0)} variant="revenue" colorScheme="teal" />
                  <StatCard label="Sold" value={String(d.unitsByStatus?.SOLD || 0)} variant="revenue" colorScheme="purple" />
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {/* Non-Founder: single column sections */}
      {!isFounder && (
        <>
          {showConstructionBudget && <div className="mb-6">{constructionBudgetCard}</div>}
          {showCashFlow && <div className="mb-6">{cashFlowCard}</div>}
          {isSalesRole && (
            <div className="mb-6">
              <Card shadow="sm">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <FiTarget className="text-blue-600" />
                    <p className="font-semibold text-sm text-blue-700">Sales & Leads</p>
                  </div>
                </CardHeader>
                <CardBody className="pt-0">
                  <SalesDashboardCards unitsAvailable={unitsAvailable} underContract={underContract} />
                </CardBody>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Charts — all roles */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-600">Projects by Phase</p>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={phaseData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {phaseData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-600">Units by Status</p>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={unitData}>
                <XAxis dataKey="name" fontSize={11} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3182CE" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      {/* Alerts & Milestones */}
      {showAlerts && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
          <Card shadow="sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <FiAlertTriangle className="text-orange-500" />
                <p className="font-semibold text-sm text-gray-600">Alerts</p>
              </div>
            </CardHeader>
            <CardBody className="pt-0">
              {(d.alerts || []).length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No active alerts</p>
              ) : (
                <div className="max-h-[250px] overflow-auto">
                  {(d.alerts as any[]).map((a: any) => (
                    <div
                      key={a.id}
                      className={`p-3 mb-2 rounded-md border-l-3 flex items-center justify-between ${
                        ALERT_BG[a.severity] || 'bg-gray-50 border-l-gray-400'
                      } ${a.projectId ? 'cursor-pointer hover:opacity-80' : ''}`}
                      onClick={() => a.projectId && navigate(`/projects/${a.projectId}`)}
                    >
                      <div>
                        <p className="text-sm font-medium">{a.message}</p>
                        <p className="text-xs text-gray-500">{fmtDate(a.createdAt)}</p>
                      </div>
                      <StatusBadge status={a.severity} />
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {showMilestones && (
            <Card shadow="sm">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <FiTrendingUp className="text-blue-600" />
                  <p className="font-semibold text-sm text-gray-600">Upcoming Milestones</p>
                </div>
              </CardHeader>
              <CardBody className="pt-0">
                {filteredMilestones.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No upcoming milestones</p>
                ) : (
                  <div className="overflow-auto">
                    <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Milestone</th>
                          <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                          <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Due</th>
                          <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMilestones.slice(0, 8).map((m: any) => (
                          <tr key={m.id} className="border-b border-gray-50">
                            <td className="py-2 px-2">{m.title}</td>
                            <td className="py-2 px-2 text-xs text-gray-500">{m.projectName}</td>
                            <td className="py-2 px-2 text-xs">{fmtDate(m.dueDate)}</td>
                            <td className="py-2 px-2"><StatusBadge status={m.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* Recent Comments */}
      {showComments && filteredComments.length > 0 && (() => {
        const TYPE_ORDER = ['MARKETING', 'SALES', 'FINANCIAL'];
        const TYPE_LABELS: Record<string, string> = { MARKETING: 'Marketing', SALES: 'Sales', FINANCIAL: 'Financial' };
        const TYPE_COLORS: Record<string, string> = {
          MARKETING: 'bg-purple-100 text-purple-700',
          SALES: 'bg-blue-100 text-blue-700',
          FINANCIAL: 'bg-green-100 text-green-700',
        };
        const TYPE_HEADER: Record<string, string> = {
          MARKETING: 'text-purple-700',
          SALES: 'text-blue-700',
          FINANCIAL: 'text-green-700',
        };
        const grouped: Record<string, any[]> = { MARKETING: [], SALES: [], FINANCIAL: [] };
        for (const c of filteredComments as any[]) {
          const t = c.commentType || 'MARKETING';
          if (!grouped[t]) grouped[t] = [];
          grouped[t].push(c);
        }
        return (
          <Card shadow="sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <FiMessageSquare className="text-purple-600" />
                <p className="font-semibold text-sm text-gray-600">Recent Comments</p>
              </div>
            </CardHeader>
            <CardBody className="pt-0">
              <div className="max-h-[400px] overflow-auto">
                {TYPE_ORDER.filter((t) => grouped[t]?.length > 0).map((t) => (
                  <div key={t}>
                    <p className={`text-xs font-semibold uppercase mb-2 mt-3 first:mt-0 ${TYPE_HEADER[t]}`}>
                      {TYPE_LABELS[t]} ({grouped[t].length})
                    </p>
                    <div className="space-y-3">
                      {grouped[t].map((c: any) => (
                        <div
                          key={c.id}
                          className="flex gap-3 p-2 rounded-md hover:bg-gray-50 cursor-pointer"
                          onClick={() => {
                            if (c.source === 'project') {
                              const projId = c.project?.id;
                              if (projId) navigate(`/projects/${projId}/comments`);
                            } else {
                              const projId = c.unit?.building?.project?.id;
                              const uId = c.unit?.id;
                              if (projId && uId) navigate(`/projects/${projId}/units/${uId}`);
                              else if (projId) navigate(`/projects/${projId}/units`);
                            }
                          }}
                        >
                          <Avatar size="sm" name={c.user?.name} src={c.user?.avatarUrl} className="flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold">{c.user?.name}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[t]}`}>{TYPE_LABELS[t]}</span>
                              <span className="text-xs text-gray-400">{fmtDate(c.createdAt)}</span>
                            </div>
                            <p className="text-sm text-gray-700 break-words">{c.content}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {c.source === 'project'
                                ? c.project?.name
                                : `${c.unit?.building?.project?.name} \u00b7 ${c.unit?.building?.name} \u00b7 Unit ${c.unit?.unitNumber}`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        );
      })()}
    </div>
  );
}
