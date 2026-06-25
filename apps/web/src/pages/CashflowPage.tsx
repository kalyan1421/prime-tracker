import { useMemo, useState } from 'react';
import { Card, CardBody, CardHeader } from '@heroui/react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import {
  FiTrendingUp, FiTrendingDown, FiDollarSign, FiActivity, FiDownloadCloud,
} from 'react-icons/fi';
import { useCashflowPortfolio } from '../hooks/useApi';
import { fmt } from '../utils/fmt';
import { LoadingState, ErrorState, EmptyState } from '../components/ui';

// ── horizon options ──────────────────────────────────────────────────────────
const HORIZONS = [
  { months: 6, label: '6 mo' },
  { months: 12, label: '12 mo' },
  { months: 24, label: '24 mo' },
];

// ── outflow category styling (matches the 5 budget categories) ─────────────────
const OUTFLOW_CATS: { key: string; label: string; color: string }[] = [
  { key: 'loanPayments', label: 'Loan Payments', color: '#6366f1' },
  { key: 'subcontractorAP', label: 'Sub-contractor AP', color: '#f97316' },
  { key: 'interiorTI', label: 'TI / Interior', color: '#14b8a6' },
  { key: 'commissions', label: 'Commissions', color: '#a855f7' },
  { key: 'misc', label: 'Miscellaneous', color: '#94a3b8' },
];
const INFLOW_COLOR = '#10b981';
const OUTFLOW_COLOR = '#f43f5e';
const CUM_COLOR = '#6366f1';

const fmtMonth = (m: string) => {
  const [y, mm] = m.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(mm, 10) - 1]} ${y.slice(2)}`;
};
const kAxis = (v: number) => `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`;

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 min-w-[180px] text-xs">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      <Row color="text-emerald-600" dot="bg-emerald-500" label="Inflow" value={row.inflow} />
      <Row color="text-rose-600" dot="bg-rose-500" label="Outflow" value={row.outflow} />
      <div className="border-t border-gray-100 mt-1 pt-1">
        <Row color="text-indigo-600" dot="bg-indigo-500" label="Net" value={row.net} signed />
        <Row color="text-gray-600" dot="bg-gray-400" label="Cumulative" value={row.cumulative} signed />
      </div>
    </div>
  );
}
function Row({ color, dot, label, value, signed }: any) {
  const v = Number(value ?? 0);
  return (
    <div className="flex justify-between gap-4">
      <span className={`flex items-center gap-1 ${color}`}>
        <span className={`inline-block w-2 h-2 rounded-sm ${dot}`} /> {label}
      </span>
      <span className="tabular-nums font-medium text-gray-800">{signed && v >= 0 ? '+' : ''}{fmt(v)}</span>
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: 'emerald' | 'rose' | 'indigo' | 'gray' }) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    rose: 'bg-rose-50 border-rose-100 text-rose-700',
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-medium flex items-center gap-1.5 opacity-80">{icon} {label}</p>
      <p className="text-xl font-bold mt-1 tabular-nums">{value}</p>
    </div>
  );
}

export default function CashflowPage() {
  const [months, setMonths] = useState(12);
  const { data, isLoading, error } = useCashflowPortfolio(months);

  const rows = useMemo(() => {
    const monthly = (data as any)?.monthly ?? [];
    return monthly.map((m: any) => ({
      month: m.month,
      label: fmtMonth(m.month),
      inflow: Number(m.inflows ?? 0),
      outflow: Number(m.outflows ?? 0),
      net: Number(m.net ?? 0),
      cumulative: Number(m.cumulative ?? 0),
      ...Object.fromEntries(OUTFLOW_CATS.map((c) => [c.key, Number(m.outflowsByCategory?.[c.key] ?? 0)])),
    }));
  }, [data]);

  const summary = (data as any)?.summary ?? {};
  const activeCats = OUTFLOW_CATS.filter((c) => rows.some((r: any) => r[c.key] > 0));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold">Cash Flow</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Projected money in &amp; out across your portfolio — sale payments, leases, draws, loans, AP, TI &amp; commissions.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 w-fit self-start">
          {HORIZONS.map((h) => (
            <button
              key={h.months}
              onClick={() => setMonths(h.months)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                months === h.months ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <LoadingState message="Building cash flow projection…" />
      ) : error ? (
        <ErrorState />
      ) : !rows.length ? (
        <EmptyState title="No cash flow data yet" message="Projections populate automatically from sale payments, leases, draw schedules, loans, vendor commitments, and interior invoices." />
      ) : (
        <div className="space-y-5">
          {/* KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={<FiTrendingUp size={13} />} label="Projected Inflow" tone="emerald" value={fmt(summary.totalInflows ?? 0)} />
            <Kpi icon={<FiTrendingDown size={13} />} label="Projected Outflow" tone="rose" value={fmt(summary.totalOutflows ?? 0)} />
            <Kpi icon={<FiDollarSign size={13} />} label="Net Cash Flow" tone={Number(summary.netCashFlow) >= 0 ? 'indigo' : 'rose'} value={`${Number(summary.netCashFlow) >= 0 ? '+' : ''}${fmt(summary.netCashFlow ?? 0)}`} />
            <Kpi icon={<FiActivity size={13} />} label="Avg Monthly Burn" tone="gray" value={fmt(summary.burnRate ?? 0)} />
          </div>

          {/* Main timeline */}
          <Card shadow="sm">
            <CardHeader className="pb-0">
              <div>
                <p className="font-semibold text-sm text-gray-700">Money In vs Out</p>
                <p className="text-xs text-gray-400">Net bars with cumulative cash position over {months} months</p>
              </div>
            </CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={kAxis} />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="inflow" name="Inflow" fill={INFLOW_COLOR} radius={[4, 4, 0, 0]} maxBarSize={34} />
                  <Bar dataKey="outflow" name="Outflow" fill={OUTFLOW_COLOR} radius={[4, 4, 0, 0]} maxBarSize={34} />
                  <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke={CUM_COLOR} strokeWidth={2} dot={{ r: 2.5, fill: CUM_COLOR }} activeDot={{ r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          {/* Outflow composition */}
          {activeCats.length > 0 && (
            <Card shadow="sm">
              <CardHeader className="pb-0">
                <div>
                  <p className="font-semibold text-sm text-gray-700">Where the money goes</p>
                  <p className="text-xs text-gray-400">Outflows by category — the five budget lines</p>
                </div>
              </CardHeader>
              <CardBody>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={kAxis} />
                    <RechartsTooltip formatter={(v: any, n: any) => [fmt(Number(v)), n]} />
                    <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    {activeCats.map((c) => (
                      <Bar key={c.key} dataKey={c.key} name={c.label} stackId="out" fill={c.color} maxBarSize={34} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          )}

          {/* Month table */}
          <Card shadow="sm">
            <CardHeader className="pb-0">
              <p className="font-semibold text-sm text-gray-700 flex items-center gap-1.5"><FiDownloadCloud size={13} /> Monthly detail</p>
            </CardHeader>
            <CardBody>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-xs min-w-[520px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[10px]">
                      <th className="text-left px-3 py-2 font-medium">Month</th>
                      <th className="text-right px-3 py-2 font-medium text-emerald-600">Inflow</th>
                      <th className="text-right px-3 py-2 font-medium text-rose-600">Outflow</th>
                      <th className="text-right px-3 py-2 font-medium text-indigo-600">Net</th>
                      <th className="text-right px-3 py-2 font-medium">Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any, i: number) => (
                      <tr key={r.month} className={`border-t border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                        <td className="px-3 py-2 font-medium text-gray-700">{r.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.inflow > 0 ? fmt(r.inflow) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-700">{r.outflow > 0 ? fmt(r.outflow) : '—'}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{r.net >= 0 ? '+' : ''}{fmt(r.net)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.cumulative >= 0 ? 'text-gray-600' : 'text-rose-600 font-semibold'}`}>{r.cumulative >= 0 ? '+' : ''}{fmt(r.cumulative)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
