/**
 * Shared core of "record a past tenancy" (H2 backfill) — used by both the standalone
 * BackfillTenancyDialog ("+ Record a past tenancy") and UnitDetailPage's "Save as rental
 * history" toggle on the Add Lease dialog. Both write the same POST /leases/backfill
 * call; this module is the one place that call's shape, validation and copy live, so the
 * two entry points can't silently drift apart.
 */
import { useMemo, useState } from 'react';
import { Input, Select, SelectItem, addToast } from '@heroui/react';
import { FiAlertTriangle } from 'react-icons/fi';
import { fmt } from '../utils/fmt';

// Must match TERMINATION_REASONS in leases.service.ts. Only the endings that make sense
// for a record being entered after the fact — RENEWED/RELOCATED describe a continuing
// tenancy and are set by linking a successor, not by typing one in.
export const HISTORICAL_REASONS = [
  { key: 'EXPIRED', label: 'Ran to the end of the term' },
  { key: 'NON_RENEWAL', label: 'Not renewed' },
  { key: 'EARLY_TERMINATION', label: 'Left early' },
  { key: 'MUTUAL', label: 'Ended by mutual agreement' },
  { key: 'EVICTION', label: 'Evicted' },
  { key: 'LANDLORD_TERMINATED', label: 'Terminated by Prime' },
  { key: 'TENANT_BOUGHT', label: 'Bought the unit' },
];

/** Every month from `start` to `end` inclusive, as 'YYYY-MM'. */
export function monthsBetween(start: string, end: string): string[] {
  if (!start || !end) return [];
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return [];
  const out: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  // Bounded: a 30-year typo should not lock the browser building 360 rows.
  while (cursor <= to && out.length < 240) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/** Fields required on every backfill submission, regardless of which form collects them. */
export function requiredBackfillFieldError(values: {
  tenantName: string; leaseStart: string; leaseEnd: string;
  terminationDate: string; monthlyRent: string;
}): string | null {
  for (const [field, label] of [
    ['tenantName', 'tenant name'], ['leaseStart', 'lease start'], ['leaseEnd', 'lease end'],
    ['terminationDate', 'move-out date'], ['monthlyRent', 'monthly rent'],
  ] as const) {
    if (!values[field]) return `The ${label} is required`;
  }
  return null;
}

/**
 * Only months that DIFFER from paid-in-full. Sending the whole grid would make every
 * month an "override" and lose the distinction between "paid in full, as usual" and
 * "we checked, and it was 1,500".
 */
export function buildCollectionOverrides(
  collections: Record<string, string>, rent: number,
): Record<string, number> {
  const overrides: Record<string, number> = {};
  for (const [month, value] of Object.entries(collections)) {
    if (value !== '' && Number(value) !== rent) overrides[month] = Number(value);
  }
  return overrides;
}

/** The ledger it wrote, not a generic success — the month count is what the person
 *  entering it will want to sanity-check against their own records. */
export function backfillSuccessToast(res: {
  invoicesSettled: number; paidInFull: number; withCollectionOverride?: number;
}) {
  addToast({
    title:
      `Tenancy recorded — ${res.invoicesSettled} month(s) billed, `
      + `${res.paidInFull} paid in full`
      + (res.withCollectionOverride ? `, ${res.withCollectionOverride} adjusted` : ''),
    color: 'success',
  });
}

/**
 * Owns the fields that exist ONLY for a backfilled tenancy — everything else (tenant
 * name, dates, rent, deposit, notes) is collected by whichever host form embeds this.
 */
export function useTenancyBackfillState(leaseStart: string, monthlyRent: string) {
  const [terminationDate, setTerminationDate] = useState('');
  const [terminationReason, setTerminationReason] = useState('');
  const [collections, setCollections] = useState<Record<string, string>>({});
  const [showMonths, setShowMonths] = useState(false);

  const months = useMemo(
    () => monthsBetween(leaseStart, terminationDate),
    [leaseStart, terminationDate],
  );
  const rent = Number(monthlyRent) || 0;
  const today = new Date().toISOString().slice(0, 10);
  const endsInFuture = !!terminationDate && terminationDate > today;

  const reset = () => {
    setTerminationDate('');
    setTerminationReason('');
    setCollections({});
    setShowMonths(false);
  };

  return {
    terminationDate, setTerminationDate, terminationReason, setTerminationReason,
    collections, setCollections, showMonths, setShowMonths,
    months, rent, endsInFuture, reset,
  };
}

export type TenancyBackfillState = ReturnType<typeof useTenancyBackfillState>;

/** Moved-out date + reason + future-date warning + the collapsed-by-default collection
 *  grid. Rendered by both BackfillTenancyDialog and UnitDetailPage's inline toggle. */
export function TenancyBackfillFields({ state }: { state: TenancyBackfillState }) {
  const {
    terminationDate, setTerminationDate, terminationReason, setTerminationReason,
    collections, setCollections, showMonths, setShowMonths, months, rent, endsInFuture,
  } = state;

  const adjustedCount = Object.keys(collections).filter((m) => collections[m] !== '').length;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          size="sm"
          type="date"
          label="Moved out"
          description="When they actually left"
          isRequired
          value={terminationDate}
          onValueChange={setTerminationDate}
        />
        <Select
          size="sm"
          label="How it ended"
          selectedKeys={terminationReason ? [terminationReason] : []}
          onSelectionChange={(k) => setTerminationReason(String(Array.from(k)[0] ?? ''))}
        >
          {HISTORICAL_REASONS.map((r) => (
            <SelectItem key={r.key} textValue={r.label}>{r.label}</SelectItem>
          ))}
        </Select>
      </div>

      {endsInFuture && (
        <div className="flex items-start gap-2 rounded-md bg-amber-100 p-2.5 text-xs text-amber-900">
          <FiAlertTriangle className="mt-0.5 shrink-0" />
          <span>
            That move-out date is in the future, so this tenancy is still running — the
            server will refuse it here. Use a normal lease instead.
          </span>
        </div>
      )}

      {months.length > 0 && rent > 0 && (
        <div className="rounded-md border border-gray-200">
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm"
            onClick={() => setShowMonths((v) => !v)}
          >
            <span className="font-medium text-gray-700">
              Collection detail — {months.length} month(s)
            </span>
            <span className="text-xs text-gray-500">
              {adjustedCount ? `${adjustedCount} adjusted` : 'all paid in full'}
              {' · '}{showMonths ? 'hide' : 'edit'}
            </span>
          </button>
          {showMonths && (
            <div className="border-t border-gray-100 p-3">
              <p className="text-xs text-gray-500 mb-2">
                Leave a month blank to record it as paid in full ({fmt(rent)}). Enter 0
                for a month that was never collected.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                {months.map((m) => (
                  <Input
                    key={m}
                    size="sm"
                    type="number"
                    label={m}
                    placeholder={String(rent)}
                    value={collections[m] ?? ''}
                    onValueChange={(v) => setCollections((c) => ({ ...c, [m]: v }))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
