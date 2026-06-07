import { useMemo, useState } from 'react';
import { Button, Popover, PopoverTrigger, PopoverContent, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, addToast, Tooltip } from '@heroui/react';
import { FiDollarSign, FiTrendingDown, FiTrendingUp, FiHome, FiKey, FiCreditCard, FiEdit2, FiCheck } from 'react-icons/fi';
import {
  useFinancialSummary, useUnits, useLeases, useLoans, useUpdateProject,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';

const PHASES = [
  { key: 'PRE_DEVELOPMENT', label: 'Pre-Dev' },
  { key: 'PERMITTING',      label: 'Permitting' },
  { key: 'CONSTRUCTION',    label: 'Construction' },
  { key: 'LEASE_UP',        label: 'Lease-Up' },
  { key: 'STABILIZED',      label: 'Stabilized' },
  { key: 'SOLD_REFI',       label: 'Sold/Refi' },
] as const;

const fmtMoney = (n: number) => {
  if (n === 0) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};

const fmtPct = (n: number) => `${(n * 100).toFixed(0)}%`;

/**
 * Project Health Header — compact financial + occupancy summary that sits at the top
 * of ProjectDetailPage, above the tab bar. Pulls existing data (no new endpoints):
 *   • Budget / Actuals / Variance from /budgets/summary
 *   • Unit status counts from /units?projectId=
 *   • Active leases from /leases?projectId=
 *   • Total loan principal from /loans?projectId=
 *
 * Phase update — "Edit phase" button opens a popover with the 6-step pipeline.
 * Click any step to update Project.phase via PATCH /projects/:id. Backwards moves
 * (e.g. CONSTRUCTION → PERMITTING) require explicit confirmation since they're rare
 * and usually indicate a mistake.
 */
export function ProjectHealthHeader({ project }: { project: any }) {
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission('project:edit');
  const { data: fin } = useFinancialSummary(project.id);
  const { data: units } = useUnits(project.id);
  const { data: leases } = useLeases(project.id);
  const { data: loans } = useLoans(project.id);

  const summary = useMemo(() => {
    const budget = Number((fin as any)?.budgetTotal ?? 0);
    const actual = Number((fin as any)?.actualTotal ?? 0);
    const remaining = budget - actual;
    const usedPct = budget > 0 ? Math.min(actual / budget, 1) : 0;
    const overrun = budget > 0 && actual > budget;

    const unitArr = (units as any[]) || [];
    const unitTotal = unitArr.length;
    const sold = unitArr.filter((u) => u.status === 'SOLD').length;
    const leased = unitArr.filter((u) => u.status === 'LEASED' || u.status === 'OCCUPIED').length;
    const available = unitArr.filter((u) => u.status === 'AVAILABLE').length;

    const leaseArr = (leases as any[]) || [];
    const activeLeases = leaseArr.filter((l) => l.status === 'ACTIVE').length;
    const monthlyRent = leaseArr
      .filter((l) => l.status === 'ACTIVE')
      .reduce((s, l) => s + Number(l.monthlyRent ?? 0), 0);

    const loanArr = (loans as any[]) || [];
    const loanTotal = loanArr.reduce((s, l) => s + Number(l.currentBalance ?? l.principalAmt ?? 0), 0);

    return {
      budget, actual, remaining, usedPct, overrun,
      unitTotal, sold, leased, available,
      activeLeases, monthlyRent, loanTotal,
    };
  }, [fin, units, leases, loans]);

  return (
    <div className="flex h-full flex-col">
        {/* Budget — the hero metric of this card */}
        <div className="px-5 pt-4 pb-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold flex items-center gap-1.5">
              <FiDollarSign className="w-3.5 h-3.5" /> Budget
            </span>
            <ProjectPhasePopover project={project} canEdit={canEdit} />
          </div>

          <div className="mt-2 flex items-end justify-between gap-x-4 gap-y-1 flex-wrap">
            <span className="text-[26px] leading-none font-bold text-gray-900 tabular-nums tracking-tight">
              {fmtMoney(summary.budget)}
            </span>
            <div className="flex items-center gap-4 text-xs tabular-nums pb-0.5">
              <span className="text-gray-400">
                Spent <span className="font-semibold text-gray-700">{fmtMoney(summary.actual)}</span>
              </span>
              <span className={`font-semibold inline-flex items-center gap-1 ${summary.overrun ? 'text-rose-600' : 'text-emerald-600'}`}>
                {summary.overrun ? <FiTrendingDown className="w-3.5 h-3.5" /> : <FiTrendingUp className="w-3.5 h-3.5" />}
                {summary.overrun ? 'Over by ' : 'Left '}{fmtMoney(Math.abs(summary.remaining))}
              </span>
            </div>
          </div>

          {/* Variance bar — color-graded so the founder reads budget health in 1 sec */}
          <Tooltip content={`${fmtPct(summary.usedPct)} of budget used`}>
            <div className="mt-3 h-2 w-full bg-gray-100 rounded-full overflow-hidden cursor-default" role="progressbar"
              aria-valuenow={Math.round(summary.usedPct * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${
                  summary.overrun ? 'bg-rose-500'
                  : summary.usedPct > 0.9 ? 'bg-amber-500'
                  : summary.usedPct > 0.7 ? 'bg-yellow-400'
                  : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.max(Math.min(summary.usedPct, 1) * 100, summary.budget > 0 ? 2 : 0)}%` }}
              />
            </div>
          </Tooltip>
        </div>

        {/* Occupancy + debt — three peers, separated by hairlines */}
        <div className="mt-auto grid grid-cols-3 border-t border-gray-100 divide-x divide-gray-100">
          <Stat
            icon={<FiHome />}
            label="Units"
            value={`${summary.sold + summary.leased}/${summary.unitTotal}`}
            help={`${summary.available} available`}
          />
          <Stat
            icon={<FiKey />}
            label="Leases"
            value={summary.activeLeases.toString()}
            help={summary.monthlyRent > 0 ? `${fmtMoney(summary.monthlyRent)}/mo` : 'none active'}
          />
          <Stat
            icon={<FiCreditCard />}
            label="Loan"
            value={summary.loanTotal > 0 ? fmtMoney(summary.loanTotal) : '—'}
            help={summary.loanTotal > 0 ? 'outstanding' : 'no loans'}
          />
        </div>
    </div>
  );
}

function Stat({ icon, label, value, help }: { icon: React.ReactNode; label: string; value: string; help?: string }) {
  return (
    <div className="px-4 py-3 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold flex items-center gap-1">
        {icon} {label}
      </span>
      <div className="mt-1.5 text-lg leading-none font-bold text-gray-900 tabular-nums truncate">{value}</div>
      {help && <div className="text-[11px] text-gray-400 truncate mt-1">{help}</div>}
    </div>
  );
}

function ProjectPhasePopover({ project, canEdit }: { project: any; canEdit: boolean }) {
  const update = useUpdateProject();
  const [open, setOpen] = useState(false);
  const [pendingBackwards, setPendingBackwards] = useState<string | null>(null);

  const currentIdx = PHASES.findIndex((p) => p.key === project.phase);

  const handlePick = (key: string) => {
    if (key === project.phase) { setOpen(false); return; }
    const newIdx = PHASES.findIndex((p) => p.key === key);
    if (newIdx < currentIdx) {
      // Backwards move — confirm
      setPendingBackwards(key);
      return;
    }
    commit(key);
  };

  const commit = async (key: string) => {
    try {
      await update.mutateAsync({ id: project.id, data: { phase: key } });
      addToast({ title: `Phase updated to ${PHASES.find((p) => p.key === key)?.label}`, color: 'success' });
      setOpen(false);
      setPendingBackwards(null);
    } catch {
      addToast({ title: 'Failed to update phase', color: 'danger' });
    }
  };

  if (!canEdit) {
    return null;
  }

  return (
    <>
      <Popover isOpen={open} onOpenChange={setOpen} placement="bottom-end">
        <PopoverTrigger>
          <Button size="sm" variant="light" startContent={<FiEdit2 className="w-3 h-3" />} className="text-xs" aria-label="Edit project phase">
            Edit phase
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-3 w-80">
          <p className="text-xs text-gray-500 mb-2">Set project phase</p>
          <div className="space-y-1">
            {PHASES.map((p, i) => {
              const isCurrent = p.key === project.phase;
              const isPast = i < currentIdx;
              const isFuture = i > currentIdx;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handlePick(p.key)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors text-left ${
                    isCurrent ? 'bg-blue-50 text-blue-700 font-medium'
                    : isPast ? 'text-gray-400 hover:bg-gray-50'
                    : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span className={`w-5 h-5 inline-flex items-center justify-center rounded-full text-[10px] font-medium ${
                    isCurrent ? 'bg-blue-600 text-white'
                    : isPast ? 'bg-gray-200 text-gray-500'
                    : 'bg-gray-100 text-gray-400'
                  }`}>
                    {isCurrent ? <FiCheck className="w-3 h-3" /> : i + 1}
                  </span>
                  <span className="flex-1">{p.label}</span>
                  {isCurrent && <span className="text-[10px] text-blue-600">current</span>}
                  {isFuture && <span className="text-[10px] text-gray-400">advance →</span>}
                  {isPast && !isCurrent && <span className="text-[10px] text-amber-600">↩ rollback</span>}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Confirmation modal — only for backwards moves, which usually mean "mistake" */}
      <Modal isOpen={!!pendingBackwards} onClose={() => setPendingBackwards(null)} size="sm">
        <ModalContent>
          <ModalHeader>Roll project phase back?</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-700">
              You're moving <span className="font-medium">{project.name}</span> back from{' '}
              <span className="font-medium">{PHASES.find((p) => p.key === project.phase)?.label}</span> to{' '}
              <span className="font-medium">{PHASES.find((p) => p.key === pendingBackwards)?.label}</span>.
            </p>
            <p className="text-xs text-gray-500 mt-2">
              This is logged in the audit trail. Continue only if this is intentional.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setPendingBackwards(null)}>Cancel</Button>
            <Button size="sm" color="warning" onPress={() => commit(pendingBackwards!)} isLoading={update.isPending}>
              Roll back
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
