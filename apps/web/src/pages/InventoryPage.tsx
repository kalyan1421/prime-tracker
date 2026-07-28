import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, CardBody, Input, Select, SelectItem, Chip, Button,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, addToast,
} from '@heroui/react';
import { FiSearch, FiFilter, FiPackage, FiExternalLink, FiEdit2 } from 'react-icons/fi';
import { useInventory, useProjects, useUpdateUnitStatus, useCustomOptions } from '../hooks/useApi';
import { fmt, fmtDate } from '../utils/fmt';
import { StatCard, StatusBadge, LoadingState } from '../components/ui';
import { TimeOnMarketBar } from '../components/TimeOnMarketBar';
import { useAuthStore } from '../store/authStore';

const PAGE_SIZE = 20;

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: 'bg-green-100 text-green-800',
  UNDER_CONTRACT: 'bg-blue-100 text-blue-800',
  LEASED: 'bg-teal-100 text-teal-800',
  LEASE_PENDING: 'bg-cyan-100 text-cyan-800',
  OCCUPIED: 'bg-purple-100 text-purple-800',
  SOLD: 'bg-gray-100 text-gray-600',
  UNDER_CONSTRUCTION: 'bg-orange-100 text-orange-800',
};

export default function InventoryPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission('unit:edit');
  const { data: unitStatusOpts = [] } = useCustomOptions('unit_status');
  const { data: unitTypeOpts = [] } = useCustomOptions('unit_type');
  const UNIT_STATUSES = unitStatusOpts.map((o) => o.value);
  const UNIT_STATUS_LABELS: Record<string, string> = Object.fromEntries(unitStatusOpts.map((o) => [o.value, o.label]));

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [page, setPage] = useState(1);

  // Quick-edit status modal
  const { isOpen: isStatusOpen, onOpen: onStatusOpen, onClose: onStatusClose } = useDisclosure();
  const [statusTarget, setStatusTarget] = useState<{ id: string; unitNumber: string; currentStatus: string; newStatus: string } | null>(null);
  const updateUnitStatus = useUpdateUnitStatus();

  const openStatusEdit = (e: React.MouseEvent, u: any) => {
    e.stopPropagation();
    setStatusTarget({ id: u.id, unitNumber: u.unitNumber, currentStatus: u.status, newStatus: u.status });
    onStatusOpen();
  };

  const handleStatusSave = async () => {
    if (!statusTarget || statusTarget.newStatus === statusTarget.currentStatus) { onStatusClose(); return; }
    try {
      await updateUnitStatus.mutateAsync({ id: statusTarget.id, status: statusTarget.newStatus });
      addToast({ title: `Unit ${statusTarget.unitNumber} → ${statusTarget.newStatus.replace(/_/g, ' ')}`, color: 'success' });
      onStatusClose();
      setStatusTarget(null);
    } catch {
      addToast({ title: 'Failed to update status', color: 'danger' });
    }
  };

  const { data: projectsData } = useProjects();
  // Unfiltered fetch for heat-map counts and summary stats — always reflects the full portfolio.
  const { data: allData } = useInventory({
    unitType: typeFilter || undefined,
    projectId: projectFilter || undefined,
  });
  const { data, isLoading } = useInventory({
    status: statusFilter || undefined,
    unitType: typeFilter || undefined,
    projectId: projectFilter || undefined,
    search: search || undefined,
  });

  const projects = (projectsData as any[] | { data: any[] } | undefined);
  const projectList = Array.isArray(projects) ? projects : (projects as any)?.data ?? [];
  const units = (data as any[]) || [];
  const allUnits = (allData as any[]) || [];

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of allUnits) counts[u.status] = (counts[u.status] || 0) + 1;
    return counts;
  }, [allUnits]);

  // Reset to first page whenever the filtered result set changes.
  useEffect(() => { setPage(1); }, [search, statusFilter, typeFilter, projectFilter]);

  const totalPages = Math.max(1, Math.ceil(units.length / PAGE_SIZE));
  const pagedUnits = units.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setTypeFilter('');
    setProjectFilter('');
  };

  const hasFilters = search || statusFilter || typeFilter || projectFilter;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
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
            } ${STATUS_COLORS[s] || 'bg-gray-100 text-gray-800'} hover:opacity-80`}
          >
            <div className="text-2xl font-bold">{statusCounts[s] || 0}</div>
            <div className="text-xs mt-0.5 font-medium">{UNIT_STATUS_LABELS[s] || s.replace(/_/g, ' ')}</div>
          </button>
        ))}
      </div>

      {/* Summary stat */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Units" value={allUnits.length.toString()} />
        <StatCard label="Available" value={(statusCounts['AVAILABLE'] || 0).toString()} colorScheme="green" />
        <StatCard label="Occupied / Leased" value={((statusCounts['OCCUPIED'] || 0) + (statusCounts['LEASED'] || 0)).toString()} colorScheme="teal" />
        <StatCard label="Sold" value={(statusCounts['SOLD'] || 0).toString()} />
      </div>

      {/* Filters */}
      <Card shadow="sm" className="mb-4">
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex gap-3 items-end">
            <div className="w-full lg:flex-1 lg:min-w-48">
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
              className="w-full sm:w-44"
              selectedKeys={statusFilter ? [statusFilter] : []}
              onSelectionChange={(keys) => setStatusFilter(Array.from(keys)[0] as string || '')}
            >
              {unitStatusOpts.map((o) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              placeholder="All Types"
              className="w-full sm:w-44"
              selectedKeys={typeFilter ? [typeFilter] : []}
              onSelectionChange={(keys) => setTypeFilter(Array.from(keys)[0] as string || '')}
            >
              {unitTypeOpts.map((o) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              placeholder="All Projects"
              className="w-full sm:w-52"
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
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[900px]">
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
                {pagedUnits.map((u: any) => {
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
                      <td className="py-2 px-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={u.status} />
                            {canEdit && (
                              <button
                                onClick={(e) => openStatusEdit(e, u)}
                                className="text-gray-400 hover:text-gray-600 transition-colors"
                                title="Update status"
                              >
                                <FiEdit2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          {/* Slice 4: time-on-market shown only for AVAILABLE units */}
                          {u.status === 'AVAILABLE' && u.availableSince && (
                            <TimeOnMarketBar availableSince={u.availableSince} />
                          )}
                        </div>
                      </td>
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
                          onPress={() => navigate(`/projects/${u.building.project.id}/units/${u.id}`)}
                          title="View unit detail"
                        >
                          <FiExternalLink className="text-xs" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2.5 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, units.length)} of {units.length} units
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="flat"
                    isDisabled={page === 1}
                    onPress={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-gray-500 px-2 tabular-nums">
                    Page {page} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="flat"
                    isDisabled={page === totalPages}
                    onPress={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Quick status update modal */}
      <Modal isOpen={isStatusOpen} onClose={onStatusClose} size="sm">
        <ModalContent>
          <ModalHeader>Update Unit Status</ModalHeader>
          <ModalBody>
            {statusTarget && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Unit <strong>{statusTarget.unitNumber}</strong>
                </p>
                <Select
                  size="sm"
                  label="Status"
                  selectedKeys={[statusTarget.newStatus]}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string;
                    if (val) setStatusTarget((s) => s ? { ...s, newStatus: val } : null);
                  }}
                >
                  {unitStatusOpts.map((o) => (
                    <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                  ))}
                </Select>
                <p className="text-xs text-gray-400">To update tenant or buyer details, open the unit and edit the Lease or Sale.</p>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onStatusClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleStatusSave}
              isLoading={updateUnitStatus.isPending}
              isDisabled={!statusTarget || statusTarget.newStatus === statusTarget.currentStatus}
            >
              Update Status
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
