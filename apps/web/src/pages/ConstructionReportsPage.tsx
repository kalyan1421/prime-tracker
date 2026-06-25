import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { Card, CardHeader, CardBody, Tabs, Tab, Button } from '@heroui/react';
import { FiDownload } from 'react-icons/fi';
import { useQueries } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../lib/api';
import { usePortfolioReport, useProjects } from '../hooks/useApi';
import { fmt, fmtDate } from '../utils/fmt';
import { StatCard, StatusBadge, LoadingState, ErrorState } from '../components/ui';
import { useAuthStore } from '../store/authStore';

function BudgetCostTab() {
  const { data, isLoading, error } = usePortfolioReport();
  if (isLoading) return <LoadingState message="Loading budget data..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Budget" value={fmt(d.kpis.totalInvestment)} colorScheme="brand" variant="construction" />
        <StatCard label="Total Actuals" value={fmt(d.kpis.totalActuals ?? 0)} colorScheme="orange" variant="construction" />
        <StatCard
          label="Budget Variance"
          value={fmt((d.kpis.totalInvestment ?? 0) - (d.kpis.totalActuals ?? 0))}
          colorScheme={((d.kpis.totalInvestment ?? 0) - (d.kpis.totalActuals ?? 0)) >= 0 ? 'green' : 'red'}
          variant="construction"
        />
        <StatCard label="Active Projects" value={String((d.projectComparison || []).length)} colorScheme="gray" variant="neutral" />
      </div>

      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Budget vs Actuals</p>
        </CardHeader>
        <CardBody>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.chartData || []}>
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => `$${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="budget" fill="#3182CE" name="Budget" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actuals" fill="#DD6B20" name="Actuals" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardBody>
      </Card>

      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-600">Project Budget Summary</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Phase</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Budget</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Actuals</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Variance</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Variance %</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {(d.projectComparison as any[]).map((p: any) => {
                  const variancePct = p.budget > 0 ? ((p.variance / p.budget) * 100).toFixed(1) : '0';
                  return (
                    <tr key={p.projectId} className="border-b border-gray-50">
                      <td className="py-2 px-2 font-medium">{p.projectName}</td>
                      <td className="py-2 px-2"><StatusBadge status={p.phase} /></td>
                      <td className="py-2 px-2 text-right">{fmt(p.budget)}</td>
                      <td className="py-2 px-2 text-right">{fmt(p.actuals)}</td>
                      <td className={`py-2 px-2 text-right ${p.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmt(p.variance)}
                      </td>
                      <td className={`py-2 px-2 text-right ${Number(variancePct) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {variancePct}%
                      </td>
                      <td className="py-2 px-2"><StatusBadge status={p.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function MilestoneScheduleTab() {
  const { data: projectsData, isLoading: projLoading, error: projError } = useProjects({ status: 'ACTIVE' });
  const projects = (projectsData as any[]) || [];

  const milestoneQueries = useQueries({
    queries: projects.map((p: any) => ({
      queryKey: ['milestones', p.id],
      queryFn: () => api.get('/milestones', { params: { projectId: p.id } }).then((r) => r.data),
      enabled: projects.length > 0,
    })),
  });

  if (projLoading || milestoneQueries.some((q) => q.isLoading)) {
    return <LoadingState message="Loading milestones..." />;
  }
  if (projError) return <ErrorState />;

  const projectMilestones = projects.map((p: any, idx: number) => ({
    project: p,
    milestones: (milestoneQueries[idx]?.data as any[]) || [],
  }));

  return (
    <div>
      {projectMilestones.map(({ project, milestones }) => (
        <Card key={project.id} shadow="sm" className="mb-6">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <p className="font-semibold text-sm text-gray-700">{project.name}</p>
              <StatusBadge status={project.phase} />
              <span className="text-xs text-gray-400">{milestones.length} milestones</span>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {milestones.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">No milestones</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Milestone</th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Due</th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.map((m: any) => (
                      <tr key={m.id} className="border-b border-gray-50">
                        <td className="py-2 px-2">{m.title}</td>
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
      ))}
      {projectMilestones.length === 0 && (
        <p className="text-center text-gray-400 py-10">No active projects found</p>
      )}
    </div>
  );
}

function DrawRequestsTab() {
  const { data: projectsData, isLoading: projLoading, error: projError } = useProjects({ status: 'ACTIVE' });
  const projects = (projectsData as any[]) || [];

  const loanQueries = useQueries({
    queries: projects.map((p: any) => ({
      queryKey: ['loans', p.id],
      queryFn: () => api.get('/loans', { params: { projectId: p.id } }).then((r) => r.data),
      enabled: projects.length > 0,
    })),
  });

  if (projLoading || loanQueries.some((q) => q.isLoading)) {
    return <LoadingState message="Loading draw requests..." />;
  }
  if (projError) return <ErrorState />;

  const projectLoans = projects.map((p: any, idx: number) => ({
    project: p,
    loans: (loanQueries[idx]?.data as any[]) || [],
  }));

  const hasAny = projectLoans.some((pl) => pl.loans.length > 0);

  return (
    <div>
      {!hasAny && <p className="text-center text-gray-400 py-10">No loans found for active projects</p>}
      {projectLoans.filter((pl) => pl.loans.length > 0).map(({ project, loans }) => (
        <Card key={project.id} shadow="sm" className="mb-6">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <p className="font-semibold text-sm text-gray-700">{project.name}</p>
              <StatusBadge status={project.phase} />
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {loans.map((loan: any) => (
              <div key={loan.id} className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <StatusBadge status={loan.loanType} />
                  <span className="text-sm font-medium">{loan.lender}</span>
                  <span className="text-xs text-gray-500">— {fmt(loan.principalAmt)} @ {loan.interestRate}%</span>
                </div>
                {(loan.drawRequests || []).length === 0 ? (
                  <p className="text-xs text-gray-400 ml-4">No draw requests</p>
                ) : (
                  <div className="overflow-x-auto ml-4">
                    <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-1 px-2 text-xs font-semibold text-gray-400 uppercase">Amount</th>
                          <th className="text-left py-1 px-2 text-xs font-semibold text-gray-400 uppercase">Purpose</th>
                          <th className="text-left py-1 px-2 text-xs font-semibold text-gray-400 uppercase">Requested</th>
                          <th className="text-left py-1 px-2 text-xs font-semibold text-gray-400 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(loan.drawRequests as any[]).map((dr: any) => (
                          <tr key={dr.id} className="border-b border-gray-50">
                            <td className="py-1 px-2">{fmt(dr.amount)}</td>
                            <td className="py-1 px-2 text-xs text-gray-500">{dr.notes || '—'}</td>
                            <td className="py-1 px-2 text-xs">{fmtDate(dr.requestDate)}</td>
                            <td className="py-1 px-2"><StatusBadge status={dr.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  </div>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export default function ConstructionReportsPage() {
  const { user, hasPermission } = useAuthStore();
  const canViewFinancials = hasPermission('financial:view');
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: 'Prime Tracker — Construction Reports' });

  useEffect(() => {
    if (!user?.role) return;
    if (!['PROJECT_MANAGER', 'CONSTRUCTION'].includes(user.role)) {
      if (['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'].includes(user.role)) navigate('/reports/founder', { replace: true });
      else if (['SALES', 'MARKETING'].includes(user.role)) navigate('/reports/sales', { replace: true });
      else navigate('/reports', { replace: true });
    }
  }, [user?.role, navigate]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <h1 className="text-2xl font-bold">Construction Reports</h1>
        <Button size="sm" variant="bordered" startContent={<FiDownload />} onPress={() => handlePrint()}>
          Download PDF
        </Button>
      </div>
      <div ref={printRef}>
        <Tabs color="primary" variant="underlined" classNames={{ tabList: "overflow-x-auto scrollbar-none flex-nowrap" }}>
          {/* Budget & Cost is a financial report — hidden from roles without financial:view
              (Construction, and PM who keeps budget but not the financial module). */}
          {canViewFinancials && (
            <Tab key="budget" title="Budget & Cost">
              <BudgetCostTab />
            </Tab>
          )}
          <Tab key="milestones" title="Milestone & Schedule">
            <MilestoneScheduleTab />
          </Tab>
          <Tab key="draws" title="Draw Requests">
            <DrawRequestsTab />
          </Tab>
        </Tabs>
      </div>
    </div>
  );
}
