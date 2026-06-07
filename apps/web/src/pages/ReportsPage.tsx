import { useRef, useState } from 'react';
import { Button, Card, CardHeader, CardBody, Tabs, Tab, Select, SelectItem } from '@heroui/react';
import { useReactToPrint } from 'react-to-print';
import { FiDownload } from 'react-icons/fi';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { usePortfolioReport, useSalesReport, useRevenueReport, useDebtReport, useProjects } from '../hooks/useApi';
import { StatCard, StatusBadge, LoadingState, ErrorState, fmt, fmtDate } from '../components/ui';
import { useAuthStore } from '../store/authStore';

// ---- Executive Summary Tab ----
function PortfolioTab({ filterProject }: { filterProject?: string }) {
  const { data, isLoading, error } = usePortfolioReport();
  if (isLoading) return <LoadingState message="Loading portfolio report..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;
  const chartData = filterProject ? (d.chartData ?? []).filter((c: any) => c.name === filterProject) : d.chartData;
  const projectComparison = filterProject ? (d.projectComparison ?? []).filter((p: any) => p.projectName === filterProject) : d.projectComparison;

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Investment" value={fmt(d.kpis.totalInvestment)} colorScheme="brand" variant="construction" />
        <StatCard label="Total Revenue" value={fmt(d.kpis.totalRevenue)} colorScheme="green" variant="revenue" />
        <StatCard
          label="Overall ROI"
          value={`${d.kpis.overallROI}%`}
          trend={d.kpis.overallROI >= 0 ? 'increase' : 'decrease'}
          colorScheme={d.kpis.overallROI >= 0 ? 'green' : 'red'}
        />
        <StatCard label="Closed Sales" value={fmt(d.kpis.closedSalesRevenue)} helpText={`Rent: ${fmt(d.kpis.annualRentRevenue)}/yr`} colorScheme="purple" variant="revenue" />
      </div>

      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Budget vs Actuals by Project</p>
        </CardHeader>
        <CardBody>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
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
          <p className="font-semibold text-sm text-gray-600">Project Comparison</p>
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
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Sold</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Leased</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Available</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Occupancy</th>
                </tr>
              </thead>
              <tbody>
                {(projectComparison as any[]).map((p: any) => (
                  <tr key={p.projectId} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">{p.projectName}</td>
                    <td className="py-2 px-2"><StatusBadge status={p.phase} /></td>
                    <td className="py-2 px-2 text-right">{fmt(p.budget)}</td>
                    <td className="py-2 px-2 text-right">{fmt(p.actuals)}</td>
                    <td className={`py-2 px-2 text-right ${p.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmt(p.variance)}
                    </td>
                    <td className="py-2 px-2 text-right">{p.soldUnits}</td>
                    <td className="py-2 px-2 text-right">{p.leasedUnits}</td>
                    <td className="py-2 px-2 text-right">{p.availableUnits}</td>
                    <td className="py-2 px-2 text-right">{p.occupancy}%</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---- Sales Report Tab ----
function SalesTab({ filterProject }: { filterProject?: string }) {
  const { data, isLoading, error } = useSalesReport();
  if (isLoading) return <LoadingState message="Loading sales report..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;
  const availableUnits = filterProject ? (d.availableUnits ?? []).filter((u: any) => u.projectName === filterProject) : (d.availableUnits ?? []);

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Pipeline" value={fmt(d.kpis.totalPipeline)} colorScheme="brand" variant="revenue" />
        <StatCard label="Closed Value" value={fmt(d.kpis.closedValue)} colorScheme="green" variant="revenue" />
        <StatCard label="Conversion Rate" value={`${d.kpis.conversionRate}%`} colorScheme="orange" variant="revenue" />
        <StatCard label="Avg Days to Close" value={`${d.kpis.avgDaysToClose}`} helpText="days" colorScheme="purple" variant="revenue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-600">Deals by Stage</p>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={d.dealsByStage}>
                <XAxis dataKey="stage" fontSize={11} />
                <YAxis yAxisId="left" allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => `$${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={(v: number, name: string) => name === 'value' ? fmt(v) : v} />
                <Legend />
                <Bar yAxisId="left" dataKey="count" fill="#3182CE" name="Count" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="value" fill="#38A169" name="Value" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-600">Sales by Project</p>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={d.salesByProject} layout="vertical">
                <XAxis type="number" tickFormatter={(v: number) => `$${(v / 1e6).toFixed(1)}M`} />
                <YAxis dataKey="name" type="category" fontSize={11} width={100} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="value" fill="#805AD5" name="Sales Value" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-600">Available Units</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Unit</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Building</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Sqft</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Asking Price</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Asking Rent</th>
                </tr>
              </thead>
              <tbody>
                {(availableUnits as any[]).map((u: any) => (
                  <tr key={u.id} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">{u.unitNumber}</td>
                    <td className="py-2 px-2">{u.projectName}</td>
                    <td className="py-2 px-2">{u.buildingName}</td>
                    <td className="py-2 px-2"><StatusBadge status={u.unitType} /></td>
                    <td className="py-2 px-2 text-right">{u.sqft?.toLocaleString() ?? '\u2014'}</td>
                    <td className="py-2 px-2 text-right">{u.askingPrice ? fmt(u.askingPrice) : '\u2014'}</td>
                    <td className="py-2 px-2 text-right">{u.askingRent ? fmt(u.askingRent) : '\u2014'}</td>
                  </tr>
                ))}
                {(availableUnits as any[]).length === 0 && (
                  <tr><td colSpan={7} className="text-center py-4 text-gray-400">No available units</td></tr>
                )}
              </tbody>
            </table></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---- Revenue & Leasing Tab ----
function RevenueTab({ filterProject }: { filterProject?: string }) {
  const { data, isLoading, error } = useRevenueReport();
  if (isLoading) return <LoadingState message="Loading revenue report..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;
  const expiringLeases = filterProject ? (d.expiringLeases ?? []).filter((l: any) => l.projectName === filterProject) : (d.expiringLeases ?? []);

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Monthly Rent" value={fmt(d.kpis.totalMonthlyRent)} colorScheme="brand" variant="revenue" />
        <StatCard label="Annual Rent" value={fmt(d.kpis.totalAnnualRent)} colorScheme="green" variant="revenue" />
        <StatCard label="Active Leases" value={`${d.kpis.activeLeaseCount}`} colorScheme="orange" variant="revenue" />
        <StatCard label="Occupancy" value={`${d.kpis.portfolioOccupancy}%`} colorScheme="purple" variant="revenue" />
      </div>

      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Revenue by Project</p>
        </CardHeader>
        <CardBody>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.revenueByProject}>
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => `$${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="rentalIncome" fill="#38A169" name="Rental Income" stackId="a" />
              <Bar dataKey="salesRevenue" fill="#3182CE" name="Sales Revenue" stackId="a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardBody>
      </Card>

      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-600">Upcoming Lease Expirations (Next 12 Months)</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Tenant</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Unit</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Monthly Rent</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Expires</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Days Left</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Urgency</th>
                </tr>
              </thead>
              <tbody>
                {(expiringLeases as any[]).map((l: any) => (
                  <tr key={l.id} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">{l.tenantName}</td>
                    <td className="py-2 px-2">{l.unitNumber} ({l.buildingName})</td>
                    <td className="py-2 px-2">{l.projectName}</td>
                    <td className="py-2 px-2 text-right">{fmt(l.monthlyRent)}</td>
                    <td className="py-2 px-2">{fmtDate(l.leaseEnd)}</td>
                    <td className="py-2 px-2 text-right">{l.daysUntilExpiry}</td>
                    <td className="py-2 px-2"><StatusBadge status={l.urgency} /></td>
                  </tr>
                ))}
                {(expiringLeases as any[]).length === 0 && (
                  <tr><td colSpan={7} className="text-center py-4 text-gray-400">No leases expiring in the next 12 months</td></tr>
                )}
              </tbody>
            </table></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---- Debt & Financing Tab ----
function DebtTab({ filterProject }: { filterProject?: string }) {
  const { data, isLoading, error } = useDebtReport();
  if (isLoading) return <LoadingState message="Loading debt report..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;
  const loans = filterProject ? (d.loans ?? []).filter((l: any) => l.projectName === filterProject) : (d.loans ?? []);
  const maturities = filterProject ? (d.maturities ?? []).filter((l: any) => l.projectName === filterProject) : (d.maturities ?? []);

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Principal" value={fmt(d.kpis.totalPrincipal)} colorScheme="brand" variant="construction" />
        <StatCard label="Total Balance" value={fmt(d.kpis.totalBalance)} colorScheme="orange" variant="construction" />
        <StatCard label="Weighted Avg Rate" value={`${d.kpis.weightedAvgRate}%`} colorScheme="purple" variant="construction" />
        <StatCard label="Monthly Payments" value={fmt(d.kpis.totalMonthlyPayment)} colorScheme="red" variant="construction" />
      </div>

      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Debt by Loan Type</p>
        </CardHeader>
        <CardBody>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={d.byLoanType}>
              <XAxis dataKey="type" fontSize={11} />
              <YAxis tickFormatter={(v: number) => `$${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="totalPrincipal" fill="#3182CE" name="Principal" radius={[4, 4, 0, 0]} />
              <Bar dataKey="totalBalance" fill="#DD6B20" name="Balance" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">All Loans</p>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="overflow-x-auto">
              <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Lender</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Principal</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Balance</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(loans as any[]).map((l: any) => (
                    <tr key={l.id} className="border-b border-gray-50">
                      <td className="py-2 px-2">{l.projectName}</td>
                      <td className="py-2 px-2"><StatusBadge status={l.loanType} /></td>
                      <td className="py-2 px-2">{l.lender}</td>
                      <td className="py-2 px-2 text-right">{fmt(l.principalAmt)}</td>
                      <td className="py-2 px-2 text-right">{fmt(l.currentBalance)}</td>
                      <td className="py-2 px-2 text-right">{l.interestRate}%</td>
                    </tr>
                  ))}
                  {(loans as any[]).length === 0 && (
                    <tr><td colSpan={6} className="text-center py-4 text-gray-400">No loans</td></tr>
                  )}
                </tbody>
              </table></div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Upcoming Maturities</p>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="overflow-x-auto">
              <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Lender</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Balance</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Maturity</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {(maturities as any[]).map((l: any) => (
                    <tr key={l.id} className="border-b border-gray-50">
                      <td className="py-2 px-2">{l.projectName}</td>
                      <td className="py-2 px-2">{l.lender}</td>
                      <td className="py-2 px-2 text-right">{fmt(l.currentBalance)}</td>
                      <td className="py-2 px-2">{fmtDate(l.maturityDate)}</td>
                      <td className={`py-2 px-2 text-right ${l.daysUntilMaturity <= 90 ? 'text-red-600' : ''}`}>
                        {l.daysUntilMaturity}
                      </td>
                    </tr>
                  ))}
                  {(maturities as any[]).length === 0 && (
                    <tr><td colSpan={5} className="text-center py-4 text-gray-400">No upcoming maturities</td></tr>
                  )}
                </tbody>
              </table></div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

const REPORT_TAB_TITLES: Record<string, string> = {
  portfolio: 'Executive Summary',
  sales: 'Sales Report',
  revenue: 'Revenue & Leasing',
  debt: 'Debt & Financing',
};

const REPORT_TAB_ROLES: Record<string, string[]> = {
  portfolio: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'PROJECT_MANAGER'],
  sales:     ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'SALES', 'MARKETING'],
  revenue:   ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'SALES'],
  debt:      ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE'],
};

// ---- Main Reports Page ----
export default function ReportsPage() {
  const { user } = useAuthStore();
  const role = user?.role || '';
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: 'Prime Tracker — Reports' });

  // Project-wise scope: when a project is picked, each report's per-project
  // tables/charts are filtered to it (rows key off project name).
  const { data: projects = [] } = useProjects();
  const [projectId, setProjectId] = useState('');
  const projList = projects as any[];
  const filterProject = projectId ? projList.find((p) => p.id === projectId)?.name : undefined;

  const visibleTabs = Object.keys(REPORT_TAB_ROLES).filter((key) =>
    REPORT_TAB_ROLES[key].includes(role)
  );

  const renderTab = (key: string) => {
    if (key === 'portfolio') return <PortfolioTab filterProject={filterProject} />;
    if (key === 'sales') return <SalesTab filterProject={filterProject} />;
    if (key === 'revenue') return <RevenueTab filterProject={filterProject} />;
    if (key === 'debt') return <DebtTab filterProject={filterProject} />;
    return null;
  };

  const projectSelect = (
    <Select
      aria-label="Filter by project"
      size="sm"
      className="w-full sm:max-w-[240px]"
      selectedKeys={projectId ? [projectId] : ['__all']}
      onSelectionChange={(k) => {
        const v = Array.from(k)[0] as string;
        setProjectId(v === '__all' ? '' : v);
      }}
    >
      {[
        <SelectItem key="__all">All Projects</SelectItem>,
        ...projList.map((p) => <SelectItem key={p.id}>{p.name}</SelectItem>),
      ]}
    </Select>
  );

  const headerActions = (
    <div className="flex items-center gap-2 w-full sm:w-auto">
      {projectSelect}
      <Button size="sm" variant="bordered" startContent={<FiDownload />} onPress={() => handlePrint()}>
        Download PDF
      </Button>
    </div>
  );

  if (visibleTabs.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Reports</h1>
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No reports are available for your role.</p>
        </div>
      </div>
    );
  }

  if (visibleTabs.length === 1) {
    return (
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
          <h1 className="text-2xl font-bold">Reports</h1>
          {headerActions}
        </div>
        {filterProject && <p className="text-xs text-gray-500 mb-3">Scoped to <span className="font-semibold text-gray-700">{filterProject}</span> · portfolio-wide KPIs unchanged</p>}
        <div ref={printRef}>{renderTab(visibleTabs[0])}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <h1 className="text-2xl font-bold">Reports</h1>
        {headerActions}
      </div>
      {filterProject && <p className="text-xs text-gray-500 mb-3">Scoped to <span className="font-semibold text-gray-700">{filterProject}</span> · portfolio-wide KPIs unchanged</p>}
      <div ref={printRef}>
        <Tabs color="primary" variant="underlined" classNames={{ tabList: "overflow-x-auto scrollbar-none flex-nowrap" }}>
          {visibleTabs.map((key) => (
            <Tab key={key} title={REPORT_TAB_TITLES[key]}>
              {renderTab(key)}
            </Tab>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
