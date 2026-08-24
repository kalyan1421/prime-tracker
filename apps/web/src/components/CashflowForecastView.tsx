/**
 * CashflowForecastView — Full cashflow projection for a project.
 *
 * Merges all sources (sale installments, draw schedule, vendor commitments,
 * lease income, manual entries) into a unified monthly timeline.
 * Uses Recharts for the bar+line chart.
 */

import { useState, useMemo } from 'react';
import { Chip, Tooltip } from '@heroui/react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  FiTrendingUp, FiTrendingDown, FiDollarSign,
  FiBarChart2, FiList,
} from 'react-icons/fi';
import { useCashFlowForecast } from '../hooks/useApi';
import { fmt } from '../utils/fmt';

// ─── types ────────────────────────────────────────────────────────────────────

interface ForecastEntry {
  month: string;       // "2026-06"
  label?: string;      // "Jun 2026"
  inflow: number;
  outflow: number;
  net: number;
  sources?: {
    salePayments?: number;
    leaseIncome?: number;
    drawSchedule?: number;
    commitments?: number;
    manual?: number;
  };
}

// ─── colour palette ───────────────────────────────────────────────────────────

const INFLOW_COLOR  = '#10b981'; // emerald-500
const OUTFLOW_COLOR = '#f43f5e'; // rose-500
const NET_COLOR     = '#6366f1'; // indigo-500
const ZERO_LINE     = '#e5e7eb';

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmtMonth = (month: string) => {
  const [y, m] = month.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${y.slice(2)}`;
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const inflow  = payload.find((p: any) => p.dataKey === 'inflow')?.value ?? 0;
  const outflow = payload.find((p: any) => p.dataKey === 'outflow')?.value ?? 0;
  const net     = payload.find((p: any) => p.dataKey === 'net')?.value ?? 0;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 min-w-[160px] text-xs">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="flex items-center gap-1 text-emerald-700">
            <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" /> Inflow
          </span>
          <span className="tabular-nums font-medium text-emerald-700">{fmt(inflow)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="flex items-center gap-1 text-rose-700">
            <span className="inline-block w-2 h-2 rounded-sm bg-rose-500" /> Outflow
          </span>
          <span className="tabular-nums font-medium text-rose-700">{fmt(outflow)}</span>
        </div>
        <div className="border-t border-gray-100 pt-1 flex justify-between gap-4">
          <span className="flex items-center gap-1 text-indigo-600">
            <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" /> Net
          </span>
          <span className={`tabular-nums font-bold ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {net >= 0 ? '+' : ''}{fmt(net)}
          </span>
        </div>
      </div>
    </div>
  );
};

// ─── main component ───────────────────────────────────────────────────────────

export function CashflowForecastView({ projectId }: { projectId: string }) {
  const { data, isLoading } = useCashFlowForecast(projectId);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const entries: ForecastEntry[] = useMemo(() => {
    // The engine returns { summary, monthly:[{ inflows, outflows, net, inflowsBySource }] };
    // older callers passed a bare array. Accept both.
    const monthly = Array.isArray(data) ? data : (data as any)?.monthly;
    if (!Array.isArray(monthly)) return [];
    return monthly.map((e: any) => ({
      month:   e.month,
      label:   fmtMonth(e.month),
      inflow:  Number(e.inflow  ?? e.inflows  ?? 0),
      outflow: Number(e.outflow ?? e.outflows ?? 0),
      net:     Number(e.net     ?? 0),
      sources: e.inflowsBySource ?? e.sources,
    }));
  }, [data]);

  const totalInflow  = entries.reduce((s, e) => s + e.inflow, 0);
  const totalOutflow = entries.reduce((s, e) => s + e.outflow, 0);
  const totalNet     = totalInflow - totalOutflow;
  const runningMin   = Math.min(...entries.map((e) => e.net), 0);

  // ── loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-5 w-40 bg-gray-100 rounded" />
        <div className="h-48 bg-gray-50 rounded-xl" />
      </div>
    );
  }

  // ── empty ────────────────────────────────────────────────────────────────────
  if (!entries.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center">
        <FiBarChart2 className="mx-auto mb-2 text-2xl text-gray-300" />
        <p className="text-sm text-gray-500">No cashflow data yet.</p>
        <p className="text-xs text-gray-300 mt-0.5">
          Data populates automatically from sale payments, leases, draw schedules, and commitments.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── summary strip ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
          <p className="text-xs text-emerald-700 font-medium flex items-center gap-1">
            <FiTrendingUp size={12} /> Total Inflow
          </p>
          <p className="text-lg font-bold text-emerald-700 mt-0.5 tabular-nums">{fmt(totalInflow)}</p>
        </div>
        <div className="rounded-xl bg-rose-50 border border-rose-100 p-3">
          <p className="text-xs text-rose-700 font-medium flex items-center gap-1">
            <FiTrendingDown size={12} /> Total Outflow
          </p>
          <p className="text-lg font-bold text-rose-700 mt-0.5 tabular-nums">{fmt(totalOutflow)}</p>
        </div>
        <div className={`rounded-xl border p-3 ${totalNet >= 0 ? 'bg-indigo-50 border-indigo-100' : 'bg-rose-50 border-rose-100'}`}>
          <p className={`text-xs font-medium flex items-center gap-1 ${totalNet >= 0 ? 'text-indigo-600' : 'text-rose-700'}`}>
            <FiDollarSign size={12} /> Net Position
          </p>
          <p className={`text-lg font-bold mt-0.5 tabular-nums ${totalNet >= 0 ? 'text-indigo-700' : 'text-rose-700'}`}>
            {totalNet >= 0 ? '+' : ''}{fmt(totalNet)}
          </p>
        </div>
      </div>

      {/* ── view toggle ── */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
        {(['chart', 'table'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              view === v ? 'bg-white shadow-sm text-gray-800' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {v === 'chart' ? <FiBarChart2 size={12} /> : <FiList size={12} />}
            {v === 'chart' ? 'Chart' : 'Table'}
          </button>
        ))}
      </div>

      {/* ── chart ── */}
      {view === 'chart' && (
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={entries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ZERO_LINE} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                domain={[runningMin < 0 ? runningMin * 1.1 : 0, 'auto']}
              />
              <RechartsTooltip content={<CustomTooltip />} />
              <Legend
                iconType="square"
                iconSize={10}
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              />
              <Bar dataKey="inflow"  name="Inflow"  fill={INFLOW_COLOR}  radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar dataKey="outflow" name="Outflow" fill={OUTFLOW_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Line
                type="monotone" dataKey="net" name="Net"
                stroke={NET_COLOR} strokeWidth={2}
                dot={{ r: 3, fill: NET_COLOR }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* source legend */}
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-50">
            {[
              { key: 'salePayments', label: 'Sale Payments', color: 'bg-emerald-400' },
              { key: 'leaseIncome',  label: 'Lease Income',  color: 'bg-teal-400' },
              { key: 'drawSchedule', label: 'Draw Schedule', color: 'bg-rose-400' },
              { key: 'commitments',  label: 'Commitments',   color: 'bg-orange-400' },
              { key: 'manual',       label: 'Manual',        color: 'bg-gray-400' },
            ].map(({ key, label, color }) => {
              const has = entries.some((e) => (e.sources as any)?.[key]);
              if (!has) return null;
              return (
                <span key={key} className="flex items-center gap-1 text-xs text-gray-500">
                  <span className={`w-2 h-2 rounded-sm ${color}`} /> {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── table ── */}
      {view === 'table' && (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[11px]">
                <th className="text-left px-3 py-2 font-medium">Month</th>
                <th className="text-right px-3 py-2 font-medium text-emerald-700">Inflow</th>
                <th className="text-right px-3 py-2 font-medium text-rose-700">Outflow</th>
                <th className="text-right px-3 py-2 font-medium text-indigo-600">Net</th>
                <th className="text-right px-3 py-2 font-medium">Running</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let running = 0;
                return entries.map((e, i) => {
                  running += e.net;
                  return (
                    <tr key={e.month} className={`border-t border-gray-100 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                      <td className="px-3 py-2 font-medium text-gray-700">{e.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{e.inflow > 0 ? fmt(e.inflow) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-700">{e.outflow > 0 ? fmt(e.outflow) : '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${e.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {e.net >= 0 ? '+' : ''}{fmt(e.net)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${running >= 0 ? 'text-gray-600' : 'text-rose-700 font-semibold'}`}>
                        {running >= 0 ? '+' : ''}{fmt(running)}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td className="px-3 py-2 font-semibold text-gray-600">Total</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-700">{fmt(totalInflow)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-700">{fmt(totalOutflow)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-bold ${totalNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {totalNet >= 0 ? '+' : ''}{fmt(totalNet)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── source breakdown note ── */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'Sale payments', color: 'bg-emerald-100 text-emerald-700' },
          { label: 'Lease income',  color: 'bg-teal-100 text-teal-700' },
          { label: 'Draw schedule', color: 'bg-rose-100 text-rose-700' },
          { label: 'Vendor commitments', color: 'bg-orange-100 text-orange-700' },
        ].map(({ label, color }) => (
          <Tooltip key={label} content={`Auto-populated from ${label.toLowerCase()}`}>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${color}`}>
              {label}
            </span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
