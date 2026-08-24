import { useState } from 'react';
import { Card, CardBody, CardHeader, Tooltip } from '@heroui/react';
import { FiAlertCircle } from 'react-icons/fi';
import { useBudgetObligations } from '../hooks/useApi';
import { fmt } from '../utils/fmt';

// Mirrors the engine's five outflow categories (the client's budget lines).
const CATS: { key: string; label: string; dot: string; chip: string }[] = [
  { key: 'loanPayments', label: 'Loan Payments', dot: 'bg-indigo-500', chip: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  { key: 'subcontractorAP', label: 'Sub-contractor AP', dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 border-orange-100' },
  { key: 'interiorTI', label: 'TI / Interior', dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 border-teal-100' },
  { key: 'commissions', label: 'Commissions', dot: 'bg-purple-500', chip: 'bg-purple-50 text-purple-700 border-purple-100' },
  { key: 'misc', label: 'Miscellaneous', dot: 'bg-gray-400', chip: 'bg-gray-50 text-gray-600 border-gray-200' },
];

const GRANULARITIES = [
  { key: 'month', label: 'Monthly' },
  { key: 'quarter', label: 'Quarterly' },
  { key: 'year', label: 'Annually' },
] as const;

type Granularity = (typeof GRANULARITIES)[number]['key'];

export function ObligationsPanel({ projectId }: { projectId?: string }) {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const { data, isLoading } = useBudgetObligations(projectId, granularity);

  const d = data as any;
  const periods: any[] = d?.periods ?? [];
  const outstanding: Record<string, number> = d?.outstandingByCategory ?? {};
  const activeCats = CATS.filter((c) => (outstanding[c.key] ?? 0) > 0);
  const hasData = periods.some((p) => p.total > 0);

  return (
    <Card shadow="sm">
      <CardHeader className="pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <p className="font-semibold text-sm text-gray-700">Budget — Cash Needs</p>
          <p className="text-xs text-gray-500">Upcoming obligations by category. Outflow projection, not actuals.</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
          {GRANULARITIES.map((g) => (
            <button
              key={g.key}
              onClick={() => setGranularity(g.key)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                granularity === g.key ? 'bg-white shadow-sm text-gray-800' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="h-40 animate-pulse bg-gray-50 rounded-xl" />
        ) : !hasData ? (
          <p className="text-sm text-gray-500 py-8 text-center">No upcoming obligations in this horizon.</p>
        ) : (
          <div className="space-y-4">
            {/* headline: budget needed now + total outstanding */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Tooltip content="Payables owed in the near term — vendor AP, interior invoices, commissions, and the next loan payment.">
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                  <p className="text-xs text-amber-700 font-medium flex items-center gap-1"><FiAlertCircle size={12} /> Budget needed now</p>
                  <p className="text-lg font-bold text-amber-800 mt-0.5 tabular-nums">{fmt(d?.immediatePayables ?? 0)}</p>
                </div>
              </Tooltip>
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                <p className="text-xs text-gray-500 font-medium">Total outstanding</p>
                <p className="text-lg font-bold text-gray-800 mt-0.5 tabular-nums">{fmt(d?.outstandingTotal ?? 0)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                <p className="text-xs text-gray-500 font-medium">Horizon</p>
                <p className="text-lg font-bold text-gray-800 mt-0.5 tabular-nums">{d?.horizonMonths ?? 12} mo</p>
              </div>
            </div>

            {/* outstanding by category */}
            <div className="flex flex-wrap gap-2">
              {activeCats.map((c) => (
                <span key={c.key} className={`text-xs px-2.5 py-1 rounded-full border font-medium tabular-nums ${c.chip}`}>
                  {c.label}: {fmt(outstanding[c.key])}
                </span>
              ))}
            </div>

            {/* category × period table */}
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-xs min-w-[480px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[11px]">
                    <th className="text-left px-3 py-2 font-medium sticky left-0 bg-gray-50">Category</th>
                    {periods.map((p) => (
                      <th key={p.key} className="text-right px-3 py-2 font-medium whitespace-nowrap">{p.label}</th>
                    ))}
                    <th className="text-right px-3 py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {activeCats.map((c) => (
                    <tr key={c.key} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-700 sticky left-0 bg-white">
                        <span className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-sm ${c.dot}`} /> {c.label}</span>
                      </td>
                      {periods.map((p) => (
                        <td key={p.key} className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {p.byCategory[c.key] > 0 ? fmt(p.byCategory[c.key]) : '—'}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-800">{fmt(outstanding[c.key])}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-gray-600 sticky left-0 bg-gray-50">Total</td>
                    {periods.map((p) => (
                      <td key={p.key} className="px-3 py-2 text-right tabular-nums text-gray-800">{p.total > 0 ? fmt(p.total) : '—'}</td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmt(d?.outstandingTotal ?? 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
