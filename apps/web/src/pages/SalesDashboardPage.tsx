import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardBody } from '@heroui/react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { FiTarget } from 'react-icons/fi';
import { useSalesDashboard } from '../hooks/useApi';
import { StatCard, StatusBadge, LoadingState, ErrorState, fmt, fmtDate } from '../components/ui';
import { useAuthStore } from '../store/authStore';

const STATUS_ORDER = ['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT', 'CLOSED'];

export default function SalesDashboardPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { data, isLoading, error } = useSalesDashboard();

  useEffect(() => {
    if (!user?.role) return;
    if (!['SALES', 'MARKETING'].includes(user.role)) {
      if (['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'].includes(user.role)) navigate('/dashboard/founder', { replace: true });
      else if (['CONSTRUCTION', 'PROJECT_MANAGER'].includes(user.role)) navigate('/dashboard/construction', { replace: true });
      else navigate('/', { replace: true });
    }
  }, [user?.role, navigate]);

  if (isLoading) return <LoadingState message="Loading sales dashboard..." />;
  if (error) return <ErrorState />;
  if (!data) return null;

  const d = data as any;
  const inv = d.unitInventory || {};

  // Pipeline funnel data
  const pipelineFunnelData = STATUS_ORDER.map((status) => ({
    status: status.replace(/_/g, ' '),
    count: d.pipelineByStatus?.[status] || 0,
  }));

  // Unit inventory by project stacked bar
  const inventoryByProject = (d.unitsByProject || []).map((p: any) => ({
    name: p.projectName.length > 15 ? p.projectName.slice(0, 15) + '…' : p.projectName,
    Available: p.available,
    'Under Contract': p.underContract,
    Leased: p.leased,
    Sold: p.sold,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Sales Dashboard</h1>

      {/* Zone A — Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard label="Available Units" value={String(inv.available ?? 0)} variant="neutral" colorScheme="gray" onClick={() => navigate('/inventory')} />
        <StatCard label="Under Contract" value={String(inv.underContract ?? 0)} variant="revenue" colorScheme="brand" onClick={() => navigate('/inventory')} />
        <StatCard label="Total Pipeline" value={fmt(d.pipelineTotalValue)} variant="revenue" colorScheme="green" onClick={() => navigate('/reports/sales')} />
        <StatCard label="Closed Sales YTD" value={fmt(d.closedSalesRevenue)} variant="revenue" colorScheme="purple" onClick={() => navigate('/reports/sales')} />
        <StatCard label="Monthly Lease Income" value={fmt(d.monthlyLeaseIncome)} helpText={`${fmt(d.monthlyLeaseIncome * 12)}/yr`} variant="revenue" colorScheme="teal" onClick={() => navigate('/reports/sales')} />
        <StatCard label="Active Leads" value={String(d.leadStats?.active ?? 0)} helpText={`${d.leadStats?.thisMonthConverted ?? 0} converted this month`} variant="marketing" colorScheme="purple" onClick={() => navigate('/leads')} />
      </div>

      {/* Zone A2 — Sales & Marketing Financials */}
      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <FiTarget className="text-blue-600" />
            <p className="font-semibold text-sm text-blue-700">Sales & Marketing Financials</p>
          </div>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total Sold Units Value"
              value={fmt(d.closedSalesRevenue)}
              helpText="closed sales to date"
              variant="revenue"
              colorScheme="green"
            />
            <StatCard
              label="Projected Unsold Value"
              value={fmt(d.projectedUnsoldValue)}
              helpText={`${inv.available ?? 0} available units`}
              variant="revenue"
              colorScheme="brand"
            />
            <StatCard
              label="Under Contract Value"
              value={fmt(d.underContractValue)}
              helpText={`${inv.underContract ?? 0} units`}
              variant="revenue"
              colorScheme="orange"
            />
            <StatCard
              label="Monthly Lease Income"
              value={fmt(d.monthlyLeaseIncome)}
              helpText={`${fmt((d.monthlyLeaseIncome ?? 0) * 12)}/yr`}
              variant="revenue"
              colorScheme="teal"
            />
          </div>
        </CardBody>
      </Card>

      {/* Zone B — Pipeline Funnel + Inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <Card shadow="sm">
          <CardHeader className="pb-0">
            <div className="flex items-center gap-2">
              <FiTarget className="text-blue-600" />
              <p className="font-semibold text-sm text-gray-600">Sales Pipeline by Stage</p>
            </div>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pipelineFunnelData}>
                <XAxis dataKey="status" fontSize={11} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3182CE" radius={[4, 4, 0, 0]} name="Deals" />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Lead Stats</p>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <StatCard label="Total Leads" value={String(d.leadStats?.total ?? 0)} variant="marketing" colorScheme="purple" />
              <StatCard label="Active Leads" value={String(d.leadStats?.active ?? 0)} variant="marketing" colorScheme="brand" />
              <StatCard label="Converted This Month" value={String(d.leadStats?.thisMonthConverted ?? 0)} variant="revenue" colorScheme="green" />
              <StatCard label="Under Contract" value={String(inv.underContract ?? 0)} variant="revenue" colorScheme="brand" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Zone C — Revenue by Project + Unit Inventory by Project */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Revenue by Project</p>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="overflow-x-auto">
              <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Available</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Contract</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Leased</th>
                    <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Sold</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.unitsByProject || []).map((p: any) => (
                    <tr
                      key={p.projectId}
                      className="border-b border-gray-50 cursor-pointer hover:bg-blue-50"
                      onClick={() => navigate(`/projects/${p.projectId}/units`)}
                    >
                      <td className="py-2 px-2 font-medium">{p.projectName}</td>
                      <td className="py-2 px-2 text-center">{p.available}</td>
                      <td className="py-2 px-2 text-center text-blue-600">{p.underContract}</td>
                      <td className="py-2 px-2 text-center text-teal-600">{p.leased}</td>
                      <td className="py-2 px-2 text-center text-green-600">{p.sold}</td>
                    </tr>
                  ))}
                  {(d.unitsByProject || []).length === 0 && (
                    <tr><td colSpan={5} className="text-center py-4 text-gray-400">No projects</td></tr>
                  )}
                </tbody>
              </table></div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-600">Unit Inventory by Project</p>
          </CardHeader>
          <CardBody>
            {inventoryByProject.length === 0 ? (
              <p className="text-sm text-gray-400 py-10 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
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
            )}
          </CardBody>
        </Card>
      </div>

      {/* Zone E — Activity Feed */}
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-600">Recent Sales & Lead Activity</p>
        </CardHeader>
        <CardBody className="pt-0">
          {(d.recentSalesActivity || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No recent activity</p>
          ) : (
            <div className="overflow-auto">
              <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Project</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.recentSalesActivity as any[]).map((item: any) => (
                    <tr key={item.id} className="border-b border-gray-50">
                      <td className="py-2 px-2">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          item.type === 'sale'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}>
                          {item.type === 'sale' ? 'Sale' : 'Lead'}
                        </span>
                      </td>
                      <td className="py-2 px-2">{item.projectName || '—'}</td>
                      <td className="py-2 px-2"><StatusBadge status={item.status} /></td>
                      <td className="py-2 px-2 text-xs text-gray-500">{fmtDate(item.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
