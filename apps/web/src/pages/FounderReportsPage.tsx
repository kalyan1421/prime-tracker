import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardBody, Tabs, Tab, Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Select, SelectItem, Switch, Textarea, useDisclosure, addToast } from '@heroui/react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, AreaChart, Area, CartesianGrid,
} from 'recharts';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { usePortfolioReport, useDebtReport, useSalesReport, useRevenueReport, useUnitSalesReport, useProjects, useCashFlowForecast, useCreateCashFlowEntry, useDeleteCashFlowEntry } from '../hooks/useApi';
import { StatCard, StatusBadge, LoadingState, ErrorState, EmptyState, fmt, fmtDate } from '../components/ui';
import { useAuthStore } from '../store/authStore';

function PortfolioPLTab() {
  const { data, isLoading, error } = usePortfolioReport();
  if (isLoading) return <LoadingState message="Loading portfolio data..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Investment" value={fmt(d.kpis.totalInvestment)} colorScheme="brand" variant="construction" />
        <StatCard label="Total Revenue" value={fmt(d.kpis.totalRevenue)} colorScheme="green" variant="revenue" />
        <StatCard label="Overall ROI" value={`${d.kpis.overallROI}%`} trend={d.kpis.overallROI >= 0 ? 'increase' : 'decrease'} colorScheme={d.kpis.overallROI >= 0 ? 'green' : 'red'} />
        <StatCard label="Closed Sales" value={fmt(d.kpis.closedSalesRevenue)} helpText={`Rent: ${fmt(d.kpis.annualRentRevenue)}/yr`} colorScheme="purple" variant="revenue" />
      </div>
      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Budget vs Actuals by Project</p>
        </CardHeader>
        <CardBody>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.chartData}>
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
          <p className="font-semibold text-sm text-gray-600">Project P&L Comparison</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Phase</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Budget</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Actuals</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Variance</th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Occupancy</th>
                </tr>
              </thead>
              <tbody>
                {(d.projectComparison as any[]).map((p: any) => (
                  <tr key={p.projectId} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">{p.projectName}</td>
                    <td className="py-2 px-2"><StatusBadge status={p.phase} /></td>
                    <td className="py-2 px-2 text-right">{fmt(p.budget)}</td>
                    <td className="py-2 px-2 text-right">{fmt(p.actuals)}</td>
                    <td className={`py-2 px-2 text-right ${p.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmt(p.variance)}
                    </td>
                    <td className="py-2 px-2 text-center">{p.occupancy}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function DebtFinancingTab() {
  const { data, isLoading, error } = useDebtReport();
  if (isLoading) return <LoadingState message="Loading debt data..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Principal</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.loans as any[]).map((l: any) => (
                    <tr key={l.id} className="border-b border-gray-50">
                      <td className="py-2 px-2">{l.projectName}</td>
                      <td className="py-2 px-2"><StatusBadge status={l.loanType} /></td>
                      <td className="py-2 px-2 text-right">{fmt(l.principalAmt)}</td>
                      <td className="py-2 px-2 text-right">{l.interestRate}%</td>
                    </tr>
                  ))}
                  {(d.loans as any[]).length === 0 && (
                    <tr><td colSpan={4} className="text-center py-4 text-gray-400">No loans</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Upcoming Maturities</p>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Balance</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Maturity</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.maturities as any[]).map((l: any) => (
                    <tr key={l.id} className="border-b border-gray-50">
                      <td className="py-2 px-2">{l.projectName}</td>
                      <td className="py-2 px-2 text-right">{fmt(l.currentBalance)}</td>
                      <td className="py-2 px-2">{fmtDate(l.maturityDate)}</td>
                      <td className={`py-2 px-2 text-right ${l.daysUntilMaturity <= 90 ? 'text-red-600' : ''}`}>
                        {l.daysUntilMaturity}
                      </td>
                    </tr>
                  ))}
                  {(d.maturities as any[]).length === 0 && (
                    <tr><td colSpan={4} className="text-center py-4 text-gray-400">No upcoming maturities</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ConstructionCostTab() {
  const { data, isLoading, error } = usePortfolioReport();
  if (isLoading) return <LoadingState message="Loading cost data..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Investment" value={fmt(d.kpis.totalInvestment)} colorScheme="brand" variant="construction" />
        <StatCard label="Total Actuals" value={fmt(d.kpis.totalActuals ?? 0)} colorScheme="orange" variant="construction" />
        <StatCard
          label="Variance"
          value={fmt((d.kpis.totalInvestment ?? 0) - (d.kpis.totalActuals ?? 0))}
          colorScheme={((d.kpis.totalInvestment ?? 0) - (d.kpis.totalActuals ?? 0)) >= 0 ? 'green' : 'red'}
          variant="construction"
        />
        <StatCard label="Projects" value={String((d.projectComparison || []).length)} colorScheme="gray" variant="neutral" />
      </div>
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-600">Budget vs Actuals by Project</p>
        </CardHeader>
        <CardBody>
          <ResponsiveContainer width="100%" height={300}>
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
    </div>
  );
}

function RevenueCashFlowTab() {
  const { data, isLoading, error } = useRevenueReport();
  if (isLoading) return <LoadingState message="Loading revenue data..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Monthly Rent" value={fmt(d.kpis.totalMonthlyRent)} colorScheme="brand" variant="revenue" />
        <StatCard label="Annual Rent" value={fmt(d.kpis.totalAnnualRent)} colorScheme="green" variant="revenue" />
        <StatCard label="Active Leases" value={`${d.kpis.activeLeaseCount}`} colorScheme="orange" variant="revenue" />
        <StatCard label="Portfolio Occupancy" value={`${d.kpis.portfolioOccupancy}%`} colorScheme="purple" variant="revenue" />
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Tenant</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Unit</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Monthly Rent</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Expires</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Days Left</th>
                </tr>
              </thead>
              <tbody>
                {(d.expiringLeases as any[]).map((l: any) => (
                  <tr key={l.id} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">{l.tenantName}</td>
                    <td className="py-2 px-2">{l.unitNumber}</td>
                    <td className="py-2 px-2">{l.projectName}</td>
                    <td className="py-2 px-2 text-right">{fmt(l.monthlyRent)}</td>
                    <td className="py-2 px-2">{fmtDate(l.leaseEnd)}</td>
                    <td className="py-2 px-2 text-right">{l.daysUntilExpiry}</td>
                  </tr>
                ))}
                {(d.expiringLeases as any[]).length === 0 && (
                  <tr><td colSpan={6} className="text-center py-4 text-gray-400">No leases expiring in the next 12 months</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function UnitSalesReportTab() {
  const { data, isLoading, error } = useUnitSalesReport();
  if (isLoading) return <LoadingState message="Loading unit sales data..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Portfolio Value"
          value={fmt(d.kpis.totalPortfolioValue)}
          helpText={`${d.kpis.totalUnits} units`}
          colorScheme="brand"
          variant="revenue"
        />
        <StatCard
          label="Sold"
          value={fmt(d.kpis.totalSoldValue)}
          helpText={`${d.kpis.totalSoldCount} units · ${d.kpis.pctSold}% sold`}
          colorScheme="green"
          variant="revenue"
        />
        <StatCard
          label="Under Contract"
          value={fmt(d.kpis.totalUnderContractValue)}
          helpText={`${d.kpis.totalUnderContractCount} units`}
          colorScheme="orange"
          variant="revenue"
        />
        <StatCard
          label="Available (Unsold)"
          value={fmt(d.kpis.totalUnsoldValue)}
          helpText={`${d.kpis.totalUnsoldCount} units`}
          colorScheme="gray"
          variant="neutral"
        />
      </div>

      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Unit Sales Value by Project</p>
        </CardHeader>
        <CardBody>
          {(d.chartData || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={d.chartData}>
                <XAxis dataKey="name" fontSize={11} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend />
                <Bar dataKey="Sold" fill="#38A169" stackId="a" />
                <Bar dataKey="Under Contract" fill="#3182CE" stackId="a" />
                <Bar dataKey="Available" fill="#A0AEC0" stackId="a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-600">Breakdown by Project & Building</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Units</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Total Value</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Sold</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Available</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Under Contract</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">% Sold</th>
                </tr>
              </thead>
              <tbody>
                {(d.projects as any[]).flatMap((p: any) => [
                  <tr key={`proj-${p.projectId}`} className="border-b border-gray-200 bg-gray-50">
                    <td className="py-2 px-2 font-semibold text-gray-800">{p.projectName}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{p.totalUnits}</td>
                    <td className="py-2 px-2 text-right font-semibold">{fmt(p.totalValue)}</td>
                    <td className="py-2 px-2 text-right text-green-600 font-medium">{fmt(p.soldValue)}</td>
                    <td className="py-2 px-2 text-right text-gray-500">{fmt(p.unsoldValue)}</td>
                    <td className="py-2 px-2 text-right text-blue-600">{fmt(p.underContractValue)}</td>
                    <td className="py-2 px-2 text-right">
                      <span className={`text-xs font-semibold ${p.pctSold >= 80 ? 'text-green-600' : p.pctSold >= 50 ? 'text-blue-600' : 'text-gray-500'}`}>
                        {p.pctSold}%
                      </span>
                    </td>
                  </tr>,
                  ...(p.buildings as any[]).map((b: any) => (
                    <tr key={`bld-${b.buildingId}`} className="border-b border-gray-50">
                      <td className="py-2 px-2 pl-8 text-gray-500 text-xs">{b.buildingName}</td>
                      <td className="py-2 px-2 text-right text-gray-400 text-xs">{b.totalUnits}</td>
                      <td className="py-2 px-2 text-right text-gray-600 text-xs">{fmt(b.totalValue)}</td>
                      <td className="py-2 px-2 text-right text-green-500 text-xs">{fmt(b.soldValue)}</td>
                      <td className="py-2 px-2 text-right text-gray-400 text-xs">{fmt(b.unsoldValue)}</td>
                      <td className="py-2 px-2 text-right text-blue-500 text-xs">{fmt(b.underContractValue)}</td>
                      <td className="py-2 px-2 text-right text-xs text-gray-400">{b.pctSold}%</td>
                    </tr>
                  )),
                ])}
                {(d.projects as any[]).length > 0 && (
                  <tr className="border-t-2 border-gray-300 bg-blue-50">
                    <td className="py-2 px-2 font-bold text-gray-800">Portfolio Total</td>
                    <td className="py-2 px-2 text-right font-bold">{d.kpis.totalUnits}</td>
                    <td className="py-2 px-2 text-right font-bold">{fmt(d.kpis.totalPortfolioValue)}</td>
                    <td className="py-2 px-2 text-right text-green-600 font-bold">{fmt(d.kpis.totalSoldValue)}</td>
                    <td className="py-2 px-2 text-right text-gray-500 font-bold">{fmt(d.kpis.totalUnsoldValue)}</td>
                    <td className="py-2 px-2 text-right text-blue-600 font-bold">{fmt(d.kpis.totalUnderContractValue)}</td>
                    <td className="py-2 px-2 text-right font-bold text-gray-700">{d.kpis.pctSold}%</td>
                  </tr>
                )}
                {(d.projects as any[]).length === 0 && (
                  <tr><td colSpan={7} className="text-center py-6 text-gray-400">No unit data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---- Cash Flow Tab ----
const EMPTY_ENTRY = { entryType: 'INFLOW', category: 'RENTAL_INCOME', amount: '', month: '', notes: '', isActual: true };
const CATEGORIES = ['RENTAL_INCOME', 'LOAN_PAYMENT', 'OPEX', 'CAPEX', 'SALE_PROCEEDS', 'EQUITY_CALL', 'OTHER'];

function CashFlowTab() {
  const { data: projects = [] } = useProjects();
  const [projectId, setProjectId] = useState('');
  const { data: forecast, isLoading } = useCashFlowForecast(projectId);
  const createEntry = useCreateCashFlowEntry();
  const deleteEntry = useDeleteCashFlowEntry();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, any>>(EMPTY_ENTRY);
  const set = (f: string) => (e: any) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const errMsg = (err: unknown, fallback: string) => {
    const msg = (err as any)?.response?.data?.message;
    return typeof msg === 'string' ? msg : fallback;
  };

  const f = forecast as any;
  const monthly = f?.monthly || [];
  const summary = f?.summary || {};

  const handleSave = async () => {
    try {
      await createEntry.mutateAsync({ projectId, ...form, amount: parseFloat(form.amount) });
      addToast({ title: 'Entry added', color: 'success' });
      setForm(EMPTY_ENTRY);
      onClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to add entry'), color: 'danger' }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Select
          label="Select Project"
          className="max-w-xs"
          selectedKeys={projectId ? [projectId] : []}
          onSelectionChange={(k) => setProjectId(Array.from(k)[0] as string)}
        >
          {(projects as any[]).map((p: any) => <SelectItem key={p.id}>{p.name}</SelectItem>)}
        </Select>
        {projectId && (
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={onOpen}>Add Entry</Button>
        )}
      </div>

      {!projectId && <EmptyState message="Select a project to view cash flow" />}

      {projectId && isLoading && <LoadingState />}

      {projectId && !isLoading && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Total Inflows" value={fmt(summary.totalInflows || 0)} variant="revenue" />
            <StatCard label="Total Outflows" value={fmt(summary.totalOutflows || 0)} variant="construction" />
            <StatCard label="Net Cash Flow" value={fmt(summary.netCashFlow || 0)} variant={summary.netCashFlow >= 0 ? 'revenue' : 'construction'} />
            <StatCard label="Avg Monthly Burn" value={fmt(summary.burnRate || 0)} variant="neutral" />
          </div>

          {monthly.length > 0 && (
            <Card shadow="sm">
              <CardHeader><span className="font-semibold text-sm">Monthly Cash Flow</span></CardHeader>
              <CardBody>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => fmt(v)} />
                    <Legend />
                    <Area type="monotone" dataKey="inflows" stackId="a" stroke="#10b981" fill="#d1fae5" name="Inflows" />
                    <Area type="monotone" dataKey="outflows" stackId="b" stroke="#ef4444" fill="#fee2e2" name="Outflows" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          )}

          {monthly.length === 0 && <EmptyState message="No cash flow data. Add entries above." />}

          {monthly.length > 0 && (
            <Card shadow="sm">
              <CardHeader><span className="font-semibold text-sm">Monthly Detail</span></CardHeader>
              <CardBody className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      {['Month', 'Inflows', 'Outflows', 'Net', 'Cumulative', 'Type'].map((h) => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((m: any) => (
                      <tr key={m.month} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-sm">{m.month}</td>
                        <td className="px-4 py-2 font-mono text-green-600">{fmt(m.inflows)}</td>
                        <td className="px-4 py-2 font-mono text-red-500">{fmt(m.outflows)}</td>
                        <td className={`px-4 py-2 font-mono font-medium ${m.net >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmt(m.net)}</td>
                        <td className={`px-4 py-2 font-mono ${m.cumulative >= 0 ? 'text-gray-800' : 'text-red-500'}`}>{fmt(m.cumulative)}</td>
                        <td className="px-4 py-2 text-xs text-gray-400">{m.isActual ? 'Actual' : 'Forecast'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
        </>
      )}

      <Modal isOpen={isOpen} onClose={onClose} size="md">
        <ModalContent>
          <ModalHeader>Add Cash Flow Entry</ModalHeader>
          <ModalBody className="space-y-3">
            <Select label="Type" selectedKeys={[form.entryType]} onSelectionChange={(k) => setForm((p: any) => ({ ...p, entryType: Array.from(k)[0] }))}>
              <SelectItem key="INFLOW">Inflow</SelectItem>
              <SelectItem key="OUTFLOW">Outflow</SelectItem>
            </Select>
            <Select label="Category" selectedKeys={[form.category]} onSelectionChange={(k) => setForm((p: any) => ({ ...p, category: Array.from(k)[0] }))}>
              {CATEGORIES.map((c) => <SelectItem key={c}>{c.replace(/_/g, ' ')}</SelectItem>)}
            </Select>
            <Input label="Amount" type="number" value={form.amount} onChange={set('amount')} />
            <Input label="Month" type="month" value={form.month} onChange={set('month')} />
            <div className="flex items-center gap-2">
              <Switch isSelected={form.isActual} onValueChange={(v) => setForm((p: any) => ({ ...p, isActual: v }))} size="sm">
                Actual (not forecast)
              </Switch>
            </div>
            <Textarea label="Notes" value={form.notes} onChange={set('notes')} minRows={2} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>Cancel</Button>
            <Button color="primary" onPress={handleSave} isLoading={createEntry.isPending}>Add</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default function FounderReportsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user?.role) return;
    if (!['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'].includes(user.role)) {
      if (['CONSTRUCTION', 'PROJECT_MANAGER'].includes(user.role)) navigate('/reports/construction', { replace: true });
      else if (['SALES', 'MARKETING'].includes(user.role)) navigate('/reports/sales', { replace: true });
      else navigate('/reports', { replace: true });
    }
  }, [user?.role, navigate]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Founder Reports</h1>
      <Tabs color="primary" variant="underlined">
        <Tab key="portfolio" title="Portfolio P&L">
          <PortfolioPLTab />
        </Tab>
        <Tab key="debt" title="Debt & Financing">
          <DebtFinancingTab />
        </Tab>
        <Tab key="construction" title="Construction Cost">
          <ConstructionCostTab />
        </Tab>
        <Tab key="revenue" title="Revenue & Cash Flow">
          <RevenueCashFlowTab />
        </Tab>
        <Tab key="unit-sales" title="Unit Sales Value">
          <UnitSalesReportTab />
        </Tab>
        <Tab key="cashflow" title="Cash Flow">
          <CashFlowTab />
        </Tab>
      </Tabs>
    </div>
  );
}
