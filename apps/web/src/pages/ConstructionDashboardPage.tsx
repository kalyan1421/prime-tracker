import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, CardHeader, CardBody, Progress, Chip, Button, Select, SelectItem, addToast,
} from '@heroui/react';
import {
  PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer,
} from 'recharts';
import { FiTrendingUp, FiArrowRight, FiChevronDown, FiChevronRight, FiEdit2 } from 'react-icons/fi';
import {
  useConstructionDashboard, useUnits, useConstructionRollup, useCustomOptions, useUpdateConstructionStage,
} from '../hooks/useApi';
import { useCollapsibleGroups } from '../hooks/useCollapsibleGroups';
import { fmt, fmtDate, errMsg } from '../utils/fmt';
import { StatCard, StatusBadge, LoadingState, ErrorState } from '../components/ui';
import { UnitConstructionChecklist } from '../components/UnitConstructionChecklist';
import { useAuthStore } from '../store/authStore';

interface OptionLike { value: string; label: string; color?: string | null }

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
          <p className="text-sm text-gray-500 py-4 text-center">No overdue milestones</p>
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

/** One unit's inline "advance to this status" control — a compact Select that PATCHes
 *  its next incomplete stage directly, no navigation. Omitted entirely once the
 *  checklist is complete (nothing left to advance). */
function InlineStageAdvance({
  unitId, nextStage, statusOptions, onAdvance, isPending,
}: {
  unitId: string;
  nextStage: { id: string; label: string; status: string };
  statusOptions: OptionLike[];
  onAdvance: (unitId: string, stageId: string, status: string) => void;
  isPending: boolean;
}) {
  return (
    <Select
      aria-label={`Update status for ${nextStage.label}`}
      size="sm"
      className="w-36 shrink-0"
      selectedKeys={[nextStage.status]}
      isLoading={isPending}
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0] as string;
        if (next && next !== nextStage.status) onAdvance(unitId, nextStage.id, next);
      }}
    >
      {statusOptions.map((o) => (
        <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
      ))}
    </Select>
  );
}

/**
 * "Update Unit Progress" — every unit with a checklist across every project the caller can
 * see, grouped by project, with the next stage updatable right here. Defaults to all
 * projects at once; the Project filter narrows to one (and, only then, also surfaces units
 * that haven't started a checklist yet).
 *
 * Each row expands in place into the full `UnitConstructionChecklist` — the same
 * add-stage/apply-template/edit-any-field component the unit page uses — so a
 * checklist can be started, built out, and fully edited without ever leaving the
 * dashboard. The inline status Select stays as the one-click fast path for the
 * common case (just advance the next stage); "Manage" is for anything more.
 */
function UpdateUnitProgressCard({
  projects, navigate, canEditChecklist,
}: {
  projects: { id: string; name: string }[];
  navigate: (path: string) => void;
  canEditChecklist: boolean;
}) {
  const [projectId, setProjectId] = useState('');
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);
  const rollupQ = useConstructionRollup(projectId || undefined);
  const unitsQ = useUnits(projectId || '');
  const { data: statusOptionsData } = useCustomOptions('construction_stage_status');
  const statusOptions = useMemo<OptionLike[]>(
    () => (Array.isArray(statusOptionsData) ? statusOptionsData : []),
    [statusOptionsData],
  );
  const updateStage = useUpdateConstructionStage();
  const { isExpanded, toggle } = useCollapsibleGroups();

  const rollupByUnit = useMemo(() => {
    const map = new Map<string, any>();
    (Array.isArray(rollupQ.data) ? rollupQ.data : []).forEach((r: any) => map.set(r.unit.id, r));
    return map;
  }, [rollupQ.data]);

  const handleAdvance = async (unitId: string, stageId: string, status: string) => {
    try {
      await updateStage.mutateAsync({ stageId, unitId, data: { status } });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update the stage'), color: 'danger' });
    }
  };

  const rows: any[] = Array.isArray(rollupQ.data) ? rollupQ.data : [];
  const byProject = useMemo(() => {
    const map = new Map<string, { id: string; name: string; units: any[] }>();
    for (const r of rows) {
      const p = r.unit.building?.project;
      const key = p?.id ?? projectId ?? 'unassigned';
      const name = p?.name ?? projects.find((pr) => pr.id === projectId)?.name ?? 'Project';
      if (!map.has(key)) map.set(key, { id: key, name, units: [] });
      map.get(key)!.units.push(r);
    }
    const list = Array.from(map.values());
    list.forEach((p) => p.units.sort((a, b) =>
      (a.unit.unitNumber ?? '').localeCompare(b.unit.unitNumber ?? '', undefined, { numeric: true })));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [rows, projectId, projects]);

  // Only meaningful once a single project is picked — units with no checklist at all
  // never appear in the rollup, so this is the one place "Start" still makes sense.
  const notStartedUnits: any[] = useMemo(() => {
    if (!projectId) return [];
    const units: any[] = Array.isArray(unitsQ.data) ? unitsQ.data : [];
    return units.filter((u: any) => !rollupByUnit.has(u.id));
  }, [projectId, unitsQ.data, rollupByUnit]);

  const isEmpty = byProject.length === 0 && notStartedUnits.length === 0;

  return (
    <Card shadow="sm" className="mb-6">
      <CardHeader className="pb-2">
        <p className="font-semibold text-sm text-gray-600">Update Unit Progress</p>
      </CardHeader>
      <CardBody className="pt-0">
        <Select
          size="sm"
          label="Project"
          placeholder="All Projects"
          className="max-w-xs mb-4"
          selectedKeys={projectId ? [projectId] : []}
          onSelectionChange={(keys) => setProjectId((Array.from(keys)[0] as string) || '')}
        >
          {projects.map((p) => (
            <SelectItem key={p.id} textValue={p.name}>{p.name}</SelectItem>
          ))}
        </Select>

        {rollupQ.isLoading && <LoadingState message="Loading checklists..." />}
        {!rollupQ.isLoading && isEmpty && (
          <p className="text-sm text-gray-500 py-4 text-center">No unit checklists yet</p>
        )}
        {!rollupQ.isLoading && !isEmpty && (
          <div className="max-h-[420px] overflow-y-auto space-y-3 pr-1">
            {byProject.map((p) => {
              const hasIncomplete = p.units.some((r: any) => r.nextStage);
              const expanded = isExpanded(p.id, hasIncomplete || p.units.length <= 5);
              return (
                <div key={p.id}>
                  {!projectId && (
                    <button
                      type="button"
                      onClick={() => toggle(p.id, expanded)}
                      className="w-full flex items-center gap-1.5 py-1 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
                    >
                      {expanded ? <FiChevronDown className="shrink-0" /> : <FiChevronRight className="shrink-0" />}
                      {p.name}
                      <span className="font-normal text-gray-500 normal-case">· {p.units.length} unit{p.units.length === 1 ? '' : 's'}</span>
                    </button>
                  )}
                  {(projectId || expanded) && (
                    <div className="space-y-1.5">
                      {p.units.map((r: any) => {
                        const pct = r.totalStages > 0 ? Math.round((r.doneStages / r.totalStages) * 100) : 0;
                        const pending = updateStage.isPending
                          && updateStage.variables?.stageId === r.nextStage?.id;
                        const unitExpanded = expandedUnitId === r.unit.id;
                        return (
                          <div key={r.unit.id} className="rounded-lg border border-gray-100 overflow-hidden">
                            <div className="flex items-center justify-between gap-3 px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-gray-800 truncate">
                                  Unit {r.unit.unitNumber}
                                  <span className="text-xs text-gray-500 font-normal"> · {r.unit.building?.name}</span>
                                </div>
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-16 shrink-0">
                                    <Progress size="sm" value={pct} color={pct === 100 ? 'success' : 'primary'} />
                                  </div>
                                  <span className="text-xs text-gray-500 truncate">
                                    {r.nextStage ? r.nextStage.label : 'Checklist complete'}
                                  </span>
                                </div>
                              </div>
                              {r.nextStage && (
                                <InlineStageAdvance
                                  unitId={r.unit.id}
                                  nextStage={r.nextStage}
                                  statusOptions={statusOptions}
                                  onAdvance={handleAdvance}
                                  isPending={pending}
                                />
                              )}
                              <Button
                                size="sm"
                                variant={unitExpanded ? 'flat' : 'light'}
                                color={unitExpanded ? 'primary' : 'default'}
                                startContent={<FiEdit2 size={12} />}
                                onPress={() => setExpandedUnitId(unitExpanded ? null : r.unit.id)}
                              >
                                Manage
                              </Button>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                aria-label="Open unit page"
                                onPress={() => navigate(`/projects/${p.id}/units/${r.unit.id}#construction-checklist`)}
                              >
                                <FiArrowRight />
                              </Button>
                            </div>
                            {unitExpanded && (
                              <div className="border-t border-gray-100 bg-gray-50/50 px-3 py-3">
                                <UnitConstructionChecklist
                                  unitId={r.unit.id}
                                  buildingId={r.unit.building?.id}
                                  canEdit={canEditChecklist}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {notStartedUnits.map((u: any) => {
              const unitExpanded = expandedUnitId === u.id;
              return (
                <div key={u.id} className="rounded-lg border border-gray-100 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedUnitId(unitExpanded ? null : u.id)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        Unit {u.unitNumber}
                        <span className="text-xs text-gray-500 font-normal"> · {u.building?.name}</span>
                      </div>
                      <div className="text-xs text-gray-500 truncate">No checklist started</div>
                    </div>
                    <Chip
                      size="sm"
                      variant="flat"
                      color={unitExpanded ? 'primary' : 'default'}
                      className="shrink-0 text-xs"
                      endContent={unitExpanded ? <FiChevronDown /> : <FiArrowRight />}
                    >
                      Start
                    </Chip>
                  </button>
                  {unitExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50/50 px-3 py-3">
                      <UnitConstructionChecklist
                        unitId={u.id}
                        buildingId={u.building?.id}
                        canEdit={canEditChecklist}
                      />
                    </div>
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

export default function ConstructionDashboardPage() {
  const { user, hasPermission } = useAuthStore();
  const navigate = useNavigate();
  const { data, isLoading, error } = useConstructionDashboard();
  const role = user?.role || '';
  // Construction is blind to financials (no budget:view); the API omits the figures too.
  const canViewFinancials = hasPermission('budget:view');
  const canViewChecklist = hasPermission('checklist:view');
  const canEditChecklist = hasPermission('checklist:edit');

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
        {canViewFinancials && (
          <StatCard label="Budget Spent" value={`${budgetPct}%`} helpText="across all active projects" variant="construction" colorScheme="brand" onClick={() => navigate('/reports/construction')} />
        )}
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
        <UpdateUnitProgressCard projects={d.projectSummaries || []} navigate={navigate} canEditChecklist={canEditChecklist} />
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
                      <span className={p.milestoneCounts.overdue > 0 ? 'text-red-700 font-semibold' : 'text-gray-500'}>
                        {p.milestoneCounts.overdue}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-blue-600">{p.milestoneCounts.inProgress}</td>
                    <td className="py-2 px-2 text-center text-green-700">{p.milestoneCounts.completed}</td>
                  </tr>
                ))}
                {(d.projectSummaries || []).length === 0 && (
                  <tr><td colSpan={6} className="text-center py-6 text-gray-500">No active projects</td></tr>
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
              <p className="text-sm text-gray-500 text-center py-2">No pending draw requests</p>
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
              <p className="text-sm text-gray-500 py-10 text-center">No data</p>
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
              <p className="text-sm text-gray-500 py-4 text-center">No recent activity</p>
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
