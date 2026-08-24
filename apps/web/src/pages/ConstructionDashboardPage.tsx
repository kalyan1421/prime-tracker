import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardBody, Progress, Chip, Button, Select, SelectItem } from '@heroui/react';
import {
  PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer,
} from 'recharts';
import { FiTrendingUp, FiArrowRight } from 'react-icons/fi';
import { useConstructionDashboard, useUnits, useConstructionRollup } from '../hooks/useApi';
import { fmt, fmtDate } from '../utils/fmt';
import { StatCard, StatusBadge, LoadingState, ErrorState } from '../components/ui';
import { useAuthStore } from '../store/authStore';

const PHASE_COLORS: Record<string, string> = {
  PRE_DEVELOPMENT: '#805AD5', PERMITTING: '#DD6B20', CONSTRUCTION: '#3182CE',
  LEASE_UP: '#319795', STABILIZED: '#38A169', SOLD_REFI: '#00B5D8',
};

const OVERDUE_LIMIT = 5;

function overdueLabel(dueDate: string | null): string {
  if (!dueDate) return 'Overdue';
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000);
  if (days <= 0) return 'Due today';
  if (days === 1) return '1 day late';
  if (days < 7) return `${days} days late`;
  if (days < 30) return `${Math.floor(days / 7)}w late`;
  return `${Math.floor(days / 30)}mo late`;
}

function OverdueMilestonesCard({ milestones, navigate }: { milestones: any[]; navigate: (path: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? milestones : milestones.slice(0, OVERDUE_LIMIT);
  const hasMore = milestones.length > OVERDUE_LIMIT;

  return (
    <Card shadow="sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <FiTrendingUp className="text-amber-600" />
            <p className="font-semibold text-sm text-gray-600">Overdue Milestones</p>
          </div>
          {milestones.length > 0 && (
            <Chip size="sm" color="danger" variant="flat">{milestones.length}</Chip>
          )}
        </div>
      </CardHeader>
      <CardBody className="pt-0">
        {milestones.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No overdue milestones</p>
        ) : (
          <>
            <div className="overflow-auto">
              <div className="responsive-table-wrap">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Milestone</th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Needs Attention</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((m: any) => (
                      <tr
                        key={m.id}
                        className="border-b border-gray-50 cursor-pointer hover:bg-amber-50"
                        onClick={() => navigate(`/projects/${m.projectId}/milestones`)}
                      >
                        <td className="py-2 px-2 font-medium text-amber-700 max-w-[180px] truncate">{m.title}</td>
                        <td className="py-2 px-2 text-xs text-gray-500">{m.projectName}</td>
                        <td className="py-2 px-2">
                          <Chip size="sm" color="danger" variant="flat" className="text-xs">
                            {overdueLabel(m.dueDate)}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {hasMore && (
              <div className="mt-3 flex justify-center">
                <Button
                  size="sm"
                  variant="light"
                  color="warning"
                  onPress={() => setShowAll((v) => !v)}
                >
                  {showAll ? 'Show less' : `See all ${milestones.length} overdue milestones`}
                </Button>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * "Update Unit Progress" — the fast path from dashboard to a specific unit's checklist.
 * Project → unit → deep-link into Unit Detail's Construction Checklist section, instead of
 * Projects → project → Units tab → unit detail. See CONSTRUCTION_DASHBOARD_AND_VISUAL_ROLLUP_SPEC.md.
 */
function UpdateUnitProgressCard({
  projects, navigate,
}: {
  projects: { id: string; name: string }[];
  navigate: (path: string) => void;
}) {
  const [projectId, setProjectId] = useState('');
  const unitsQ = useUnits(projectId);
  const rollupQ = useConstructionRollup(projectId || undefined);

  const rollupByUnit = useMemo(() => {
    const map = new Map<string, any>();
    (Array.isArray(rollupQ.data) ? rollupQ.data : []).forEach((r: any) => map.set(r.unit.id, r));
    return map;
  }, [rollupQ.data]);

  const units: any[] = Array.isArray(unitsQ.data) ? unitsQ.data : [];

  return (
    <Card shadow="sm" className="mb-6">
      <CardHeader className="pb-2">
        <p className="font-semibold text-sm text-gray-600">Update Unit Progress</p>
      </CardHeader>
      <CardBody className="pt-0">
        <Select
          size="sm"
          label="Project"
          placeholder="Choose a project"
          className="max-w-xs mb-4"
          selectedKeys={projectId ? [projectId] : []}
          onSelectionChange={(keys) => setProjectId((Array.from(keys)[0] as string) || '')}
        >
          {projects.map((p) => (
            <SelectItem key={p.id} textValue={p.name}>{p.name}</SelectItem>
          ))}
        </Select>

        {!projectId && (
          <p className="text-sm text-gray-400 py-4 text-center">Pick a project to see its units</p>
        )}
        {projectId && unitsQ.isLoading && <LoadingState message="Loading units..." />}
        {projectId && !unitsQ.isLoading && units.length === 0 && (
          <p className="text-sm text-gray-400 py-4 text-center">No units in this project</p>
        )}
        {projectId && units.length > 0 && (
          <div className="max-h-[360px] overflow-y-auto space-y-1.5 pr-1">
            {units.map((u: any) => {
              const r = rollupByUnit.get(u.id);
              const pct = r && r.totalStages > 0 ? Math.round((r.doneStages / r.totalStages) * 100) : null;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => navigate(`/projects/${projectId}/units/${u.id}#construction-checklist`)}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 text-left hover:border-gray-200 hover:bg-gray-50/60 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">
                      Unit {u.unitNumber}
                      <span className="text-xs text-gray-400 font-normal"> · {u.building?.name}</span>
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {r ? (r.nextStage ? `Next: ${r.nextStage.label}` : 'Checklist complete') : 'No checklist started'}
                    </div>
                  </div>
                  {pct != null ? (
                    <div className="w-20 shrink-0">
                      <Progress size="sm" value={pct} color={pct === 100 ? 'success' : 'primary'} />
                    </div>
                  ) : (
                    <Chip size="sm" variant="flat" className="shrink-0 text-xs" endContent={<FiArrowRight />}>
                      Start
                    </Chip>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function ConstructionDashboardPage() {
  const { user, hasPermission } = useAuthStore();
  const navigate = useNavigate();
  const { data, isLoading, error } = useConstructionDashboard();
  const role = user?.role || '';
  // Construction is blind to financials (no budget:view); the API omits the figures too.
  const canViewFinancials = hasPermission('budget:view');
  const canViewChecklist = hasPermission('checklist:view');

  useEffect(() => {
    if (!user?.role) return;
    if (!['PROJECT_MANAGER', 'CONSTRUCTION'].includes(user.role)) {
      if (['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'].includes(user.role)) navigate('/dashboard/founder', { replace: true });
      else if (['SALES', 'MARKETING'].includes(user.role)) navigate('/dashboard/sales', { replace: true });
      else navigate('/', { replace: true });
    }
  }, [user?.role, navigate]);

  if (isLoading) return <LoadingState message="Loading construction dashboard..." />;
  if (error) return <ErrorState />;
  if (!data) return null;

  const d = data as any;
  const isPM = role === 'PROJECT_MANAGER';
  const budgetPct = Math.round((d.budgetSpentPct || 0) * 100);
  const budgetVariancePct = d.totalBudget > 0
    ? Math.abs(((d.totalBudget - d.totalActuals) / d.totalBudget) * 100).toFixed(1)
    : '0';

  const phaseData = (d.projectSummaries || []).reduce((acc: Record<string, number>, p: any) => {
    acc[p.phase] = (acc[p.phase] || 0) + 1;
    return acc;
  }, {});
  const phaseChartData = Object.entries(phaseData).map(([name, value]) => ({
    name: name.replace(/_/g, ' '),
    value: value as number,
    color: PHASE_COLORS[name] || '#A0AEC0',
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">
        {isPM ? 'Project Manager Dashboard' : 'Construction Dashboard'}
      </h1>

      {/* Zone A — Summary Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Projects" value={String(d.activeProjectCount)} variant="construction" colorScheme="brand" onClick={() => navigate('/projects')} />
        <StatCard
          label="Overdue Milestones"
          value={String(d.overdueMilestoneCount)}
          helpText={d.overdueMilestoneCount > 0 ? 'Action required' : 'All on track'}
          variant="construction"
          colorScheme={d.overdueMilestoneCount > 0 ? 'red' : 'green'}
          onClick={() => navigate('/reports/construction')}
        />
        <StatCard label="In-Progress Milestones" value={String(d.inProgressMilestoneCount)} variant="construction" colorScheme="orange" onClick={() => navigate('/reports/construction')} />
        <StatCard label="Budget Spent" value={`${budgetPct}%`} helpText="across all active projects" variant="construction" colorScheme="brand" onClick={() => navigate('/reports/construction')} />
      </div>

      {/* Zone A2 — Financial Overview (budget:view roles only — PM + leadership, not Construction) */}
      {canViewFinancials && (
      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-amber-700">Construction Financials</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total Budget Allocated"
              value={fmt(d.totalBudget)}
              helpText="across active projects"
              variant="construction"
              colorScheme="brand"
            />
            <StatCard
              label="Total Actual Spent"
              value={fmt(d.totalActuals)}
              helpText={`${budgetPct}% of budget`}
              variant="construction"
              colorScheme="orange"
            />
            <StatCard
              label="Budget Variance"
              value={fmt(d.budgetVariance)}
              helpText={`${budgetVariancePct}% ${d.budgetVariance >= 0 ? 'remaining' : 'over'}`}
              trend={d.budgetVariance >= 0 ? 'increase' : 'decrease'}
              colorScheme={d.budgetVariance >= 0 ? 'green' : 'red'}
              variant="construction"
            />
            <StatCard
              label="Total Loan Available"
              value={fmt(d.totalLoanAvailable)}
              helpText="total principal committed"
              variant="construction"
              colorScheme="purple"
            />
          </div>
        </CardBody>
      </Card>
      )}

      {/* Zone A3 — Update Unit Progress (checklist:view roles — CONSTRUCTION + PM) */}
      {canViewChecklist && (
        <UpdateUnitProgressCard projects={d.projectSummaries || []} navigate={navigate} />
      )}

      {/* Zone B — Project Status Board */}
      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-600">Project Status Board</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Phase</th>
                  {canViewFinancials && <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase min-w-[140px]">Budget Spent</th>}
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Overdue</th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">In-Progress</th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Done</th>
                </tr>
              </thead>
              <tbody>
                {(d.projectSummaries || []).map((p: any) => (
                  <tr
                    key={p.id}
                    className="border-b border-gray-50 cursor-pointer hover:bg-gray-50"
                    onClick={() => navigate(`/projects/${p.id}`)}
                  >
                    <td className="py-2 px-2 font-medium">{p.name}</td>
                    <td className="py-2 px-2"><StatusBadge status={p.phase} /></td>
                    {canViewFinancials && (
                    <td className="py-2 px-2">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">
                          {p.rawBudget
                            ? `${fmt(p.rawBudget.actuals)} / ${fmt(p.rawBudget.budget)}`
                            : `${Math.round((p.budgetSpentPct || 0) * 100)}%`}
                        </div>
                        <Progress
                          value={(p.budgetSpentPct || 0) * 100}
                          size="sm"
                          color={p.budgetSpentPct > 1 ? 'danger' : p.budgetSpentPct > 0.9 ? 'warning' : 'primary'}
                        />
                      </div>
                    </td>
                    )}
                    <td className="py-2 px-2 text-center">
                      <span className={p.milestoneCounts.overdue > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>
                        {p.milestoneCounts.overdue}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-blue-600">{p.milestoneCounts.inProgress}</td>
                    <td className="py-2 px-2 text-center text-green-600">{p.milestoneCounts.completed}</td>
                  </tr>
                ))}
                {(d.projectSummaries || []).length === 0 && (
                  <tr><td colSpan={6} className="text-center py-6 text-gray-400">No active projects</td></tr>
                )}
              </tbody>
            </table></div>
          </div>
        </CardBody>
      </Card>

      {/* Zone C — Action Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        {/* Overdue Milestones */}
        <OverdueMilestonesCard milestones={(d.recentMilestones || []).filter((m: any) => m.status === 'OVERDUE')} navigate={navigate} />

        {/* Draw Requests */}
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Draw Requests</p>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <StatCard
                label="Pending"
                value={String(d.drawRequestStats?.pendingCount ?? 0)}
                helpText={isPM && d.drawRequestStats?.totalPendingAmt != null ? fmt(d.drawRequestStats.totalPendingAmt) : undefined}
                variant="construction"
                colorScheme="orange"
              />
              <StatCard
                label="Approved"
                value={String(d.drawRequestStats?.approvedCount ?? 0)}
                variant="construction"
                colorScheme="green"
              />
            </div>
            {d.drawRequestStats?.pendingCount === 0 && (
              <p className="text-sm text-gray-400 text-center py-2">No pending draw requests</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Zone D — Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-600">Projects by Phase</p>
          </CardHeader>
          <CardBody>
            {phaseChartData.length === 0 ? (
              <p className="text-sm text-gray-400 py-10 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={phaseChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {phaseChartData.map((entry, i) => (
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

        {/* Zone E — Activity Feed */}
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Recent Milestone Activity</p>
          </CardHeader>
          <CardBody className="pt-0">
            {(d.recentMilestones || []).length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No recent activity</p>
            ) : (
              <div className="overflow-auto max-h-[200px]">
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
                    {(d.recentMilestones as any[]).map((m: any) => (
                      <tr
                        key={m.id}
                        className="border-b border-gray-50 cursor-pointer hover:bg-gray-50"
                        onClick={() => navigate(`/projects/${m.projectId}/milestones`)}
                      >
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
      </div>
    </div>
  );
}
