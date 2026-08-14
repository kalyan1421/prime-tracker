/**
 * Enter a tenancy that has already ended (H2 backfill).
 *
 * This is data entry for history, and history has a property live data does not: it is
 * ALREADY SETTLED. So the dialog leads with what that means — the unit's current status
 * will not move, and every month is recorded as collected unless you say otherwise.
 * Somebody typing in 2019's tenant needs to know both of those before they start, not
 * discover them afterwards.
 *
 * The collection grid is the reason this is a dialog rather than a form field. The team
 * knows per-month collection history (client confirmed 2026-08-13), so the common case
 * is "all paid" with a handful of exceptions — which is exactly what a default-filled
 * grid with editable cells expresses, and what a per-month form would make unbearable.
 */

import { useMemo, useState } from 'react';
import {
  Button, Chip, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Select, SelectItem, Textarea, addToast,
} from '@heroui/react';
import { FiArchive, FiAlertTriangle } from 'react-icons/fi';
import { useBackfillTenancy } from '../hooks/useApi';
import { errMsg, fmt } from '../utils/fmt';

// Must match TERMINATION_REASONS in leases.service.ts. Only the endings that make sense
// for a record being entered after the fact — RENEWED/RELOCATED describe a continuing
// tenancy and are set by linking a successor, not by typing one in.
const HISTORICAL_REASONS = [
  { key: 'EXPIRED', label: 'Ran to the end of the term' },
  { key: 'NON_RENEWAL', label: 'Not renewed' },
  { key: 'EARLY_TERMINATION', label: 'Left early' },
  { key: 'MUTUAL', label: 'Ended by mutual agreement' },
  { key: 'EVICTION', label: 'Evicted' },
  { key: 'LANDLORD_TERMINATED', label: 'Terminated by Prime' },
  { key: 'TENANT_BOUGHT', label: 'Bought the unit' },
];

/** Every month from `start` to `end` inclusive, as 'YYYY-MM'. */
function monthsBetween(start: string, end: string): string[] {
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

export function BackfillTenancyDialog({
  unitId, unitNumber, isOpen, onClose,
}: {
  unitId: string;
  unitNumber?: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const backfill = useBackfillTenancy();
  const [form, setForm] = useState<Record<string, string>>({});
  /** Only months that DIFFER from paid-in-full. Sparse on purpose — see the note above. */
  const [collections, setCollections] = useState<Record<string, string>>({});
  const [showMonths, setShowMonths] = useState(false);

  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const months = useMemo(
    () => monthsBetween(form.leaseStart ?? '', form.terminationDate ?? ''),
    [form.leaseStart, form.terminationDate],
  );
  const rent = Number(form.monthlyRent) || 0;

  const today = new Date().toISOString().slice(0, 10);
  const endsInFuture = !!form.terminationDate && form.terminationDate > today;

  const close = () => { setForm({}); setCollections({}); setShowMonths(false); onClose(); };

  const submit = async () => {
    for (const [field, label] of [
      ['tenantName', 'tenant name'], ['leaseStart', 'lease start'],
      ['leaseEnd', 'lease end'], ['terminationDate', 'move-out date'],
      ['monthlyRent', 'monthly rent'],
    ] as const) {
      if (!form[field]) {
        addToast({ title: `The ${label} is required`, color: 'warning' });
        return;
      }
    }

    // Only send months the user actually changed. Sending the whole grid would make
    // every month an "override" and lose the distinction between "paid in full, as
    // usual" and "we checked, and it was 1,500".
    const overrides: Record<string, number> = {};
    for (const [month, value] of Object.entries(collections)) {
      if (value !== '' && Number(value) !== rent) overrides[month] = Number(value);
    }

    try {
      const res = await backfill.mutateAsync({
        unitId,
        tenantName: form.tenantName.trim(),
        tenantLegalName: form.tenantLegalName || undefined,
        tenantBrand: form.tenantBrand || undefined,
        leaseStart: form.leaseStart,
        leaseEnd: form.leaseEnd,
        terminationDate: form.terminationDate,
        terminationReason: form.terminationReason || undefined,
        monthlyRent: Number(form.monthlyRent),
        rentStartDate: form.rentStartDate || undefined,
        securityDeposit: form.securityDeposit ? Number(form.securityDeposit) : undefined,
        rentDueDay: form.rentDueDay ? Number(form.rentDueDay) : undefined,
        notes: form.notes || undefined,
        collections: Object.keys(overrides).length ? overrides : undefined,
      });
      // Report the ledger it wrote, not a generic success — the month count is the thing
      // the person entering it will want to sanity-check against their own records.
      addToast({
        title:
          `Tenancy recorded — ${res.invoicesSettled} month(s) billed, `
          + `${res.paidInFull} paid in full`
          + (res.withCollectionOverride ? `, ${res.withCollectionOverride} adjusted` : ''),
        color: 'success',
      });
      close();
    } catch (err) {
      addToast({ title: errMsg(err, 'Could not record the tenancy'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} size="3xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FiArchive className="text-slate-500" />
          Record a past tenancy{unitNumber ? ` — Unit ${unitNumber}` : ''}
        </ModalHeader>
        <ModalBody className="gap-4">
          {/* The two things that surprise people, stated before they type anything. */}
          <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">
            <p className="font-medium">This is for a tenancy that has already ended.</p>
            <ul className="mt-1 list-disc pl-5 space-y-0.5 text-slate-600">
              <li>The unit's <strong>current</strong> status will not change.</li>
              <li>
                Every month is recorded as <strong>paid in full</strong> unless you say
                otherwise, so old tenancies never show up as overdue rent.
              </li>
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Tenant name" value={form.tenantName ?? ''} onValueChange={set('tenantName')} isRequired />
            <Input label="Legal entity (LLC)" value={form.tenantLegalName ?? ''} onValueChange={set('tenantLegalName')} />
            <Input label="Brand / DBA" value={form.tenantBrand ?? ''} onValueChange={set('tenantBrand')} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input type="date" label="Lease start" value={form.leaseStart ?? ''} onValueChange={set('leaseStart')} isRequired />
            <Input type="date" label="Lease end (contracted)" value={form.leaseEnd ?? ''} onValueChange={set('leaseEnd')} isRequired />
            <Input
              type="date"
              label="Moved out"
              description="When they actually left"
              value={form.terminationDate ?? ''}
              onValueChange={set('terminationDate')}
              isRequired
            />
          </div>

          {endsInFuture && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <FiAlertTriangle className="mt-0.5 shrink-0" />
              <span>
                That move-out date is in the future, so this is a tenancy still running —
                add it as a normal lease instead. The server will refuse it here.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input
              type="number"
              label="Monthly rent"
              value={form.monthlyRent ?? ''}
              onValueChange={set('monthlyRent')}
              isRequired
            />
            <Input
              type="date"
              label="Rent started"
              description="If later than the lease start"
              value={form.rentStartDate ?? ''}
              onValueChange={set('rentStartDate')}
            />
            <Input type="number" label="Deposit" value={form.securityDeposit ?? ''} onValueChange={set('securityDeposit')} />
            <Select
              label="How it ended"
              selectedKeys={form.terminationReason ? [form.terminationReason] : []}
              onSelectionChange={(k) => set('terminationReason')(String(Array.from(k)[0] ?? ''))}
            >
              {HISTORICAL_REASONS.map((r) => (
                <SelectItem key={r.key} textValue={r.label}>{r.label}</SelectItem>
              ))}
            </Select>
          </div>

          {/* Collection detail, collapsed. The common case is "all paid" — opening this
              by default would imply the whole grid needs filling in, which it does not. */}
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
                  {Object.keys(collections).filter((m) => collections[m] !== '').length
                    ? `${Object.keys(collections).filter((m) => collections[m] !== '').length} adjusted`
                    : 'all paid in full'}
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

          <Textarea label="Notes" value={form.notes ?? ''} onValueChange={set('notes')} minRows={2} />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={close}>Cancel</Button>
          <Button color="primary" onPress={submit} isLoading={backfill.isPending} isDisabled={endsInFuture}>
            Record tenancy
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
