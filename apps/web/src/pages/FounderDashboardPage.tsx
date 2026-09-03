import { useEffect, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardBody, Avatar } from '@heroui/react';
import {
  PieChart, Pie, Cell, Legend, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { FiAlertTriangle, FiTrendingUp, FiMessageSquare } from 'react-icons/fi';
import { useFounderDashboard, useRecentComments, useExceptions } from '../hooks/useApi';
import { fmt, fmtDate } from '../utils/fmt';
import { StatCard, StatusBadge, LoadingState, ErrorState } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { CommentChip, type CommentType } from '../components/CommentChip';
import { ExceptionFeed } from '../components/ExceptionFeed';

const COMMENT_TYPE_COLORS: Record<string, string> = {
  MARKETING: 'bg-purple-100 text-purple-700',
  SALES: 'bg-blue-100 text-blue-700',
  FINANCIAL: 'bg-green-100 text-green-700',
};
const COMMENT_TYPE_LABELS: Record<string, string> = {
  MARKETING: 'Marketing', SALES: 'Sales', FINANCIAL: 'Financial',
};
const COMMENT_TYPE_HEADER: Record<string, string> = {
  MARKETING: 'text-purple-700', SALES: 'text-blue-700', FINANCIAL: 'text-green-700',
};

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

export default function FounderDashboardPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { data, isLoading, error } = useFounderDashboard();
  const { data: commentsData } = useRecentComments(20);

  useEffect(() => {
    if (!user?.role) return;
    if (!['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'].includes(user.role)) {
      if (['CONSTRUCTION', 'PROJECT_MANAGER'].includes(user.role)) navigate('/dashboard/construction', { replace: true });
      else if (['SALES', 'MARKETING'].includes(user.role)) navigate('/dashboard/sales', { replace: true });
      else navigate('/', { replace: true });
    }
  }, [user?.role, navigate]);

  if (isLoading) return <LoadingState message="Loading founder dashboard..." />;
  if (error) return <ErrorState />;
  if (!data) return null;

  const d = data as any;
  const budgetUtilPct = d.totalBudget > 0 ? ((d.totalActuals / d.totalBudget) * 100).toFixed(1) : '0';
  const variancePct = d.totalBudget > 0 ? ((d.totalBudget - d.totalActuals) / d.totalBudget * 100).toFixed(1) : '0';

  const phaseData = Object.entries(d.projectsByPhase || {}).map(([name, value]) => ({
    name: name.replace(/_/g, ' '),
    value: value as number,
    color: PHASE_COLORS[name] || '#A0AEC0',
  }));

  const unitData = Object.entries(d.unitsByStatus || {}).map(([name, value]) => ({
    name: name.replace(/_/g, ' '),
    count: value as number,
  }));

  const overdueMilestones = (d.recentMilestones || []).filter((m: any) => m.status === 'OVERDUE');

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Founder Dashboard</h1>

      {/* Zone A — Portfolio Health Bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <StatCard label="Total Projects" value={String(d.totalProjects)} helpText={`${d.activeProjects} active`} variant="neutral" colorScheme="gray" onClick={() => navigate('/projects')} />
        <StatCard label="Active Projects" value={String(d.activeProjects)} variant="neutral" colorScheme="brand" onClick={() => navigate('/projects')} />
        <StatCard label="Budget Utilization" value={`${budgetUtilPct}%`} helpText={`${variancePct}% remaining`} variant="construction" colorScheme="orange" onClick={() => navigate('/reports/founder')} />
        <StatCard label="Net Monthly Cash Flow" value={fmt(d.netMonthlyIncome)} helpText={d.netMonthlyIncome >= 0 ? 'Positive NOI' : 'Negative NOI'} trend={d.netMonthlyIncome >= 0 ? 'increase' : 'decrease'} variant="revenue" colorScheme={d.netMonthlyIncome >= 0 ? 'green' : 'red'} onClick={() => navigate('/cashflow')} />
        <StatCard label="Loan Book Total" value={fmt(d.loanBook?.totalPrincipal)} helpText={`${fmt(d.loanBook?.totalMonthlyPayment)}/mo`} variant="construction" colorScheme="brand" onClick={() => navigate('/reports/founder')} />
      </div>

      {/* Zone B — Split Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        {/* Left: Construction Financials */}
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-amber-700">Construction Financials</p>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Budget" value={fmt(d.totalBudget)} variant="construction" colorScheme="brand" />
              <StatCard label="Total Actuals" value={fmt(d.totalActuals)} helpText={`${budgetUtilPct}% spent`} variant="construction" colorScheme="orange" />
              <StatCard
                label="Budget Variance"
                value={fmt(d.budgetVariance)}
                helpText={`${variancePct}% remaining`}
                trend={d.budgetVariance >= 0 ? 'increase' : 'decrease'}
                colorScheme={d.budgetVariance >= 0 ? 'green' : 'red'}
                variant="construction"
              />
              <StatCard label="Total Loan Available" value={fmt(d.loanBook?.totalAvailable)} helpText="undrawn principal" variant="construction" colorScheme="purple" />
            </div>
          </CardBody>
        </Card>

        {/* Right: Sales & Marketing Financials */}
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-blue-700">Sales & Marketing Financials</p>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Closed Sales (All-Time)" value={fmt(d.closedSalesRevenue)} variant="revenue" colorScheme="green" />
              <StatCard label="Projected Unsold Value" value={fmt(d.projectedUnsoldValue)} helpText="available units" variant="revenue" colorScheme="brand" />
              <StatCard label="Under Contract Value" value={fmt(d.underContractValue)} variant="revenue" colorScheme="orange" />
              <StatCard label="Monthly Lease Income" value={fmt(d.totalMonthlyLeaseIncome)} helpText={`${fmt((d.totalMonthlyLeaseIncome ?? 0) * 12)}/yr`} variant="revenue" colorScheme="teal" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Zone C — Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-600">Projects by Phase</p>
          </CardHeader>
          <CardBody>
            {phaseData.length === 0 ? (
              <p className="text-sm text-gray-500 py-10 text-center">No data</p>
            ) : (
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
            )}
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-600">Units by Status</p>
          </CardHeader>
          <CardBody>
            {unitData.length === 0 ? (
              <p className="text-sm text-gray-500 py-10 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={unitData}>
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3182CE" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Zone D — Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        {/* Overdue Milestones */}
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <FiTrendingUp className="text-amber-600" />
              <p className="font-semibold text-sm text-gray-600">Overdue Milestones</p>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {overdueMilestones.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No overdue milestones</p>
            ) : (
              <div className="overflow-auto">
                <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Milestone</th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueMilestones.map((m: any) => (
                      <tr
                        key={m.id}
                        className="border-b border-gray-50 cursor-pointer hover:bg-amber-50"
                        onClick={() => navigate(`/projects/${m.projectId}/milestones`)}
                      >
                        <td className="py-2 px-2 font-medium text-amber-700">{m.title}</td>
                        <td className="py-2 px-2 text-xs text-gray-500">{m.projectName}</td>
                        <td className="py-2 px-2 text-xs text-red-700">{fmtDate(m.dueDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Slice 9: portfolio-wide exception feed (replaces single-source alerts) */}
        <PortfolioExceptions onItemClick={(item) => item.href && navigate(item.href)} />
      </div>
      {/* Zone E — Unsold Units Sales Value by Project / Building */}
      {(d.unsoldByProjectBuilding || []).length > 0 && (
        <Card shadow="sm" className="mb-6">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Unsold Units — Sales Value by Project &amp; Building</p>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="overflow-x-auto">
              <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Project / Building</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Available Units</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Available Value</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Under Contract</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Contract Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.unsoldByProjectBuilding as any[]).map((proj: any) => (
                    <Fragment key={proj.projectId}>
                      {/* Project row */}
                      <tr
                        className="bg-gray-50 cursor-pointer hover:bg-amber-50"
                        onClick={() => navigate(`/projects/${proj.projectId}/units`)}
                      >
                        <td className="py-2 px-3 font-semibold text-gray-800" colSpan={1}>
                          {proj.projectName}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-gray-700">
                          {proj.totalAvailableCount}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-green-700">
                          {fmt(proj.totalAvailableValue)}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-blue-700">
                          {proj.buildings.reduce((s: number, b: any) => s + b.underContractCount, 0)}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-blue-700">
                          {fmt(proj.totalUnderContractValue)}
                        </td>
                      </tr>
                      {/* Building rows */}
                      {(proj.buildings as any[]).map((b: any) => (
                        <tr key={b.buildingId} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-1.5 px-3 pl-8 text-gray-600 text-xs">{b.buildingName}</td>
                          <td className="py-1.5 px-3 text-right text-xs text-gray-600">{b.availableCount}</td>
                          <td className="py-1.5 px-3 text-right text-xs text-green-700">{fmt(b.availableValue)}</td>
                          <td className="py-1.5 px-3 text-right text-xs text-blue-600">{b.underContractCount}</td>
                          <td className="py-1.5 px-3 text-right text-xs text-blue-600">{fmt(b.underContractValue)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  {/* Portfolio total row */}
                  <tr className="border-t-2 border-gray-200 bg-gray-100 font-semibold">
                    <td className="py-2 px-3 text-gray-700">Portfolio Total</td>
                    <td className="py-2 px-3 text-right text-gray-700">
                      {(d.unsoldByProjectBuilding as any[]).reduce((s: number, p: any) => s + p.totalAvailableCount, 0)}
                    </td>
                    <td className="py-2 px-3 text-right text-green-700">{fmt(d.projectedUnsoldValue)}</td>
                    <td className="py-2 px-3 text-right text-blue-700">
                      {(d.unsoldByProjectBuilding as any[]).reduce((s: number, p: any) => s + p.buildings.reduce((b2: number, b: any) => b2 + b.underContractCount, 0), 0)}
                    </td>
                    <td className="py-2 px-3 text-right text-blue-700">{fmt(d.underContractValue)}</td>
                  </tr>
                </tbody>
              </table></div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Zone G — Recent Comments */}
      {(() => {
        const allComments = (commentsData as any[]) || [];
        const TYPE_ORDER = ['MARKETING', 'SALES', 'FINANCIAL'];
        const grouped: Record<string, any[]> = { MARKETING: [], SALES: [], FINANCIAL: [] };
        for (const c of allComments) {
          const t = c.commentType || 'MARKETING';
          if (grouped[t]) grouped[t].push(c);
        }
        const hasAny = TYPE_ORDER.some((t) => grouped[t].length > 0);
        return (
          <Card shadow="sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <FiMessageSquare className="text-purple-600" />
                <p className="font-semibold text-sm text-gray-600">Recent Comments</p>
              </div>
            </CardHeader>
            <CardBody className="pt-0">
              {!hasAny ? (
                <p className="text-sm text-gray-500 py-4 text-center">No recent comments</p>
              ) : (
                <div className="max-h-[400px] overflow-auto">
                  {TYPE_ORDER.filter((t) => grouped[t].length > 0).map((t) => (
                    <div key={t}>
                      <p className={`text-xs font-semibold uppercase mb-2 mt-3 first:mt-0 ${COMMENT_TYPE_HEADER[t]}`}>
                        {COMMENT_TYPE_LABELS[t]} ({grouped[t].length})
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
                                <CommentChip type={t as CommentType} size="sm" />
                                <span className="text-xs text-gray-500">{fmtDate(c.createdAt)}</span>
                              </div>
                              <p className="text-sm text-gray-700 break-words">{c.content}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {c.source === 'project'
                                  ? c.project?.name
                                  : `${c.unit?.building?.project?.name} · ${c.unit?.building?.name} · Unit ${c.unit?.unitNumber}`}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        );
      })()}
    </div>
  );
}

/** Wraps the ExceptionFeed component with the portfolio-scoped data fetch. */
function PortfolioExceptions({ onItemClick }: { onItemClick?: (item: any) => void }) {
  const { data: items = [] } = useExceptions();
  return (
    <ExceptionFeed
      items={items.map((i) => ({ ...i, severity: i.severity as 'critical' | 'warning' | 'info' }))}
      onItemClick={onItemClick}
      emptyText="No exceptions — portfolio is clear."
    />
  );
}
