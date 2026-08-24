import React from 'react';
import { Avatar, Chip, Tooltip } from '@heroui/react';
import { useBudgetRevisions } from '../hooks/useApi';

/**
 * Budget revision history — append-only audit trail of every change.
 * Use inside an existing modal (typically the budget-line edit form):
 *
 *   <BudgetRevisionHistory budgetLineId={editingLineId} />
 *
 * Renders nothing if no line is selected (initial create flow).
 */
const CHANGE_REASON_LABELS: Record<string, string> = {
  SCOPE_ADD: 'Scope added',
  COST_INCREASE: 'Cost increase',
  REALLOCATION: 'Reallocation',
  ESTIMATE_REFINED: 'Estimate refined',
  CHANGE_ORDER: 'Change order',
  OTHER: 'Other',
};

const CHANGE_REASON_COLORS: Record<string, 'default' | 'primary' | 'warning' | 'danger'> = {
  SCOPE_ADD: 'primary',
  COST_INCREASE: 'danger',
  REALLOCATION: 'warning',
  ESTIMATE_REFINED: 'default',
  CHANGE_ORDER: 'warning',
  OTHER: 'default',
};

const fmtMoney = (n: any) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n ?? 0));

const fmtRelative = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return day === 1 ? 'yesterday' : `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export function BudgetRevisionHistory({ budgetLineId }: { budgetLineId?: string | null }) {
  const { data, isLoading } = useBudgetRevisions(budgetLineId ?? undefined);
  const revisions = (data as any[]) ?? [];

  if (!budgetLineId) return null;
  if (isLoading) {
    return <p className="text-xs text-gray-500">Loading history…</p>;
  }
  if (revisions.length === 0) {
    return <p className="text-xs text-gray-500">No revisions yet.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Revision history</p>
      <ol className="space-y-2">
        {revisions.map((r, idx) => {
          const previous = revisions[idx + 1];
          const delta = previous ? Number(r.amount) - Number(previous.amount) : 0;
          const isBaseline = r.revisionNumber === 1;
          return (
            <li key={r.id} className="rounded border border-gray-100 bg-white p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                    rev {r.revisionNumber}
                  </span>
                  <span className="font-semibold text-sm text-gray-800">{fmtMoney(r.amount)}</span>
                  {!isBaseline && delta !== 0 && (
                    <span className={`text-xs font-medium ${delta > 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {delta > 0 ? '+' : ''}{fmtMoney(delta)}
                    </span>
                  )}
                  <Chip
                    size="sm"
                    variant="flat"
                    color={CHANGE_REASON_COLORS[r.changeReason] ?? 'default'}
                    className="text-[11px]"
                  >
                    {CHANGE_REASON_LABELS[r.changeReason] ?? r.changeReason}
                  </Chip>
                </div>
                <span className="text-[11px] text-gray-500" title={new Date(r.createdAt).toLocaleString()}>
                  {fmtRelative(r.createdAt)}
                </span>
              </div>

              <p className="text-xs text-gray-600 mt-1.5 whitespace-pre-wrap">{r.reason}</p>

              <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px]">
                {r.createdBy && (
                  <span className="flex items-center gap-1.5 text-gray-500">
                    <Avatar size="sm" name={r.createdBy.name} className="w-4 h-4 text-[11px]" />
                    {r.createdBy.name}
                  </span>
                )}
                {r.approvedBy ? (
                  <Tooltip content={`Approved ${fmtRelative(r.approvedAt)}`}>
                    <span className="flex items-center gap-1.5 text-green-700 font-medium">
                      ✓ approved by {r.approvedBy.name}
                    </span>
                  </Tooltip>
                ) : !isBaseline ? (
                  <span className="text-amber-700">awaiting approval</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
