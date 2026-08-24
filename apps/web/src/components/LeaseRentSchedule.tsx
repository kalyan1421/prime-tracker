/**
 * LeaseRentSchedule — the rent summary for a single lease.
 *
 * Reduced 2026-08-21 to just the headline numbers (effective monthly rent, free rent,
 * first paying month, total contracted rent) straight-lined from `LeaseRentPeriod` on
 * the backend. The full period-by-period table, "Regenerate future" and "Add rent
 * change" were removed as UI actions here — the API endpoints behind them
 * (`LeaseRentPeriodService.regenerateFuture` / `.addManualPeriod`) still exist and are
 * unaffected; this component just no longer exposes them.
 *
 * MONEY IS A STRING. Prisma Decimal serialises to JSON as a string, so `+` would
 * concatenate ("0" + "500" === "0500"). Everything numeric goes through num().
 */

import { Button, Card, CardBody, addToast } from '@heroui/react';
import { FiZap } from 'react-icons/fi';
import { useLeaseRentPeriods, useLeaseRentSummary, useGenerateRentPeriods } from '../hooks/useApi';
import { errMsg, fmt, fmtDate } from '../utils/fmt';
import { StatCard, LoadingState, ErrorState, EmptyState } from './ui';

interface RentSummary {
  termMonths: number;
  payingMonths: number;
  freeRentMonths: number;
  totalContractedRent: string | number;
  totalContractedBaseRent: string | number;
  effectiveMonthlyRent: string | number;
  effectiveMonthlyBaseRent: string | number;
  firstPayingMonth: string | null;
}

/** The one safe door from Decimal-as-string to JS number. */
function num(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── component ────────────────────────────────────────────────────────────────

interface LeaseRentScheduleProps {
  leaseId: string;
  canEdit: boolean;
}

export function LeaseRentSchedule({ leaseId, canEdit }: LeaseRentScheduleProps) {
  const periodsQ = useLeaseRentPeriods(leaseId);
  // The summary endpoint 400s on a lease with no periods (it cannot straight-line
  // nothing). That is expected on un-backfilled leases, so its error is swallowed
  // and only the periods query drives the error state.
  const summaryQ = useLeaseRentSummary(leaseId);
  const generate = useGenerateRentPeriods();

  const periods = (periodsQ.data ?? []) as unknown[];
  const summary = summaryQ.data as RentSummary | undefined;

  const handleGenerate = async () => {
    try {
      await generate.mutateAsync({ leaseId });
      addToast({ title: 'Rent schedule generated', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to generate rent schedule'), color: 'danger' });
    }
  };

  // ── query states ────────────────────────────────────────────────────────────

  if (periodsQ.isLoading) return <LoadingState message="Loading rent schedule…" />;
  if (periodsQ.isError) {
    return <ErrorState message={errMsg(periodsQ.error, 'Failed to load the rent schedule')} />;
  }

  // ── empty: lease predates the generator ─────────────────────────────────────

  if (periods.length === 0) {
    return (
      <Card shadow="sm" className="border border-gray-100">
        <CardBody className="p-4">
          <EmptyState
            title="No rent schedule yet"
            message={
              canEdit
                ? 'This lease predates the rent timeline. Generate it from the lease terms — start, end, monthly rent, escalation and free-rent months.'
                : 'This lease predates the rent timeline and has no periods on file.'
            }
            action={canEdit ? (
              <Button size="sm" color="primary" startContent={<FiZap size={13} />}
                onPress={handleGenerate} isLoading={generate.isPending}>
                Generate schedule
              </Button>
            ) : undefined}
          />
        </CardBody>
      </Card>
    );
  }

  // ── populated ───────────────────────────────────────────────────────────────

  if (!summary) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        label="Effective monthly rent"
        value={fmt(num(summary.effectiveMonthlyRent))}
        colorScheme="blue"
        helpText={`Straight-lined over ${summary.termMonths} mo`}
      />
      <StatCard
        label="Free rent"
        value={`${summary.freeRentMonths} mo`}
        colorScheme={num(summary.freeRentMonths) > 0 ? 'orange' : 'gray'}
        // Rounded: payingMonths is derived from a day count, so a part-month term
        // yields values like 12.032258. Six decimal places of a month is not a
        // number anyone reads — it just looks broken.
        helpText={`${Math.round(num(summary.payingMonths) * 10) / 10} paying months`}
      />
      <StatCard
        label="First paying month"
        value={summary.firstPayingMonth ? fmtDate(summary.firstPayingMonth) : '—'}
        colorScheme="teal"
        helpText={summary.firstPayingMonth ? 'Rent commencement' : 'Fully abated term'}
      />
      <StatCard
        label="Total contracted rent"
        value={fmt(num(summary.totalContractedRent))}
        colorScheme="green"
        helpText={`${fmt(num(summary.totalContractedBaseRent))} base`}
      />
    </div>
  );
}
