/**
 * The fit-out's TOTAL budget (client, 2026-11-02): one approved figure, entered when the
 * work is started, that the estimate, change orders, purchase orders and bills are all
 * measured against.
 *
 *   TotalBudgetBanner      shown while none is set — everywhere a fit-out appears
 *   SetTotalBudgetModal    add / change / remove it
 *   TotalBudgetCard        the total beside what the estimate, POs and bills have done to it
 *   BudgetStatusChip       "No budget" / "Over budget" for list rows
 *
 * Every figure is computed on the server (interior-budget.ts → totalBudgetPosition); this
 * only lays it out.
 */
import { useEffect, useState } from 'react';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Chip, useDisclosure, addToast } from '@heroui/react';
import { FiAlertTriangle, FiEdit2 } from 'react-icons/fi';
import { useUpdateInterior } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg } from '../utils/fmt';
import { FormError } from './FormError';
import { money } from './InteriorCostingParts';

const isLive = (status?: string | null) => status !== 'COMPLETED' && status !== 'CANCELLED';

/** True when a live fit-out has no total budget yet. `hasTotalBudget` is sent to every viewer. */
export const isBudgetMissing = (p: { hasTotalBudget?: boolean; status?: string | null }) =>
  p.hasTotalBudget === false && isLive(p.status);

/** Setting the budget is Finance's act (the PATCH also needs interior:edit). */
export function useCanSetTotalBudget() {
  return useAuthStore((s) => s.hasPermission('interior:finance') && s.hasPermission('interior:edit'));
}

/** Parses what a person types into a money field; null when it is not a positive amount. */
export function parseBudget(raw: string): number | null {
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function SetTotalBudgetModal({ id, current, suggested, isOpen, onClose }: {
  id: string;
  /** The budget now, or null when none is set. */
  current: number | null;
  /** A figure worth offering — the contract value — shown as a one-click fill. */
  suggested?: number | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const update = useUpdateInterior();
  const [value, setValue] = useState(current != null ? String(current) : '');
  const [err, setErr] = useState<string | null>(null);

  // A modal that stays mounted would otherwise keep the last draft after Cancel.
  useEffect(() => {
    if (isOpen) { setValue(current != null ? String(current) : ''); setErr(null); }
  }, [isOpen, current]);

  const save = async () => {
    const n = parseBudget(value);
    if (n === null) { setErr('Enter an amount greater than zero'); return; }
    setErr(null);
    try {
      await update.mutateAsync({ id, data: { totalBudget: n } });
      addToast({ title: 'Total budget saved', color: 'success' });
      onClose();
    } catch (e) {
      setErr(errMsg(e, 'Could not save the total budget'));
    }
  };

  const remove = async () => {
    try {
      await update.mutateAsync({ id, data: { totalBudget: null } });
      addToast({ title: 'Total budget removed', color: 'success' });
      onClose();
    } catch (e) {
      setErr(errMsg(e, 'Could not remove the total budget'));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalContent>
        <ModalHeader>{current != null ? 'Change total budget' : 'Add total budget'}</ModalHeader>
        <ModalBody className="space-y-3">
          <p className="text-sm text-gray-700">
            The approved budget for the whole fit-out. The estimate, change orders, purchase orders and bills
            are all tracked against it.
          </p>
          <FormError message={err} />
          <Input
            autoFocus label="Total budget ($)" inputMode="decimal" value={value}
            onChange={(e) => { setValue(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            isInvalid={!!err && parseBudget(value) === null}
          />
          {!!suggested && suggested > 0 && parseBudget(value) !== suggested && (
            <button
              type="button" onClick={() => setValue(String(suggested))}
              className="self-start text-xs font-medium text-blue-700 hover:underline"
            >
              Use the contract value, {money(suggested)}
            </button>
          )}
        </ModalBody>
        <ModalFooter className="justify-between">
          {current != null
            ? <Button variant="light" color="danger" isLoading={update.isPending} onPress={remove}>Remove budget</Button>
            : <span />}
          <div className="flex gap-2">
            <Button variant="light" onPress={onClose}>Cancel</Button>
            <Button color="primary" isLoading={update.isPending} onPress={save}>Save budget</Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * The reminder. Shown to everyone who can see the fit-out; only Finance gets the button,
 * everyone else is told who to ask. Renders nothing once a budget exists or the fit-out has
 * finished, so it can be dropped in unconditionally.
 */
export function TotalBudgetBanner({ project, compact = false }: {
  project: { id: string; hasTotalBudget?: boolean; status?: string | null; contractValue?: unknown };
  compact?: boolean;
}) {
  const canSet = useCanSetTotalBudget();
  const modal = useDisclosure();
  if (!isBudgetMissing(project)) return null;
  const contract = project.contractValue != null ? Number(project.contractValue) || null : null;
  return (
    <>
      <div
        role="alert"
        className={`flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}
      >
        <FiAlertTriangle className={`mt-0.5 shrink-0 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">No total budget set</p>
          <p>
            Add the approved budget so the estimate, purchase orders and bills are tracked against it
            {canSet ? '.' : ' — ask a Founder or Project Manager to add it.'}
          </p>
        </div>
        {canSet && (
          <Button size="sm" color="warning" variant="flat" className="shrink-0" onPress={modal.onOpen}>Add budget</Button>
        )}
      </div>
      {canSet && (
        <SetTotalBudgetModal id={project.id} current={null} suggested={contract} isOpen={modal.isOpen} onClose={modal.onClose} />
      )}
    </>
  );
}

/** "No budget" / "Over budget" for a list row; nothing when the row is fine. */
export function BudgetStatusChip({ row }: {
  row: { hasTotalBudget?: boolean; status?: string | null; costing?: { budgetAlerts?: string[] } | null };
}) {
  if (isBudgetMissing(row)) return <Chip size="sm" variant="flat" color="warning">No budget</Chip>;
  if (row.costing?.budgetAlerts?.length) return <Chip size="sm" variant="flat" color="danger">Over budget</Chip>;
  return null;
}

const ALERT_TEXT: Record<string, (t: any) => string> = {
  ESTIMATE_OVER: (t) => `The estimate (${money(t.estimate)}) is ${money(t.estimate - t.total)} over the total budget.`,
  COMMITTED_OVER: (t) => `Approved purchase orders (${money(t.committed)}) are ${money(t.committed - t.total)} over the total budget.`,
  ACTUAL_OVER: (t) => `Bills (${money(t.actual)}) are ${money(t.actual - t.total)} over the total budget.`,
};

/** The total budget against what the estimate, purchase orders and bills have done to it. */
export function TotalBudgetCard({ costing }: { costing: any }) {
  const t = costing.totalBudget;
  const canSet = !!costing.can?.setTotalBudget;
  const modal = useDisclosure();
  if (!t) return null;
  // Not set: the banner above already says so, and has the button. Nothing to measure yet.
  if (!t.set) return null;

  // Bars share one scale so "committed" and "spent" are comparable; it widens past the
  // total when something has overrun, so the overrun is visible rather than clipped.
  const scale = Math.max(t.total, t.committed + t.pending, t.actual, t.estimate) || 1;
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / scale) * 100))}%`;
  const over = t.alerts.length > 0;
  const stats: { k: string; v: number; f: string; bad?: boolean }[] = [
    { k: 'Estimate', v: t.estimate, f: t.unallocated >= 0 ? `${money(t.unallocated)} unallocated` : `${money(-t.unallocated)} over`, bad: t.unallocated < 0 },
    { k: 'Committed', v: t.committed, f: t.leftToCommit >= 0 ? `${money(t.leftToCommit)} left to commit` : `${money(-t.leftToCommit)} over`, bad: t.leftToCommit < 0 },
    { k: 'Spent', v: t.actual, f: t.leftToSpend >= 0 ? `${money(t.leftToSpend)} left` : `${money(-t.leftToSpend)} over`, bad: t.leftToSpend < 0 },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3" data-testid="total-budget-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Total budget</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-2xl font-bold tabular-nums text-gray-900">{money(t.total)}</span>
            {canSet && (
              <Button isIconOnly size="sm" variant="light" aria-label="Change the total budget" onPress={modal.onOpen}>
                <FiEdit2 className="h-3.5 w-3.5 text-gray-500" />
              </Button>
            )}
          </div>
          <div className="text-[11px] text-gray-500">
            {t.spentShare != null ? `${Math.round(t.spentShare * 100)}% billed` : 'approved budget'}
          </div>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-2 sm:max-w-xl">
          {stats.map((x) => (
            <div key={x.k} className="min-w-0 rounded-lg bg-gray-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{x.k}</div>
              <div className={`truncate text-sm font-bold tabular-nums ${x.bad ? 'text-red-700' : 'text-gray-900'}`}>{money(x.v)}</div>
              <div className={`truncate text-[11px] ${x.bad ? 'text-red-700' : 'text-gray-500'}`}>{x.f}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        role="img"
        aria-label={`Of ${money(t.total)}: ${money(t.committed)} committed, ${money(t.actual)} spent`}
        className="relative h-2 overflow-hidden rounded-full bg-gray-100"
      >
        <div className={`absolute inset-y-0 left-0 ${over ? 'bg-red-200' : 'bg-blue-200'}`} style={{ width: pct(t.committed) }} />
        <div className={`absolute inset-y-0 left-0 ${over ? 'bg-red-600' : 'bg-blue-600'}`} style={{ width: pct(t.actual) }} />
      </div>

      {over && (
        <ul className="space-y-1" role="alert">
          {t.alerts.map((a: string) => (
            <li key={a} className="flex items-start gap-1.5 text-xs font-medium text-red-700">
              <FiAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {ALERT_TEXT[a]?.(t) ?? a}
            </li>
          ))}
        </ul>
      )}

      {canSet && (
        <SetTotalBudgetModal id={costing.id} current={t.total} isOpen={modal.isOpen} onClose={modal.onClose} />
      )}
    </div>
  );
}
