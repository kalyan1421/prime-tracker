import { useState, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, CardBody, Input, Select, SelectItem, Chip, Button,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, addToast,
} from '@heroui/react';
import { FiSearch, FiFilter, FiPackage, FiExternalLink, FiEdit2 } from 'react-icons/fi';
import { useInventory, useProjects, useUpdateUnitStatus, useCustomOptions } from '../hooks/useApi';
import { fmt, fmtDate } from '../utils/fmt';
import { StatusBadge, LoadingState, Pagination } from '../components/ui';
import { usePagination } from '../hooks/usePagination';
import { groupUnitsByCombinedDeal } from '../utils/tenancy';
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
  // Matches the same fix already applied to the per-project Units tab: Asking Rent
  // needs lease:view, Asking Price needs sales:view — unit:view alone (all this page
  // requires) must not carry the money along for the ride.
  const canSeeRentColumn = hasPermission('lease:view');
  const canSeePriceColumns = hasPermission('sales:view');
  const { data: unitStatusOpts = [] } = useCustomOptions('unit_status');
  const { data: unitTypeOpts = [] } = useCustomOptions('unit_type');
  const UNIT_STATUSES = unitStatusOpts.map((o) => o.value);
  const UNIT_STATUS_LABELS: Record<string, string> = Object.fromEntries(unitStatusOpts.map((o) => [o.value, o.label]));

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  /** Which multi-unit letting is expanded. One at a time, as on the project Units tab. */
  const [openDeal, setOpenDeal] = useState<string | null>(null);
  

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

  // usePagination owns the page clamp and the reset-on-filter-change that used to be a
  // hand-rolled useState + useEffect here — the one list left out of the August pass.
  const { page, setPage, totalPages, paged: pagedUnits } = usePagination(units, PAGE_SIZE, [
    search, statusFilter, typeFilter, projectFilter,
  ]);
  // Paginate on UNITS first, then group — the same deliberate order the Site Tracker uses,
  // so a page always holds PAGE_SIZE units however they happen to be let.
  const unitGroups = groupUnitsByCombinedDeal(pagedUnits);

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
          <p className="text-sm text-gray-500 mt-0.5">All units across all projects · {allUnits.length.toLocaleString()} total</p>
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
            <div className="text-center py-10 text-gray-500">
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
                  {canSeeRentColumn && <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Asking Rent</th>}
                  {canSeePriceColumns && <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Asking Price</th>}
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  {(canSeeRentColumn || canSeePriceColumns) && <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Tenant / Buyer</th>}
                  <th className="py-2 px-3" />
                </tr>
              </thead>
              <tbody>
                {unitGroups.map((g: any) => (
                  <Fragment key={g.ref ?? g.units[0].id}>
                  {/* Units let under ONE lease collapse to a single row that opens to them.
                      Inventory, so no unit is ever hidden — only folded. */}
                  {g.isGroup && (
                    <tr
                      className={`border-b border-gray-100 cursor-pointer ${openDeal === g.ref ? 'bg-blue-50/40' : 'bg-gray-50/60'}`}
                      onClick={() => setOpenDeal((cur: string | null) => (cur === g.ref ? null : g.ref))}
                    >
                      <td className="py-2 px-3 font-medium">{g.unitLabel}</td>
                      <td className="py-2 px-3 text-xs text-gray-600">{g.units[0].building?.project?.name}</td>
                      <td className="py-2 px-3 text-xs text-gray-600">{g.units[0].building?.name}</td>
                      <td className="py-2 px-3">
                        <Chip
                          size="sm"
                          variant="flat"
                          color={g.dealKind === 'SALE' ? 'success' : 'primary'}
                          className="text-[11px]"
                        >
                          {g.units.length} units {g.dealKind === 'SALE' ? 'sold' : 'leased'} together
                        </Chip>
                      </td>
                      <td className="py-2 px-3">
                        {g.units.some((u: any) => u.sqft != null)
                          ? g.units.reduce((sum: number, u: any) => sum + (u.sqft ?? 0), 0).toLocaleString()
                          : '\u2014'}
                      </td>
                      {canSeeRentColumn && <td className="py-2 px-3" />}
                      {canSeePriceColumns && <td className="py-2 px-3" />}
                      <td className="py-2 px-3"><StatusBadge status={g.units[0].status} /></td>
                      {(canSeeRentColumn || canSeePriceColumns) && (
                        <td className="py-2 px-3">{g.partyName || '\u2014'}</td>
                      )}
                      <td className="py-2 px-3" />
                    </tr>
                  )}
                  {(!g.isGroup || openDeal === g.ref) && g.units.map((u: any) => {
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
                      {canSeeRentColumn && <td className="py-2 px-3">{u.askingRent ? `${fmt(u.askingRent)}/mo` : '—'}</td>}
                      {canSeePriceColumns && <td className="py-2 px-3">{u.askingPrice ? fmt(u.askingPrice) : '—'}</td>}
                      <td className="py-2 px-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={u.status} />
                            {canEdit && (
                              <button
                                onClick={(e) => openStatusEdit(e, u)}
                                className="text-gray-500 hover:text-gray-600 transition-colors"
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
                      {(canSeeRentColumn || canSeePriceColumns) && (
                        <td className="py-2 px-3 text-xs text-gray-600">
                          {canSeeRentColumn && activeLease ? (
                            <div>
                              <div className="font-medium">{activeLease.tenantName}</div>
                              <div className="text-gray-500">until {fmtDate(activeLease.leaseEnd)}</div>
                            </div>
                          ) : canSeePriceColumns && activeSale ? (
                            <div>
                              <div className="font-medium">{activeSale.buyer || '—'}</div>
                              <div className="text-gray-500">{activeSale.status.replace(/_/g, ' ')}</div>
                            </div>
                          ) : '—'}
                        </td>
                      )}
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
                  </Fragment>
                ))}
              </tbody>
            </table></div>
            {/* The shared control, so this list counts and clamps like every other one. */}
            <div className="px-3 py-2.5 border-t border-gray-100">
              <Pagination
                page={page}
                totalPages={totalPages}
                onPrev={() => setPage(page - 1)}
                onNext={() => setPage(page + 1)}
                total={units.length}
                pageSize={PAGE_SIZE}
                itemLabel="units"
              />
            </div>
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
                <p className="text-xs text-gray-500">To update tenant or buyer details, open the unit and edit the Lease or Sale.</p>
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
