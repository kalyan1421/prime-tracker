import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Chip, Button, useDisclosure } from '@heroui/react';
import { FiHome, FiPackage } from 'react-icons/fi';
import { useInteriorPortfolio } from '../hooks/useApi';
import { fmt } from '../utils/fmt';
import { StatCard, LoadingState, EmptyState } from '../components/ui';
import { INTERIOR_PHASES } from '../constants/interior';
import { InteriorPackagesModal } from '../components/InteriorPackagesModal';

const PHASE_LABEL: Record<string, string> = {
  DESIGN: 'Design', CLIENT_APPROVAL: 'Client Approval', CITY_APPROVAL: 'City Approval',
  PROCUREMENT: 'Procurement', EXECUTION: 'Execution', SNAGGING: 'Snagging', HANDOVER: 'Handover',
};

function phaseColor(phase: string): 'default' | 'primary' | 'success' {
  if (phase === 'HANDOVER') return 'success';
  return INTERIOR_PHASES.indexOf(phase as any) >= 3 ? 'primary' : 'default';
}

export default function InteriorPortfolioPage() {
  const navigate = useNavigate();
  const packages = useDisclosure();
  const { data, isLoading } = useInteriorPortfolio();
  const rows: any[] = Array.isArray(data) ? data : [];

  const summary = useMemo(() => {
    const active = rows.filter((r) => r.status !== 'COMPLETED').length;
    const contract = rows.reduce((s, r) => s + (r.contractValue ?? 0), 0);
    const spend = rows.reduce((s, r) => s + (r.spend ?? 0), 0);
    const dueSoon = rows.filter((r) => r.daysToHandover != null && r.daysToHandover <= 30 && r.status !== 'COMPLETED').length;
    return { active, contract, spend, dueSoon };
  }, [rows]);

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
        <StatCard label="Active fit-outs" value={String(summary.active)} />
        <StatCard label="Contract value" value={fmt(summary.contract)} />
        <StatCard label="Spend to date" value={fmt(summary.spend)} />
        <StatCard label="Handover ≤ 30d" value={String(summary.dueSoon)} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No interior projects" message="Start a fit-out from a unit's detail page." />
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
                  <th className="text-right px-4 py-3">Contract</th>
                  <th className="text-right px-4 py-3">Spend</th>
                  <th className="text-right px-4 py-3">Days to handover</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
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
                    <td className="px-4 py-3 text-right">{r.contractValue != null ? fmt(r.contractValue) : '—'}</td>
                    <td className="px-4 py-3 text-right">{fmt(r.spend ?? 0)}</td>
                    <td className="px-4 py-3 text-right">
                      {r.daysToHandover == null ? '—' : (
                        <span className={r.daysToHandover < 0 ? 'text-red-700' : r.daysToHandover <= 30 ? 'text-orange-700' : ''}>
                          {r.daysToHandover}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
