/**
 * The single lease field set, shared by every place a lease can be created or edited:
 * the project Revenue tab, the Units-tab post-status-change prompt, and the Unit Detail
 * page. It lived inside ProjectDetailPage while UnitDetailPage kept its own six-field
 * copy, so deposit / escalation / rent-per-sqft were displayed on the unit page but not
 * editable there. Keeping one definition is the only way those stay in step.
 */
import React from 'react';
import { Input, Select, SelectItem, Switch } from '@heroui/react';

export const EMPTY_LEASE = {
  unitId: '', tenantName: '', tenantLegalName: '', tenantBrand: '',
  tenantContact: '', tenantEmail: '', tenantPhone: '', monthlyRent: '', rentPerSqft: '',
  leaseStart: '', leaseEnd: '', termMonths: '', escalationPct: '', escalationFreq: '',
  securityDeposit: '', rentDueDay: '', freeRentMonths: '', freeRentStartDate: '',
  status: 'DRAFT', notes: '',
};

// Use T12:00:00 to anchor the date at noon UTC — avoids off-by-one day in any timezone.
const toApiDate = (d: string) => new Date(`${d}T12:00:00.000Z`).toISOString();

/** Shared by the LeasesTab modal and the UnitsTab "unit just became LEASED" prompt. */
export function validateLeaseForm(form: Record<string, string>): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!form.tenantName.trim()) errs.tenantName = 'Required';
  if (!form.monthlyRent) errs.monthlyRent = 'Required';
  if (!form.leaseStart) errs.leaseStart = 'Required';
  if (!form.leaseEnd) errs.leaseEnd = 'Required';
  if (form.rentDueDay) {
    const d = Number(form.rentDueDay);
    if (!Number.isInteger(d) || d < 1 || d > 31) errs.rentDueDay = 'Must be a whole number between 1 and 31';
  }
  return errs;
}

/** Lease payload WITHOUT unitId — immutable on update, the UpdateLeaseDto rejects it. */
export function buildLeasePayload(form: Record<string, string>): Record<string, unknown> {
  return {
    tenantName: form.tenantName,
    // The signing legal entity (LLC) and the trading/brand name are distinct from the
    // legacy tenantName, and both are already displayed across the app.
    tenantLegalName: form.tenantLegalName || undefined,
    tenantBrand: form.tenantBrand || undefined,
    tenantContact: form.tenantContact || undefined,
    tenantEmail: form.tenantEmail || undefined,
    tenantPhone: form.tenantPhone || undefined,
    monthlyRent: parseFloat(form.monthlyRent),
    leaseStart: toApiDate(form.leaseStart),
    leaseEnd: toApiDate(form.leaseEnd),
    termMonths: form.termMonths ? parseInt(form.termMonths) : undefined,
    rentPerSqft: form.rentPerSqft ? parseFloat(form.rentPerSqft) : undefined,
    escalationPct: form.escalationPct ? parseFloat(form.escalationPct) : undefined,
    escalationFreq: form.escalationFreq ? parseInt(form.escalationFreq, 10) : undefined,
    securityDeposit: form.securityDeposit ? parseFloat(form.securityDeposit) : undefined,
    rentDueDay: form.rentDueDay ? parseInt(form.rentDueDay, 10) : undefined,
    // Rent abatement. Free months sit inside the term; the rent-period generator emits
    // them as isFreeRent periods at rent 0. Sent as 0/undefined when the toggle is off
    // so switching it off actually clears an existing abatement.
    freeRentMonths: form.freeRentMonths ? parseInt(form.freeRentMonths, 10) : 0,
    freeRentStartDate: form.freeRentMonths && form.freeRentStartDate
      ? toApiDate(form.freeRentStartDate) : undefined,
    status: form.status,
    notes: form.notes || undefined,
  };
}

/**
 * The one and only lease field set. Rendered by the LeasesTab create/edit modal and by the
 * UnitsTab post-status-change prompt so the two can never drift apart.
 */
export function LeaseFormFields({
  form, setForm, errors = {}, clearError, unitOptions, lockUnit = false,
}: {
  form: Record<string, string>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  errors?: Record<string, string>;
  clearError?: (field: string) => void;
  unitOptions: any[];
  lockUnit?: boolean;
}) {
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    clearError?.(field);
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Select
        size="sm"
        label="Unit"
        isRequired
        isDisabled={lockUnit}
        description={lockUnit ? 'Locked to the unit you just updated' : undefined}
        selectedKeys={form.unitId ? [form.unitId] : []}
        onSelectionChange={(keys) => {
          const val = Array.from(keys)[0] as string;
          if (val) setForm((f) => ({ ...f, unitId: val }));
        }}
      >
        {unitOptions.map((u: any) => (
          <SelectItem key={u.id} textValue={u.unitNumber || u.name}>{u.unitNumber || u.name}</SelectItem>
        ))}
      </Select>
      <Input size="sm" label="Tenant Name" isRequired value={form.tenantName} onChange={set('tenantName')} isInvalid={!!errors.tenantName} errorMessage={errors.tenantName} />
      <Input
        size="sm"
        label="Tenant Legal Name (LLC)"
        value={form.tenantLegalName}
        onChange={set('tenantLegalName')}
        description="The entity that signs the lease"
      />
      <Input
        size="sm"
        label="Brand / DBA"
        value={form.tenantBrand}
        onChange={set('tenantBrand')}
        description="Shown in place of the tenant name across the app"
      />
      <Input size="sm" label="Contact Person" value={form.tenantContact} onChange={set('tenantContact')} />
      <Input size="sm" label="Tenant Email" type="email" value={form.tenantEmail} onChange={set('tenantEmail')} />
      <Input size="sm" label="Tenant Phone" type="tel" value={form.tenantPhone} onChange={set('tenantPhone')} />
      <Input size="sm" label="Monthly Rent ($)" isRequired type="number" value={form.monthlyRent} onChange={set('monthlyRent')} isInvalid={!!errors.monthlyRent} errorMessage={errors.monthlyRent} />
      <Input size="sm" label="Lease Start" isRequired type="date" value={form.leaseStart} onChange={set('leaseStart')} isInvalid={!!errors.leaseStart} errorMessage={errors.leaseStart} />
      <Input size="sm" label="Lease End" isRequired type="date" value={form.leaseEnd} onChange={set('leaseEnd')} isInvalid={!!errors.leaseEnd} errorMessage={errors.leaseEnd} />
      <Input size="sm" label="Term (months)" type="number" value={form.termMonths} onChange={set('termMonths')} />
      <Input size="sm" label="Rent per sqft ($)" type="number" value={form.rentPerSqft} onChange={set('rentPerSqft')} />
      <Input size="sm" label="Escalation %" type="number" value={form.escalationPct} onChange={set('escalationPct')} />
      <Input
        size="sm"
        label="Escalation every (months)"
        type="number"
        value={form.escalationFreq}
        onChange={set('escalationFreq')}
        description="Blank = annual (12)"
      />
      <Input size="sm" label="Security Deposit ($)" type="number" value={form.securityDeposit} onChange={set('securityDeposit')} />
      {/* Drives the due date on every generated rent invoice. Blank = the 1st. */}
      <Input
        size="sm"
        label="Rent Due Day (1-31)"
        type="number"
        min={1}
        max={31}
        value={form.rentDueDay}
        onChange={set('rentDueDay')}
        isInvalid={!!errors.rentDueDay}
        errorMessage={errors.rentDueDay}
        description="Day of the month rent is due. Leave blank to bill on the 1st."
      />
      <Select
        size="sm"
        label="Status"
        selectedKeys={form.status ? [form.status] : []}
        onSelectionChange={(keys) => {
          const val = Array.from(keys)[0] as string;
          if (val) setForm((f) => ({ ...f, status: val }));
        }}
      >
        {['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'].map((v) => (
          <SelectItem key={v} textValue={v}>{v}</SelectItem>
        ))}
      </Select>
      {/* Rent abatement. Free months sit INSIDE the term — leaseEnd is unchanged and the
          escalation clock still runs from leaseStart, so derived dates never contradict
          the signed contract. Turning the toggle off submits 0 months, which clears an
          existing abatement rather than leaving it stranded. */}
      <div className="sm:col-span-2 rounded-xl border border-gray-100 p-3">
        <Switch
          size="sm"
          isSelected={!!form.freeRentMonths}
          onValueChange={(on) =>
            setForm((f) => ({
              ...f,
              freeRentMonths: on ? (f.freeRentMonths || '1') : '',
              freeRentStartDate: on ? (f.freeRentStartDate || f.leaseStart || '') : '',
            }))
          }
        >
          <span className="text-sm">Free rent period</span>
        </Switch>
        {!!form.freeRentMonths && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            <Input
              size="sm"
              label="Free months"
              type="number"
              min={1}
              value={form.freeRentMonths}
              onChange={set('freeRentMonths')}
              description="Billed at $0; the term is not extended"
            />
            <Input
              size="sm"
              label="Free rent starts"
              type="date"
              value={form.freeRentStartDate}
              onChange={set('freeRentStartDate')}
              description="Defaults to the lease start"
            />
          </div>
        )}
      </div>
      <div className="sm:col-span-2">
        <Input size="sm" label="Notes" value={form.notes} onChange={set('notes')} />
      </div>
    </div>
  );
}
