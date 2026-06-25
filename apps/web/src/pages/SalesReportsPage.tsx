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
import { useSalesReport, useRevenueReport, useLeads, useProjects, useUnitSalesReport } from '../hooks/useApi';
import { fmt, fmtDate } from '../utils/fmt';
import { StatCard, StatusBadge, LoadingState, ErrorState } from '../components/ui';
import { useAuthStore } from '../store/authStore';

function SalesPerformanceTab() {
  const { data, isLoading, error } = useSalesReport();
  if (isLoading) return <LoadingState message="Loading sales data..." />;
  if (error) return <ErrorState />;
  if (!data) return null;
  const d = data as any;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Pipeline" value={fmt(d.kpis.totalPipeline)} colorScheme="brand" variant="revenue" />
        <StatCard label="Closed Value" value={fmt(d.kpis.closedValue)} colorScheme="green" variant="revenue" />
        <StatCard label="Conversion Rate" value={`${d.kpis.conversionRate}%`} colorScheme="orange" variant="revenue" />
        <StatCard label="Avg Days to Close" value={`${d.kpis.avgDaysToClose}`} helpText="days" colorScheme="purple" variant="revenue" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Sqft</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Asking Price</th>
                </tr>
              </thead>
              <tbody>
                {(d.availableUnits as any[]).map((u: any) => (
                  <tr key={u.id} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">{u.unitNumber}</td>
                    <td className="py-2 px-2">{u.projectName}</td>
                    <td className="py-2 px-2"><StatusBadge status={u.unitType} /></td>
                    <td className="py-2 px-2 text-right">{u.sqft?.toLocaleString() ?? '—'}</td>
                    <td className="py-2 px-2 text-right">{u.askingPrice ? fmt(u.askingPrice) : '—'}</td>
                  </tr>
                ))}
                {(d.availableUnits as any[]).length === 0 && (
                  <tr><td colSpan={5} className="text-center py-4 text-gray-400">No available units</td></tr>
                )}
              </tbody>
            </table></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function UnitInventoryTab() {
  const { data: projectsData, isLoading: projLoading, error: projError } = useProjects();
  const projects = (projectsData as any[]) || [];

  const unitQueries = useQueries({
    queries: projects.map((p: any) => ({
      queryKey: ['units', p.id],
      queryFn: () => api.get('/units', { params: { projectId: p.id } }).then((r) => r.data),
      enabled: projects.length > 0,
    })),
  });

  if (projLoading || unitQueries.some((q) => q.isLoading)) {
    return <LoadingState message="Loading unit inventory..." />;
  }
  if (projError) return <ErrorState />;

  const inventoryByProject = projects.map((p: any, idx: number) => {
    const units = (unitQueries[idx]?.data as any[]) || [];
    return {
      name: p.name.length > 15 ? p.name.slice(0, 15) + '…' : p.name,
      Available: units.filter((u: any) => u.status === 'AVAILABLE').length,
      'Under Contract': units.filter((u: any) => u.status === 'UNDER_CONTRACT').length,
      Leased: units.filter((u: any) => u.status === 'LEASED').length,
      Sold: units.filter((u: any) => u.status === 'SOLD').length,
      Total: units.length,
    };
  });

  const totals = inventoryByProject.reduce(
    (acc, p) => ({
      Available: acc.Available + p.Available,
      'Under Contract': acc['Under Contract'] + p['Under Contract'],
      Leased: acc.Leased + p.Leased,
      Sold: acc.Sold + p.Sold,
      Total: acc.Total + p.Total,
    }),
    { Available: 0, 'Under Contract': 0, Leased: 0, Sold: 0, Total: 0 },
  );

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total Units" value={String(totals.Total)} variant="neutral" colorScheme="gray" />
        <StatCard label="Available" value={String(totals.Available)} variant="neutral" colorScheme="gray" />
        <StatCard label="Under Contract" value={String(totals['Under Contract'])} variant="revenue" colorScheme="brand" />
        <StatCard label="Leased" value={String(totals.Leased)} variant="revenue" colorScheme="teal" />
        <StatCard label="Sold" value={String(totals.Sold)} variant="revenue" colorScheme="green" />
      </div>

      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Unit Inventory by Project</p>
        </CardHeader>
        <CardBody>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={inventoryByProject}>
              <XAxis dataKey="name" fontSize={10} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Available" fill="#A0AEC0" stackId="a" />
              <Bar dataKey="Under Contract" fill="#3182CE" stackId="a" />
              <Bar dataKey="Leased" fill="#319795" stackId="a" />
              <Bar dataKey="Sold" fill="#38A169" stackId="a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardBody>
      </Card>

      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-600">Inventory Table</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Total</th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Available</th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Contract</th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Leased</th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Sold</th>
                </tr>
              </thead>
              <tbody>
                {inventoryByProject.map((p, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">{p.name}</td>
                    <td className="py-2 px-2 text-center">{p.Total}</td>
                    <td className="py-2 px-2 text-center">{p.Available}</td>
                    <td className="py-2 px-2 text-center text-blue-600">{p['Under Contract']}</td>
                    <td className="py-2 px-2 text-center text-teal-600">{p.Leased}</td>
                    <td className="py-2 px-2 text-center text-green-600">{p.Sold}</td>
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

function RevenueProjectionTab() {
  const { data: salesData, isLoading: salesLoading, error: salesError } = useSalesReport();
  const { data: revData, isLoading: revLoading, error: revError } = useRevenueReport();

  if (salesLoading || revLoading) return <LoadingState message="Loading revenue projections..." />;
  if (salesError || revError) return <ErrorState />;
  if (!salesData || !revData) return null;

  const s = salesData as any;
  const r = revData as any;

  const underContractStage = (s.dealsByStage || []).find((ds: any) => ds.stage === 'UNDER CONTRACT');
  const underContractValue = underContractStage?.value ?? 0;
  const annualLeaseIncome = r.kpis.totalAnnualRent ?? 0;
  const monthlyLeaseIncome = r.kpis.totalMonthlyRent ?? 0;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Under Contract Value" value={fmt(underContractValue)} helpText="Expected to close" variant="revenue" colorScheme="brand" />
        <StatCard label="Monthly Lease Income" value={fmt(monthlyLeaseIncome)} helpText="Current run rate" variant="revenue" colorScheme="green" />
        <StatCard label="Annual Lease Income" value={fmt(annualLeaseIncome)} helpText="Current run rate" variant="revenue" colorScheme="teal" />
        <StatCard label="Closed Sales YTD" value={fmt(s.kpis.closedValue)} colorScheme="purple" variant="revenue" />
      </div>

      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Revenue by Project</p>
        </CardHeader>
        <CardBody>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={r.revenueByProject || []}>
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
          <p className="font-semibold text-sm text-gray-600">Upcoming Lease Expirations</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Tenant</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Monthly Rent</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Expires</th>
                </tr>
              </thead>
              <tbody>
                {(r.expiringLeases as any[]).map((l: any) => (
                  <tr key={l.id} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">{l.tenantName}</td>
                    <td className="py-2 px-2">{l.projectName}</td>
                    <td className="py-2 px-2 text-right">{fmt(l.monthlyRent)}</td>
                    <td className="py-2 px-2">{fmtDate(l.leaseEnd)}</td>
                  </tr>
                ))}
                {(r.expiringLeases as any[]).length === 0 && (
                  <tr><td colSpan={4} className="text-center py-4 text-gray-400">No leases expiring soon</td></tr>
                )}
              </tbody>
            </table></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function LeadMarketingTab() {
  const { data, isLoading, error } = useLeads();
  if (isLoading) return <LoadingState message="Loading lead data..." />;
  if (error) return <ErrorState />;

  const leads = (data as any[]) || [];

  const byStatus: Record<string, number> = {};
  for (const lead of leads) {
    byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
  }

  const statusData = Object.entries(byStatus).map(([status, count]) => ({
    status: status.replace(/_/g, ' '),
    count,
  }));

  const bySource: Record<string, number> = {};
  for (const lead of leads) {
    if (lead.source) bySource[lead.source] = (bySource[lead.source] || 0) + 1;
  }
  const sourceData = Object.entries(bySource).map(([source, count]) => ({
    source: source.replace(/_/g, ' '),
    count,
  }));

  const active = leads.filter((l: any) => !['CONVERTED', 'LOST', 'DEAD'].includes(l.status)).length;
  const converted = leads.filter((l: any) => l.status === 'CONVERTED').length;
  const convRate = leads.length > 0 ? ((converted / leads.length) * 100).toFixed(1) : '0';

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Leads" value={String(leads.length)} variant="marketing" colorScheme="purple" />
        <StatCard label="Active Leads" value={String(active)} variant="marketing" colorScheme="brand" />
        <StatCard label="Converted" value={String(converted)} variant="revenue" colorScheme="green" />
        <StatCard label="Conversion Rate" value={`${convRate}%`} colorScheme="orange" variant="revenue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-600">Leads by Status</p>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusData}>
                <XAxis dataKey="status" fontSize={11} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#805AD5" radius={[4, 4, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-600">Leads by Source</p>
          </CardHeader>
          <CardBody>
            {sourceData.length === 0 ? (
              <p className="text-sm text-gray-400 py-10 text-center">No source data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={sourceData}>
                  <XAxis dataKey="source" fontSize={11} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3182CE" radius={[4, 4, 0, 0]} name="Leads" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
      </div>

      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-600">Recent Leads</p>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Source</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Updated</th>
                </tr>
              </thead>
              <tbody>
                {leads.slice(0, 15).map((lead: any) => (
                  <tr key={lead.id} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">{lead.name}</td>
                    <td className="py-2 px-2 text-xs text-gray-500">{lead.project?.name || '—'}</td>
                    <td className="py-2 px-2 text-xs">{lead.source?.replace(/_/g, ' ') || '—'}</td>
                    <td className="py-2 px-2"><StatusBadge status={lead.status} /></td>
                    <td className="py-2 px-2 text-xs text-gray-400">{fmtDate(lead.updatedAt)}</td>
                  </tr>
                ))}
                {leads.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-4 text-gray-400">No leads</td></tr>
                )}
              </tbody>
            </table></div>
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
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
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
            </table></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default function SalesReportsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: 'Prime Tracker — Sales Reports' });

  useEffect(() => {
    if (!user?.role) return;
    if (!['SALES', 'MARKETING'].includes(user.role)) {
      if (['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'].includes(user.role)) navigate('/reports/founder', { replace: true });
      else if (['CONSTRUCTION', 'PROJECT_MANAGER'].includes(user.role)) navigate('/reports/construction', { replace: true });
      else navigate('/reports', { replace: true });
    }
  }, [user?.role, navigate]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <h1 className="text-2xl font-bold">Sales Reports</h1>
        <Button size="sm" variant="bordered" startContent={<FiDownload />} onPress={() => handlePrint()}>
          Download PDF
        </Button>
      </div>
      <div ref={printRef}>
        <Tabs color="primary" variant="underlined" classNames={{ tabList: "overflow-x-auto scrollbar-none flex-nowrap" }}>
          <Tab key="sales" title="Sales Performance">
            <SalesPerformanceTab />
          </Tab>
          <Tab key="inventory" title="Unit Inventory">
            <UnitInventoryTab />
          </Tab>
          <Tab key="revenue" title="Revenue Projection">
            <RevenueProjectionTab />
          </Tab>
          <Tab key="leads" title="Lead & Marketing">
            <LeadMarketingTab />
          </Tab>
          <Tab key="unit-sales" title="Unit Sales Value">
            <UnitSalesReportTab />
          </Tab>
        </Tabs>
      </div>
    </div>
  );
}
