import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, Chip, Tooltip } from '@heroui/react';
import {
  FiArrowLeft, FiHome, FiUsers, FiDollarSign, FiKey, FiCreditCard, FiFileText, FiClock,
} from 'react-icons/fi';
import {
  useBuilding, useUnits, useLeases, useLoans, useDocuments, useBuildingFinancialSummary,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { fmtDate } from '../utils/fmt';
import { LoadingState, ErrorState, StatCard } from '../components/ui';

// Unit status palette — re-uses the dashboard's status semantics so users only learn one.
const STATUS_FILL: Record<string, string> = {
  AVAILABLE:           'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
  UNDER_CONTRACT:      'bg-indigo-100 text-indigo-700 hover:bg-indigo-200',
  LEASED:              'bg-blue-100 text-blue-700 hover:bg-blue-200',
  LEASE_PENDING:       'bg-sky-100 text-sky-700 hover:bg-sky-200',
  SOLD:                'bg-violet-100 text-violet-700 hover:bg-violet-200',
  OCCUPIED:            'bg-amber-100 text-amber-700 hover:bg-amber-200',
  UNDER_CONSTRUCTION:  'bg-orange-100 text-orange-700 hover:bg-orange-200',
};

const fmtMoney = (n: number) => {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};

/**
 * BuildingDetailPage — per-building analytics + operational view.
 * Pulls from existing endpoints with client-side filters (no new API):
 *   • Building meta from /buildings/:id
 *   • Units filtered by buildingId from /units?projectId=
 *   • Leases joined to unit.buildingId from /leases?projectId=
 *   • Loans filtered by buildingId from /loans?projectId=
 *   • Docs scoped via the new buildingId param on /documents
 */
export default function BuildingDetailPage() {
  const { id: projectId, buildingId } = useParams<{ id: string; buildingId: string }>();

  const { hasPermission } = useAuthStore();
  const canViewBudget = hasPermission('budget:view');

  const { data: building, isLoading: bLoading, error: bError } = useBuilding(buildingId!);
  const { data: allUnits } = useUnits(projectId || '');
  const { data: allLeases } = useLeases(projectId || '');
  const { data: allLoans } = useLoans(projectId || '');
  const { data: docs } = useDocuments({ buildingId });
  const { data: budgetSummary } = useBuildingFinancialSummary(canViewBudget ? (buildingId || '') : '');

  const units = useMemo(() => {
    return ((allUnits as any[]) || []).filter((u) => u.buildingId === buildingId);
  }, [allUnits, buildingId]);

  const leases = useMemo(() => {
    const arr = (allLeases as any[]) || [];
    return arr.filter((l) =>
      l.buildingId === buildingId || (l.unit && l.unit.buildingId === buildingId),
    );
  }, [allLeases, buildingId]);

  const loans = useMemo(() => {
    return ((allLoans as any[]) || []).filter((l) => l.buildingId === buildingId);
  }, [allLoans, buildingId]);

  if (bLoading) return <LoadingState />;
  if (bError || !building) return <ErrorState message="Building not found" />;

  const b = building as any;

  // Aggregates
  const totalUnits = units.length;
  const byStatus: Record<string, number> = {};
  for (const u of units) byStatus[u.status] = (byStatus[u.status] ?? 0) + 1;
  const occupied = (byStatus.LEASED ?? 0) + (byStatus.OCCUPIED ?? 0);
  const occupancyPct = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;
  const sold = byStatus.SOLD ?? 0;
  const available = byStatus.AVAILABLE ?? 0;

  const activeLeases = leases.filter((l: any) => l.status === 'ACTIVE');
  const monthlyRent = activeLeases.reduce((s: number, l: any) => s + Number(l.monthlyRent ?? 0), 0);

  const loanBalance = loans.reduce((s: number, l: any) => s + Number(l.currentBalance ?? l.principalAmt ?? 0), 0);

  // Lease expiration timeline — 24 months of buckets (current month + 24)
  const now = new Date();
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { month: d, label: d.toLocaleString('en-US', { month: 'short' }), year: d.getFullYear(), count: 0 };
  });
  for (const l of activeLeases) {
    const end = new Date(l.leaseEnd);
    const months = (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth());
    if (months >= 0 && months < 24) buckets[months].count += 1;
  }
  const maxExpire = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <Link to={`/projects/${projectId}/buildings`} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <FiArrowLeft /> Back to buildings
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <FiHome className="text-blue-600" /> {b.name}
          </h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 flex-wrap">
            {b.buildingType && (
              <Chip size="sm" variant="flat" className="text-xs">{String(b.buildingType).replace('_', ' ')}</Chip>
            )}
            {b.phase && <span>Phase: <span className="font-medium text-gray-700">{String(b.phase).replace('_', ' ')}</span></span>}
            {b.totalSqft && <span>{Number(b.totalSqft).toLocaleString()} sqft</span>}
            {b.acreage && <span>{Number(b.acreage)} acres</span>}
            {b.stories && <span>{b.stories} stories</span>}
          </div>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Units" value={`${occupied + sold}/${totalUnits}`} helpText={`${sold} sold · ${occupied} leased · ${available} available`} />
        <StatCard label="Occupancy" value={`${occupancyPct}%`} colorScheme={occupancyPct >= 80 ? 'success' : occupancyPct >= 50 ? 'warning' : 'danger'} />
        <StatCard label="Monthly rent" value={fmtMoney(monthlyRent)} helpText={`${activeLeases.length} active lease${activeLeases.length === 1 ? '' : 's'}`} />
        <StatCard label="Loan balance" value={loanBalance > 0 ? fmtMoney(loanBalance) : '—'} helpText={`${loans.length} loan${loans.length === 1 ? '' : 's'}`} />
      </div>

      {/* Budget summary — budget/committed/actual/remaining scoped to this building */}
      {canViewBudget && (
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <FiDollarSign className="text-emerald-600" />
              <p className="font-semibold text-sm text-gray-700">Budget</p>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Budget" value={fmtMoney(Number((budgetSummary as any)?.budgetTotal ?? 0))} />
              <StatCard label="Committed" value={fmtMoney(Number((budgetSummary as any)?.committedTotal ?? 0))} />
              <StatCard label="Actual" value={fmtMoney(Number((budgetSummary as any)?.actualTotal ?? 0))} />
              <StatCard
                label="Remaining"
                value={fmtMoney(Number((budgetSummary as any)?.variance ?? 0))}
                colorScheme={Number((budgetSummary as any)?.variance ?? 0) >= 0 ? 'success' : 'danger'}
              />
            </div>
          </CardBody>
        </Card>
      )}

      {/* Unit grid + Lease timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card shadow="sm" className="lg:col-span-2">
          <CardHeader className="pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FiUsers className="text-blue-600" />
              <p className="font-semibold text-sm text-gray-700">Unit grid</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              {['AVAILABLE', 'LEASED', 'SOLD', 'OCCUPIED', 'UNDER_CONSTRUCTION'].map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <span className={`inline-block w-2 h-2 rounded-sm ${STATUS_FILL[s]?.split(' ')[0] ?? 'bg-gray-200'}`} />
                  {s.replace('_', ' ').toLowerCase()}
                </span>
              ))}
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {units.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No units in this building yet.</div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                {units.map((u: any) => {
                  const klass = STATUS_FILL[u.status] ?? 'bg-gray-100 text-gray-700';
                  return (
                    <Tooltip key={u.id} content={`Unit ${u.unitNumber} · ${u.status.replace('_', ' ')}${u.sqft ? ` · ${u.sqft} sqft` : ''}`}>
                      <Link
                        to={`/projects/${projectId}/units/${u.id}`}
                        className={`block aspect-square rounded text-[10px] font-medium flex items-center justify-center transition-colors ${klass}`}
                        aria-label={`Unit ${u.unitNumber}, ${u.status}`}
                      >
                        {u.unitNumber}
                      </Link>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <FiClock className="text-amber-600" />
              <p className="font-semibold text-sm text-gray-700">Lease expirations (24mo)</p>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {activeLeases.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No active leases.</div>
            ) : (
              <div className="space-y-1">
                {buckets.map((bucket, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="w-12 text-gray-500 tabular-nums shrink-0">
                      {bucket.label} {String(bucket.year).slice(2)}
                    </span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${i < 3 ? 'bg-rose-500' : i < 6 ? 'bg-amber-500' : 'bg-blue-500'}`}
                        style={{ width: `${(bucket.count / maxExpire) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 text-right text-gray-700 tabular-nums">{bucket.count || ''}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Linked loans + Documents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <FiCreditCard className="text-blue-600" />
              <p className="font-semibold text-sm text-gray-700">Linked loans</p>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {loans.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-6">No loans attached to this building.</div>
            ) : (
              <div className="space-y-2">
                {loans.map((l: any) => (
                  <div key={l.id} className="flex items-start justify-between gap-3 py-2 border-b border-gray-100 last:border-b-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{l.lender || 'Encrypted lender'}</p>
                      <p className="text-xs text-gray-500">{l.loanType.replace('_', ' ')}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-gray-900 tabular-nums">{fmtMoney(Number(l.currentBalance ?? l.principalAmt ?? 0))}</p>
                      {l.maturityDate && <p className="text-[10px] text-gray-500">Matures {fmtDate(l.maturityDate)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FiFileText className="text-violet-600" />
              <p className="font-semibold text-sm text-gray-700">Documents</p>
            </div>
            <span className="text-xs text-gray-400 tabular-nums">{((docs as any[]) || []).length}</span>
          </CardHeader>
          <CardBody className="pt-0">
            {!docs || (docs as any[]).length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-6">No documents attached to this building.</div>
            ) : (
              <div className="space-y-1">
                {(docs as any[]).slice(0, 8).map((d: any) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-100 last:border-b-0">
                    <div className="min-w-0 flex items-center gap-2">
                      <FiFileText className="text-gray-400 shrink-0 w-3.5 h-3.5" />
                      <span className="text-sm text-gray-800 truncate">{d.fileName || d.name}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">{fmtDate(d.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
