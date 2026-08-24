import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardBody, Progress } from '@heroui/react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { FiAlertTriangle, FiDollarSign } from 'react-icons/fi';
import { useFinanceDashboard } from '../hooks/useApi';
import { fmt, fmtDate } from '../utils/fmt';
import { StatCard, StatusBadge, LoadingState, ErrorState } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import ReceivablesWidget from '../components/ReceivablesWidget';

const FINANCE_ROLES = ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP'];

export default function FinanceDashboardPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { data, isLoading, error } = useFinanceDashboard();

  useEffect(() => {
    if (!user?.role) return;
    if (!FINANCE_ROLES.includes(user.role)) {
      if (['PROJECT_MANAGER', 'CONSTRUCTION'].includes(user.role)) navigate('/dashboard/construction', { replace: true });
      else if (['SALES', 'MARKETING'].includes(user.role)) navigate('/dashboard/sales', { replace: true });
      else navigate('/', { replace: true });
    }
  }, [user?.role, navigate]);

  if (isLoading) return <LoadingState message="Loading finance dashboard..." />;
  if (error) return <ErrorState />;
  if (!data) return null;

  const d = data as any;
  const budgetUtilPct = d.budgetUtilPct?.toFixed(1) ?? '0';
  const variancePct = d.totalBudget > 0
    ? (((d.totalBudget - d.totalActuals) / d.totalBudget) * 100).toFixed(1)
    : '0';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Finance Dashboard</h1>

      {/* Zone A — Portfolio Financial Health */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Budget"
          value={fmt(d.totalBudget)}
          helpText="across all projects"
          variant="construction"
          colorScheme="brand"
          onClick={() => navigate('/reports')}
        />
        <StatCard
          label="Total Actuals"
          value={fmt(d.totalActuals)}
          helpText={`${budgetUtilPct}% of budget`}
          variant="construction"
          colorScheme="orange"
          onClick={() => navigate('/reports')}
        />
        <StatCard
          label="Budget Variance"
          value={fmt(d.budgetVariance)}
          helpText={`${variancePct}% remaining`}
          trend={d.budgetVariance >= 0 ? 'increase' : 'decrease'}
          colorScheme={d.budgetVariance >= 0 ? 'green' : 'red'}
          variant="construction"
          onClick={() => navigate('/reports')}
        />
        <StatCard
          label="Total Loan Book"
          value={fmt(d.totalLoanPrincipal)}
          helpText={`${fmt(d.totalMonthlyPayment)}/mo service`}
          variant="construction"
          colorScheme="purple"
          onClick={() => navigate('/cashflow')}
        />
      </div>

      {/* Zone B — Draw Requests + Loan Maturity Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <FiDollarSign className="text-orange-500" />
              <p className="font-semibold text-sm text-gray-600">Pending Draw Requests</p>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Pending Count"
                value={String(d.totalPendingDraws ?? 0)}
                helpText={d.totalPendingDraws > 0 ? 'Awaiting approval' : 'All clear'}
                variant="construction"
                colorScheme={d.totalPendingDraws > 0 ? 'orange' : 'green'}
              />
              <StatCard
                label="Pending Amount"
                value={fmt(d.totalPendingDrawAmt ?? 0)}
                variant="construction"
                colorScheme="orange"
              />
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <FiAlertTriangle className="text-red-500" />
              <p className="font-semibold text-sm text-gray-600">Loans Maturing in 90 Days</p>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {(d.loansNearMaturity || []).length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No loans maturing soon</p>
            ) : (
              <div className="space-y-2 max-h-[120px] overflow-auto">
                {(d.loansNearMaturity as any[]).map((loan: any) => (
                  <div
                    key={loan.id}
                    className="flex items-center justify-between p-2 rounded-md bg-red-50 cursor-pointer hover:bg-red-100"
                    onClick={() => navigate(`/projects/${loan.projectId}/financials`)}
                  >
                    <div>
                      <p className="text-sm font-medium text-red-800">{loan.lender}</p>
                      <p className="text-xs text-red-700">{loan.projectName} · {loan.daysToMaturity}d left</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-red-700">{fmt(loan.principal)}</p>
                      <p className="text-xs text-red-700">{fmtDate(loan.maturityDate)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Zone C — Budget vs Actuals by Category */}
      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Budget vs Actuals by Category</p>
        </CardHeader>
        <CardBody>
          {(d.budgetCategoryChart || []).length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.budgetCategoryChart} margin={{ left: 10 }}>
                <XAxis dataKey="category" fontSize={10} />
                <YAxis tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} fontSize={10} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend />
                <Bar dataKey="budget" name="Budget" fill="#3182CE" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actuals" name="Actuals" fill="#DD6B20" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

      {/* Zone D — Upcoming Receivables */}
      <div className="grid grid-cols-1 mb-6">
        <ReceivablesWidget />
      </div>

      {/* Zone E — Project Budget Variance Table */}
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-600">Budget Variance by Project</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Phase</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Budget</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Actuals</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Variance</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase min-w-[120px]">Spent</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Draws</th>
                </tr>
              </thead>
              <tbody>
                {(d.projectSummaries as any[] || []).map((p: any) => (
                  <tr
                    key={p.id}
                    className="border-b border-gray-50 cursor-pointer hover:bg-gray-50"
                    onClick={() => navigate(`/projects/${p.id}/financials`)}
                  >
                    <td className="py-2.5 px-3 font-medium">{p.name}</td>
                    <td className="py-2.5 px-3"><StatusBadge status={p.phase} /></td>
                    <td className="py-2.5 px-3 text-right text-gray-700">{fmt(p.budget)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-700">{fmt(p.actuals)}</td>
                    <td className={`py-2.5 px-3 text-right font-semibold ${p.variance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {p.variance >= 0 ? '+' : ''}{fmt(p.variance)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">{(p.budgetSpentPct * 100).toFixed(0)}%</div>
                        <Progress
                          value={p.budgetSpentPct * 100}
                          size="sm"
                          color={p.budgetSpentPct > 1 ? 'danger' : p.budgetSpentPct > 0.9 ? 'warning' : 'primary'}
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {p.pendingDraws > 0 ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">
                          {p.pendingDraws} pending
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {(d.projectSummaries || []).length === 0 && (
                  <tr><td colSpan={7} className="text-center py-6 text-gray-500">No projects</td></tr>
                )}
              </tbody>
            </table></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
