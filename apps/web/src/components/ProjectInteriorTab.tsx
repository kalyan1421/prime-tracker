/**
 * ProjectInteriorTab — every fit-out belonging to one project, on the project page.
 *
 * Fit-outs were previously reachable only from the cross-project /interior portfolio or
 * from a single unit, so someone working inside a project had no way to see how many fit-outs
 * it carried, what phase they were in, or which unit each one belonged to. The rows are
 * anchored to their unit or building so the hierarchy stays visible.
 *
 * Money (contract value) is nulled server-side for anyone without `interior:finance`, so the
 * column is hidden rather than rendered as a misleading dash.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardBody, Chip } from '@heroui/react';
import { FiHome } from 'react-icons/fi';
import { useInteriorProjects } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { fmt, fmtDate } from '../utils/fmt';
import { LoadingState, EmptyState, Pagination } from './ui';
import { usePagination } from '../hooks/usePagination';
import { INTERIOR_PHASES } from '../constants/interior';

const PHASE_LABEL: Record<string, string> = {
  DESIGN: 'Design', CLIENT_APPROVAL: 'Client Approval', CITY_APPROVAL: 'City Approval',
  PROCUREMENT: 'Procurement', EXECUTION: 'Execution', SNAGGING: 'Snagging', HANDOVER: 'Handover',
};

const STATUS_COLOR: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
  NOT_STARTED: 'default', IN_PROGRESS: 'primary', ON_HOLD: 'warning',
  COMPLETED: 'success', CANCELLED: 'danger',
};

const PAGE_SIZE = 20;

function phaseColor(phase: string): 'default' | 'primary' | 'success' {
  if (phase === 'HANDOVER') return 'success';
  return INTERIOR_PHASES.indexOf(phase as never) >= 3 ? 'primary' : 'default';
}

export function ProjectInteriorTab({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuthStore();
  const canViewFinance = hasPermission('interior:finance');
  const { data, isLoading } = useInteriorProjects({ projectId });
  const rows: any[] = Array.isArray(data) ? data : [];
  // Same list-scale pattern as every other list in the app. Pagination renders nothing
  // below one page, so a project with three fit-outs looks exactly as it did.
  const { page, setPage, totalPages, paged, total } = usePagination(rows, PAGE_SIZE);

  const summary = useMemo(() => {
    const active = rows.filter((r) => r.status !== 'COMPLETED' && r.status !== 'CANCELLED').length;
    const openSnags = rows.reduce((n, r) => n + (r._count?.snags ?? 0), 0);
    return { active, openSnags };
  }, [rows]);

  if (isLoading) return <LoadingState message="Loading fit-outs…" />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No fit-outs on this project"
        message="Start one from a unit's detail page, or from a building for a whole-floor or common-area fit-out."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <span className="flex items-center gap-1.5 font-medium text-gray-700">
          <FiHome className="text-amber-600" /> {rows.length} fit-out{rows.length === 1 ? '' : 's'}
        </span>
        <span>{summary.active} active</span>
        <Link to="/interior" className="text-blue-600 hover:underline ml-auto">Full portfolio →</Link>
      </div>

      <Card shadow="none" className="border border-gray-200/80 rounded-xl">
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Fit-out</th>
                <th className="text-left px-4 py-3">Location</th>
                <th className="text-left px-4 py-3">PM</th>
                <th className="text-left px-4 py-3">Phase</th>
                <th className="text-left px-4 py-3">Status</th>
                {canViewFinance && <th className="text-right px-4 py-3">Contract</th>}
                <th className="text-right px-4 py-3">Snags</th>
                <th className="text-right px-4 py-3">Target</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => {
                const buildingId = r.building?.id ?? r.unit?.building?.id;
                const buildingName = r.building?.name ?? r.unit?.building?.name;
                return (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link to={`/interior/${r.id}`} className="font-medium text-blue-600 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {r.unit?.id ? (
                        <Link to={`/projects/${projectId}/units/${r.unit.id}`} className="text-blue-600 hover:underline">
                          Unit {r.unit.unitNumber}
                        </Link>
                      ) : buildingId ? (
                        <Link to={`/projects/${projectId}/buildings/${buildingId}`} className="text-blue-600 hover:underline">
                          {buildingName}
                        </Link>
                      ) : '—'}
                      {r.unit?.id && buildingName && (
                        <span className="text-gray-500"> · {buildingName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.pm?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Chip size="sm" variant="flat" color={phaseColor(r.phase)}>
                        {PHASE_LABEL[r.phase] ?? r.phase}
                      </Chip>
                    </td>
                    <td className="px-4 py-3">
                      <Chip size="sm" variant="flat" color={STATUS_COLOR[r.status] ?? 'default'}>{r.status}</Chip>
                    </td>
                    {canViewFinance && (
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.contractValue != null ? fmt(Number(r.contractValue)) : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">{r._count?.snags ?? 0}</td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {r.targetEnd ? fmtDate(r.targetEnd) : '—'}
                    </td>
                  </tr>
                );
              })}
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
    </div>
  );
}
