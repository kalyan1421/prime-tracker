import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, CardBody, Input, Select, SelectItem, Chip, Button,
} from '@heroui/react';
import { FiSearch, FiFilter, FiPackage, FiExternalLink } from 'react-icons/fi';
import { useInventory, useProjects } from '../hooks/useApi';
import { StatCard, StatusBadge, LoadingState, fmt, fmtDate } from '../components/ui';

const UNIT_STATUSES = ['AVAILABLE', 'UNDER_CONTRACT', 'LEASED', 'SOLD', 'OCCUPIED', 'UNDER_CONSTRUCTION'];
const UNIT_TYPES = ['RETAIL', 'MEDICAL', 'FLEX', 'RESIDENTIAL_LOT', 'OFFICE', 'RESTAURANT', 'EVENT_CENTER'];

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: 'bg-green-100 text-green-800',
  UNDER_CONTRACT: 'bg-blue-100 text-blue-800',
  LEASED: 'bg-teal-100 text-teal-800',
  OCCUPIED: 'bg-purple-100 text-purple-800',
  SOLD: 'bg-gray-100 text-gray-600',
  UNDER_CONSTRUCTION: 'bg-orange-100 text-orange-800',
};

export default function InventoryPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');

  const { data: projectsData } = useProjects();
  const { data, isLoading } = useInventory({
    status: statusFilter || undefined,
    unitType: typeFilter || undefined,
    projectId: projectFilter || undefined,
    search: search || undefined,
  });

  const projects = (projectsData as any[] | { data: any[] } | undefined);
  const projectList = Array.isArray(projects) ? projects : (projects as any)?.data ?? [];
  const units = (data as any[]) || [];

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of units) counts[u.status] = (counts[u.status] || 0) + 1;
    return counts;
  }, [units]);

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setTypeFilter('');
    setProjectFilter('');
  };

  const hasFilters = search || statusFilter || typeFilter || projectFilter;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FiPackage className="text-primary" />
            Unit Inventory
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">All units across all projects</p>
        </div>
        {hasFilters && (
          <Button size="sm" variant="flat" onPress={clearFilters}>Clear Filters</Button>
        )}
      </div>

      {/* Status heat map */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
        {UNIT_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={`rounded-lg p-3 text-center border-2 transition-all ${
              statusFilter === s ? 'border-primary shadow-md' : 'border-transparent'
            } ${STATUS_COLORS[s]} hover:opacity-80`}
          >
            <div className="text-2xl font-bold">{statusCounts[s] || 0}</div>
            <div className="text-xs mt-0.5 font-medium">{s.replace(/_/g, ' ')}</div>
          </button>
        ))}
      </div>

      {/* Summary stat */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Units" value={units.length.toString()} />
        <StatCard label="Available" value={(statusCounts['AVAILABLE'] || 0).toString()} colorScheme="green" />
        <StatCard label="Occupied / Leased" value={((statusCounts['OCCUPIED'] || 0) + (statusCounts['LEASED'] || 0)).toString()} colorScheme="teal" />
        <StatCard label="Sold" value={(statusCounts['SOLD'] || 0).toString()} />
      </div>

      {/* Filters */}
      <Card shadow="sm" className="mb-4">
        <CardBody>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-48">
              <Input
                size="sm"
                placeholder="Search units, buildings, projects…"
                startContent={<FiSearch className="text-gray-400" />}
                value={search}
                onValueChange={setSearch}
              />
            </div>
            <Select
              size="sm"
              placeholder="All Statuses"
              className="w-44"
              selectedKeys={statusFilter ? [statusFilter] : []}
              onSelectionChange={(keys) => setStatusFilter(Array.from(keys)[0] as string || '')}
            >
              {UNIT_STATUSES.map((s) => (
                <SelectItem key={s}>{s.replace(/_/g, ' ')}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              placeholder="All Types"
              className="w-44"
              selectedKeys={typeFilter ? [typeFilter] : []}
              onSelectionChange={(keys) => setTypeFilter(Array.from(keys)[0] as string || '')}
            >
              {UNIT_TYPES.map((t) => (
                <SelectItem key={t}>{t.replace(/_/g, ' ')}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              placeholder="All Projects"
              className="w-52"
              selectedKeys={projectFilter ? [projectFilter] : []}
              onSelectionChange={(keys) => setProjectFilter(Array.from(keys)[0] as string || '')}
            >
              {projectList.map((p: any) => (
                <SelectItem key={p.id}>{p.name}</SelectItem>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      {isLoading ? (
        <LoadingState />
      ) : units.length === 0 ? (
        <Card shadow="sm">
          <CardBody>
            <div className="text-center py-10 text-gray-400">
              <FiFilter className="mx-auto text-3xl mb-2" />
              <p>No units match the selected filters.</p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card shadow="sm">
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Unit</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Project</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Building</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Sqft</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Asking Rent</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Asking Price</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Tenant / Buyer</th>
                  <th className="py-2 px-3" />
                </tr>
              </thead>
              <tbody>
                {units.map((u: any) => {
                  const activeLease = u.leases?.[0];
                  const activeSale = u.sales?.find((s: any) => !['CANCELLED'].includes(s.status));
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                      onClick={() => navigate(`/projects/${u.building.project.id}/units/${u.id}`)}
                    >
                      <td className="py-2 px-3 font-medium">{u.unitNumber}</td>
                      <td className="py-2 px-3">
                        <button
                          className="text-primary hover:underline text-xs font-medium flex items-center gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/projects/${u.building.project.id}`);
                          }}
                        >
                          {u.building.project.name}
                          <FiExternalLink className="text-xs" />
                        </button>
                      </td>
                      <td className="py-2 px-3 text-gray-600">{u.building.name}</td>
                      <td className="py-2 px-3">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          {u.unitType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-600">{u.sqft ? u.sqft.toLocaleString() : '—'}</td>
                      <td className="py-2 px-3">{u.askingRent ? `$${fmt(u.askingRent)}/mo` : '—'}</td>
                      <td className="py-2 px-3">{u.askingPrice ? `$${fmt(u.askingPrice)}` : '—'}</td>
                      <td className="py-2 px-3"><StatusBadge status={u.status} /></td>
                      <td className="py-2 px-3 text-xs text-gray-600">
                        {activeLease ? (
                          <div>
                            <div className="font-medium">{activeLease.tenantName}</div>
                            <div className="text-gray-400">until {fmtDate(activeLease.leaseEnd)}</div>
                          </div>
                        ) : activeSale ? (
                          <div>
                            <div className="font-medium">{activeSale.buyer || '—'}</div>
                            <div className="text-gray-400">{activeSale.status.replace(/_/g, ' ')}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="py-2 px-3">
                        <Button
                          size="sm"
                          variant="light"
                          isIconOnly
                          onPress={(e) => navigate(`/projects/${u.building.project.id}/units/${u.id}`)}
                        >
                          <FiExternalLink className="text-xs" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
