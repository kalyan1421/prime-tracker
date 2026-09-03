import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Chip, Button, Input, Select, SelectItem, useDisclosure } from '@heroui/react';
import { FiHome, FiPackage, FiSearch, FiX } from 'react-icons/fi';
import { useInteriorPortfolio } from '../hooks/useApi';
import { fmt } from '../utils/fmt';
import { StatCard, LoadingState, EmptyState, Pagination } from '../components/ui';
import { INTERIOR_PHASES } from '../constants/interior';
import { InteriorPackagesModal } from '../components/InteriorPackagesModal';
import { useAuthStore } from '../store/authStore';
import { usePagination } from '../hooks/usePagination';
import { useDebounced } from '../hooks/useDebounced';

const PHASE_LABEL: Record<string, string> = {
  DESIGN: 'Design', CLIENT_APPROVAL: 'Client Approval', CITY_APPROVAL: 'City Approval',
  PROCUREMENT: 'Procurement', EXECUTION: 'Execution', SNAGGING: 'Snagging', HANDOVER: 'Handover',
};

const STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'] as const;

/**
 * Sort options. `targetEnd` first because it is the one that answers "what needs me next",
 * and it is what the API already orders by — so the default view is unchanged from before
 * sorting existed.
 */
const SORTS = [
  { key: 'target', label: 'Handover date' },
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'phase', label: 'Phase' },
  { key: 'contract', label: 'Contract value' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

const PAGE_SIZE = 25;

function phaseColor(phase: string): 'default' | 'primary' | 'success' {
  if (phase === 'HANDOVER') return 'success';
  return INTERIOR_PHASES.indexOf(phase as never) >= 3 ? 'primary' : 'default';
}

/** Everything a search query should be able to match on one row. */
function haystack(r: any): string {
  return [
    r.name,
    r.unit?.unitNumber ? `unit ${r.unit.unitNumber}` : '',
    r.building?.name,
    r.pm?.name,
    PHASE_LABEL[r.phase] ?? r.phase,
  ].filter(Boolean).join(' ').toLowerCase();
}

export default function InteriorPortfolioPage() {
  const navigate = useNavigate();
  const packages = useDisclosure();
  const { hasPermission } = useAuthStore();
  // The API nulls contractValue/spend for a caller without interior:finance (the same
  // "Construction is fully blind to financials" design this app applies everywhere
  // else) — hide the money UI rather than show a misleading $0/— built from null.
  const canViewFinance = hasPermission('interior:finance');
  const { data, isLoading } = useInteriorPortfolio();
  const rows: any[] = Array.isArray(data) ? data : [];

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [phaseFilter, setPhaseFilter] = useState('ALL');
  const [pmFilter, setPmFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('target');

  /** PMs actually present on the data — a fixed user list would offer empty filters. */
  const pms = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.pm?.id) seen.set(r.pm.id, r.pm.name ?? r.pm.id);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (phaseFilter !== 'ALL' && r.phase !== phaseFilter) return false;
      if (pmFilter !== 'ALL' && (pmFilter === 'UNASSIGNED' ? !!r.pm?.id : r.pm?.id !== pmFilter)) return false;
      if (q && !haystack(r).includes(q)) return false;
      return true;
    });

    // A missing targetEnd sorts last rather than first: "no date set" is not "due soonest".
    const byTarget = (a: any, b: any) => {
      const at = a.targetEnd ? new Date(a.targetEnd).getTime() : Infinity;
      const bt = b.targetEnd ? new Date(b.targetEnd).getTime() : Infinity;
      return at - bt;
    };
    const cmp: Record<SortKey, (a: any, b: any) => number> = {
      target: byTarget,
      name: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
      phase: (a, b) => INTERIOR_PHASES.indexOf(a.phase) - INTERIOR_PHASES.indexOf(b.phase) || byTarget(a, b),
      contract: (a, b) => (Number(b.contractValue ?? 0)) - (Number(a.contractValue ?? 0)),
    };
    return out.slice().sort(cmp[sortKey]);
  }, [rows, debouncedSearch, statusFilter, phaseFilter, pmFilter, sortKey]);

  const { page, setPage, totalPages, paged, total } = usePagination(
    filtered,
    PAGE_SIZE,
    [debouncedSearch, statusFilter, phaseFilter, pmFilter, sortKey],
  );

  /**
   * Summary reflects the FILTERED set, not the whole portfolio — filtering to one PM and
   * reading their contract book is the main reason to filter at all, and totals that
   * ignored the filter would contradict the rows directly beneath them.
   */
  const summary = useMemo(() => {
    const active = filtered.filter((r) => r.status !== 'COMPLETED').length;
    const contract = filtered.reduce((s, r) => s + (r.contractValue ?? 0), 0);
    const spend = filtered.reduce((s, r) => s + (r.spend ?? 0), 0);
    const dueSoon = filtered.filter(
      (r) => r.daysToHandover != null && r.daysToHandover <= 30 && r.status !== 'COMPLETED',
    ).length;
    return { active, contract, spend, dueSoon };
  }, [filtered]);

  const isFiltered =
    !!debouncedSearch.trim() || statusFilter !== 'ALL' || phaseFilter !== 'ALL' || pmFilter !== 'ALL';
  const clearFilters = () => {
    setSearch(''); setStatusFilter('ALL'); setPhaseFilter('ALL'); setPmFilter('ALL');
  };

  if (isLoading) return <LoadingState message="Loading interior projects…" />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <FiHome className="text-2xl text-amber-600" />
          <h1 className="text-2xl font-bold">Interior / Fit-Out Portfolio</h1>
        </div>
        <Button size="sm" variant="flat" startContent={<FiPackage />} onPress={packages.onOpen}>
          Manage packages
        </Button>
      </div>
      <InteriorPackagesModal isOpen={packages.isOpen} onClose={packages.onClose} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={isFiltered ? 'Active (filtered)' : 'Active fit-outs'} value={String(summary.active)} />
        {canViewFinance && <StatCard label="Contract value" value={fmt(summary.contract)} />}
        {canViewFinance && <StatCard label="Spend to date" value={fmt(summary.spend)} />}
        <StatCard label="Handover ≤ 30d" value={String(summary.dueSoon)} />
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-end gap-2">
        <Input
          size="sm"
          aria-label="Search fit-outs"
          placeholder="Search name, unit, building or PM…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          startContent={<FiSearch size={14} className="text-gray-500" />}
          className="flex-1 min-w-[220px]"
        />
        <Select
          size="sm" name="status" aria-label="Status" label="Status" className="w-40"
          selectedKeys={[statusFilter]}
          onChange={(e) => setStatusFilter(e.target.value || 'ALL')}
        >
          <SelectItem key="ALL" textValue="All statuses">All statuses</SelectItem>
          <>{STATUSES.map((s) => (
            <SelectItem key={s} textValue={s.replace('_', ' ')}>{s.replace('_', ' ')}</SelectItem>
          ))}</>
        </Select>
        <Select
          size="sm" name="phase" aria-label="Phase" label="Phase" className="w-44"
          selectedKeys={[phaseFilter]}
          onChange={(e) => setPhaseFilter(e.target.value || 'ALL')}
        >
          <SelectItem key="ALL" textValue="All phases">All phases</SelectItem>
          <>{INTERIOR_PHASES.map((p) => (
            <SelectItem key={p} textValue={PHASE_LABEL[p]}>{PHASE_LABEL[p]}</SelectItem>
          ))}</>
        </Select>
        <Select
          size="sm" name="pm" aria-label="Project manager" label="PM" className="w-44"
          selectedKeys={[pmFilter]}
          onChange={(e) => setPmFilter(e.target.value || 'ALL')}
        >
          <SelectItem key="ALL" textValue="All PMs">All PMs</SelectItem>
          <SelectItem key="UNASSIGNED" textValue="Unassigned">Unassigned</SelectItem>
          <>{pms.map((u) => (
            <SelectItem key={u.id} textValue={u.name}>{u.name}</SelectItem>
          ))}</>
        </Select>
        <Select
          size="sm" name="sort" aria-label="Sort by" label="Sort by" className="w-40"
          selectedKeys={[sortKey]}
          onChange={(e) => setSortKey((e.target.value || 'target') as SortKey)}
        >
          {SORTS.map((s) => (
            <SelectItem key={s.key} textValue={s.label}>{s.label}</SelectItem>
          ))}
        </Select>
        {isFiltered && (
          <Button size="sm" variant="light" startContent={<FiX size={13} />} onPress={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No interior projects"
          message="Start a fit-out from a unit's detail page, or from a building for a whole-floor or common-area fit-out."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No fit-outs match these filters"
          message="Cancelled fit-outs are never listed here. Clear the filters to see the full portfolio."
        />
      ) : (
        <Card shadow="sm">
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Project</th>
                  <th className="text-left px-4 py-3">Location</th>
                  <th className="text-left px-4 py-3">PM</th>
                  <th className="text-left px-4 py-3">Phase</th>
                  {canViewFinance && <th className="text-right px-4 py-3">Contract</th>}
                  {canViewFinance && <th className="text-right px-4 py-3">Spend</th>}
                  <th className="text-right px-4 py-3">Days to handover</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-gray-100 cursor-pointer hover:bg-gray-50"
                    onClick={() => navigate(`/interior/${r.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-blue-600">{r.name}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {r.unit?.unitNumber ? `Unit ${r.unit.unitNumber}` : r.building?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.pm?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Chip size="sm" variant="flat" color={phaseColor(r.phase)}>
                        {PHASE_LABEL[r.phase] ?? r.phase}
                      </Chip>
                    </td>
                    {canViewFinance && <td className="px-4 py-3 text-right">{r.contractValue != null ? fmt(r.contractValue) : '—'}</td>}
                    {canViewFinance && <td className="px-4 py-3 text-right">{fmt(r.spend ?? 0)}</td>}
                    <td className="px-4 py-3 text-right">
                      {/* A handed-over fit-out has no countdown left to run — showing one
                          reads as an overdue job that is in fact finished. */}
                      {r.status === 'COMPLETED' ? (
                        <span className="text-gray-500">done</span>
                      ) : r.daysToHandover == null ? '—' : (
                        <span className={r.daysToHandover < 0 ? 'text-red-700' : r.daysToHandover <= 30 ? 'text-orange-700' : ''}>
                          {r.daysToHandover < 0 ? `${Math.abs(r.daysToHandover)}d overdue` : `${r.daysToHandover}d`}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel="fit-outs"
              onPrev={() => setPage((p) => p - 1)}
              onNext={() => setPage((p) => p + 1)}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
