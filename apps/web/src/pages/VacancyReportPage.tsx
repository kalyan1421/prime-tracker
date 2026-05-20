import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, Button, Select, SelectItem, Tooltip } from '@heroui/react';
import { FiHome, FiClock, FiAlertTriangle, FiDollarSign, FiSearch, FiExternalLink } from 'react-icons/fi';
import { useVacancyReport, useProjects } from '../hooks/useApi';
import { LoadingState, ErrorState, StatCard, EmptyState } from '../components/ui';

const SEVERITY_STYLE: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  critical: { bg: 'bg-rose-50',   text: 'text-rose-700',   dot: 'bg-rose-500',   label: 'Critical' },
  warning:  { bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500',  label: 'Warning'  },
  info:     { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Fresh'    },
};

const MIN_DAYS_OPTIONS = [
  { v: '0',   label: 'All available' },
  { v: '30',  label: '30+ days' },
  { v: '60',  label: '60+ days' },
  { v: '90',  label: '90+ days (warning)' },
  { v: '180', label: '180+ days (critical)' },
];

const fmtMoney = (n: number) => {
  if (!n) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};

/**
 * Vacancy report — every AVAILABLE unit in the portfolio (or scoped to one project),
 * ranked by time-on-market. Color-graded severity: emerald (<90d), amber (90-180d),
 * rose (180d+). Click any row to jump to UnitDetailPage for context + actions.
 */
export default function VacancyReportPage() {
  const [projectId, setProjectId] = useState('');
  const [minDays, setMinDays] = useState('0');
  const { data: projects } = useProjects();
  const { data, isLoading, error } = useVacancyReport({
    projectId: projectId || undefined,
    minDays: minDays !== '0' ? parseInt(minDays, 10) : undefined,
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load vacancy report" />;
  if (!data) return null;

  const { totals, rows } = data as { totals: any; rows: any[] };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
            <FiHome className="text-blue-600" /> Vacancy report
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Available units ranked by time-on-market. Stale &gt; 90d (warning), &gt; 180d (critical).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            size="sm"
            placeholder="All projects"
            selectedKeys={projectId ? new Set([projectId]) : new Set()}
            onSelectionChange={(k) => setProjectId((Array.from(k)[0] as string) || '')}
            className="min-w-[180px]"
            aria-label="Filter by project"
          >
            {((projects as any[]) || []).map((p: any) => <SelectItem key={p.id}>{p.name}</SelectItem>)}
          </Select>
          <Select
            size="sm"
            selectedKeys={new Set([minDays])}
            onSelectionChange={(k) => setMinDays((Array.from(k)[0] as string) || '0')}
            className="min-w-[200px]"
            aria-label="Filter by minimum days on market"
          >
            {MIN_DAYS_OPTIONS.map((o) => <SelectItem key={o.v}>{o.label}</SelectItem>)}
          </Select>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Vacant units" value={totals.units.toString()} />
        <StatCard label="Critical (180d+)" value={totals.critical.toString()} colorScheme={totals.critical > 0 ? 'danger' : 'gray'} />
        <StatCard label="Warning (90-180d)" value={totals.warning.toString()} colorScheme={totals.warning > 0 ? 'warning' : 'gray'} />
        <StatCard label="Asking value" value={fmtMoney(totals.askingValue)} />
      </div>

      {/* Vacancy table */}
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <p className="font-semibold text-sm text-gray-700">Available units ranked by time-on-market</p>
        </CardHeader>
        <CardBody className="pt-0 overflow-x-auto">
          {rows.length === 0 ? (
            <EmptyState
              title="No vacant units match"
              message={minDays !== '0' ? 'Try lowering the days filter.' : 'No available units in scope — clean inventory.'}
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left py-2 pr-3 w-24">Severity</th>
                  <th className="text-left py-2 pr-3">Unit</th>
                  <th className="text-left py-2 pr-3">Building</th>
                  <th className="text-left py-2 pr-3">Project</th>
                  <th className="text-left py-2 pr-3">Type</th>
                  <th className="text-right py-2 pr-3">Sqft</th>
                  <th className="text-right py-2 pr-3">Asking</th>
                  <th className="text-right py-2 pr-3">Available since</th>
                  <th className="text-right py-2 pr-3">Days</th>
                  <th className="text-right py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = SEVERITY_STYLE[r.severity] ?? SEVERITY_STYLE.info;
                  return (
                    <tr key={r.unitId} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${s.bg} ${s.text}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
                          {s.label}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-medium text-gray-900">{r.unitNumber}</td>
                      <td className="py-2 pr-3 text-gray-700">{r.buildingName}</td>
                      <td className="py-2 pr-3">
                        <Link to={`/projects/${r.projectId}`} className="text-blue-600 hover:underline">{r.projectName}</Link>
                      </td>
                      <td className="py-2 pr-3 text-gray-600 text-xs">{r.unitType.replace('_', ' ')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{r.sqft ?? '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.askingPrice ? fmtMoney(r.askingPrice) : (r.askingRent ? `${fmtMoney(r.askingRent)}/mo` : '—')}
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-500 text-xs tabular-nums">
                        {new Date(r.availableSince).toLocaleDateString()}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">
                        <span className={r.severity === 'critical' ? 'text-rose-600' : r.severity === 'warning' ? 'text-amber-600' : 'text-gray-700'}>
                          {r.daysOnMarket}d
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <Tooltip content="Open unit">
                          <Link to={`/projects/${r.projectId}/units/${r.unitId}`} aria-label="Open unit detail">
                            <Button isIconOnly size="sm" variant="light" className="min-w-8 w-8 h-8">
                              <FiExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        </Tooltip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
