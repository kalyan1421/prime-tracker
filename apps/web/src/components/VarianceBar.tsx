import React from 'react';
import { Tooltip } from '@heroui/react';
import { SEVERITY } from './severity';

/**
 * Horizontal variance bar for a single budget line.
 *
 *   ─────────────────────────────────────────  ← baseline (gray track)
 *   ████████████████████████░░░░░░░░░░░░░░░░  ← actuals (green) + commitments (amber)
 *                                          ▲
 *   The vertical tick at 100% is the budget line. Anything past that is over-budget,
 *   shown in red, extending beyond the track.
 *
 * Inputs are absolute dollar amounts; the bar normalizes by `budget`.
 */
export interface VarianceBarProps {
  budget: number;       // revised budget (or baseline if unrevised)
  actuals: number;      // sum of posted actuals
  committed: number;    // sum of open commitments
  className?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function VarianceBar({ budget, actuals, committed, className = '' }: VarianceBarProps) {
  const total = actuals + committed;
  const utilization = budget > 0 ? total / budget : 0;
  const overage = Math.max(0, total - budget);

  // % widths for each segment, capped at 100% for the under-budget portion
  const actualPct = budget > 0 ? Math.min(100, (actuals / budget) * 100) : 0;
  const commitPct = budget > 0 ? Math.min(100 - actualPct, (committed / budget) * 100) : 0;
  // Overage extends a bonus 30% past the bar
  const overagePct = overage > 0 ? Math.min(30, (overage / budget) * 100) : 0;

  // Severity at 100% threshold
  const severity = utilization > 1.10 ? 'critical' : utilization > 1.0 ? 'watch' : 'healthy';

  return (
    <Tooltip
      content={
        <div className="text-xs space-y-0.5">
          <div><span className="text-gray-500">Budget:</span> {fmt(budget)}</div>
          <div><span className="text-gray-500">Actuals:</span> {fmt(actuals)}</div>
          <div><span className="text-gray-500">Commitments:</span> {fmt(committed)}</div>
          <div className={`font-semibold mt-0.5 ${SEVERITY[severity].text}`}>
            {(utilization * 100).toFixed(0)}% utilized
            {overage > 0 && ` · ${fmt(overage)} over`}
          </div>
        </div>
      }
    >
      <div className={`relative w-full h-2 bg-gray-200 rounded-full ${className}`}>
        {/* Actuals fill */}
        <div className="absolute left-0 top-0 h-full bg-green-500 rounded-l-full" style={{ width: `${actualPct}%` }} />
        {/* Commitments fill */}
        <div className="absolute top-0 h-full bg-amber-400" style={{ left: `${actualPct}%`, width: `${commitPct}%` }} />
        {/* Overage — extends past 100% */}
        {overage > 0 && (
          <div
            className="absolute top-0 h-full bg-red-500 rounded-r-full"
            style={{ left: '100%', width: `${overagePct}%` }}
          />
        )}
        {/* 100% tick mark */}
        <div className="absolute top-[-2px] bottom-[-2px] w-px bg-gray-700" style={{ left: '100%' }} />
      </div>
    </Tooltip>
  );
}
