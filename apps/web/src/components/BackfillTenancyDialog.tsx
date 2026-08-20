/**
 * Enter a tenancy that has already ended (H2 backfill).
 *
 * This is data entry for history, and history has a property live data does not: it is
 * ALREADY SETTLED. So the dialog leads with what that means — the unit's current status
 * will not move, and every month is recorded as collected unless you say otherwise.
 * Somebody typing in 2019's tenant needs to know both of those before they start, not
 * discover them afterwards.
 *
 * The historical-only fields (moved-out date, reason, the collections grid) live in
 * TenancyBackfillFields — UnitDetailPage's "Save as rental history" toggle renders the
 * same component, so the two entry points can't drift on that part of the form.
 */

import { useState } from 'react';
import {
  Button, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea, addToast,
} from '@heroui/react';
import { FiArchive } from 'react-icons/fi';
import { useBackfillTenancy } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import {
  TenancyBackfillFields, useTenancyBackfillState,
  requiredBackfillFieldError, buildCollectionOverrides, backfillSuccessToast,
} from './TenancyBackfillFields';

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
  const historical = useTenancyBackfillState(form.leaseStart ?? '', form.monthlyRent ?? '');

  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const close = () => { setForm({}); historical.reset(); onClose(); };

  const submit = async () => {
    const error = requiredBackfillFieldError({
      tenantName: form.tenantName ?? '', leaseStart: form.leaseStart ?? '',
      leaseEnd: form.leaseEnd ?? '', terminationDate: historical.terminationDate,
      monthlyRent: form.monthlyRent ?? '',
    });
    if (error) return addToast({ title: error, color: 'warning' });

    const overrides = buildCollectionOverrides(historical.collections, historical.rent);

    try {
      const res = await backfill.mutateAsync({
        unitId,
        tenantName: form.tenantName.trim(),
        tenantLegalName: form.tenantLegalName || undefined,
        tenantBrand: form.tenantBrand || undefined,
        leaseStart: form.leaseStart,
        leaseEnd: form.leaseEnd,
        terminationDate: historical.terminationDate,
        terminationReason: historical.terminationReason || undefined,
        monthlyRent: Number(form.monthlyRent),
        rentStartDate: form.rentStartDate || undefined,
        securityDeposit: form.securityDeposit ? Number(form.securityDeposit) : undefined,
        rentDueDay: form.rentDueDay ? Number(form.rentDueDay) : undefined,
        notes: form.notes || undefined,
        collections: Object.keys(overrides).length ? overrides : undefined,
      });
      backfillSuccessToast(res);
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
              type="number"
              label="Monthly rent"
              value={form.monthlyRent ?? ''}
              onValueChange={set('monthlyRent')}
              isRequired
            />
          </div>

          <TenancyBackfillFields state={historical} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              type="date"
              label="Rent started"
              description="If later than the lease start"
              value={form.rentStartDate ?? ''}
              onValueChange={set('rentStartDate')}
            />
            <Input type="number" label="Deposit" value={form.securityDeposit ?? ''} onValueChange={set('securityDeposit')} />
          </div>

          <Textarea label="Notes" value={form.notes ?? ''} onValueChange={set('notes')} minRows={2} />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={close}>Cancel</Button>
          <Button color="primary" onPress={submit} isLoading={backfill.isPending} isDisabled={historical.endsInFuture}>
            Record tenancy
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
