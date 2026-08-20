/**
 * The single lease field set, shared by every place a lease can be created or edited:
 * the project Revenue tab, the Units-tab post-status-change prompt, and the Unit Detail
 * page. It lived inside ProjectDetailPage while UnitDetailPage kept its own six-field
 * copy, so deposit / escalation / rent-per-sqft were displayed on the unit page but not
 * editable there. Keeping one definition is the only way those stay in step.
 */
import React from 'react';
import { Input, Select, SelectItem, Switch } from '@heroui/react';
import { useBrokers } from '../hooks/useApi';

export const EMPTY_LEASE = {
  unitId: '', tenantName: '', tenantLegalName: '', tenantBrand: '',
  tenantContact: '', tenantEmail: '', tenantPhone: '', monthlyRent: '', rentPerSqft: '',
  nnnPerSqft: '', nnnTotalAmount: '',
  leaseStart: '', rentStartDate: '', leaseEnd: '', termMonths: '',
  escalationPct: '', escalationFreq: '',
  securityDeposit: '', tiAllowance: '', rentDueDay: '', freeRentMonths: '', freeRentStartDate: '',
  holdoverRatePct: '',
  brokerId: '', brokerCommissionBasis: '', brokerCommissionPct: '', brokerCommissionAmt: '',
  status: 'DRAFT', notes: '',
};

/**
 * How a leasing fee is calculated. A sale has one obvious base (the price); a lease
 * does not, and Prime has not confirmed which they use (open question Q12) — so the
 * basis is chosen per lease rather than assumed, and no fee is computed until it is.
 */
export const COMMISSION_BASES = [
  { key: 'FIRST_MONTH_RENT', label: "First month's rent", hint: '% of one month' },
  { key: 'TOTAL_TERM_RENT', label: 'Total term rent', hint: '% of rent across the whole term' },
  { key: 'FLAT', label: 'Flat fee', hint: "The broker's flat fee; % ignored" },
];

/**
 * Whole months from rent commencement to the rent end date.
 *
 * The term is DERIVED, here and on the server, from (rentStartDate || leaseStart) ->
 * leaseEnd. It used to be a free-text box that nothing validated against the dates,
 * while `summariseEffectiveRent` prefers it over what the rent periods actually cover
 * — so a mistyped term quietly skewed the effective-rent figure. Showing the derived
 * value live is also the only way the fit-out gap reads as intentional: enter a rent
 * start three months out and the term drops from 36 to 33 in front of you.
 */
export function deriveTermMonths(form: Record<string, string>): number | null {
  const origin = form.rentStartDate || form.leaseStart;
  if (!origin || !form.leaseEnd) return null;
  const a = new Date(`${origin}T00:00:00Z`);
  const b = new Date(`${form.leaseEnd}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return null;
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Days of fit-out between legal commencement and rent commencement. 0 when aligned. */
export function fitOutDays(form: Record<string, string>): number {
  if (!form.leaseStart || !form.rentStartDate) return 0;
  const a = new Date(`${form.leaseStart}T00:00:00Z`).getTime();
  const b = new Date(`${form.rentStartDate}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// Use T12:00:00 to anchor the date at noon UTC — avoids off-by-one day in any timezone.
const toApiDate = (d: string) => new Date(`${d}T12:00:00.000Z`).toISOString();

/** Shared by the LeasesTab modal and the UnitsTab "unit just became LEASED" prompt. */
export function validateLeaseForm(form: Record<string, string>): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!form.tenantName.trim()) errs.tenantName = 'Required';
  if (!form.monthlyRent) errs.monthlyRent = 'Required';
  if (!form.leaseStart) errs.leaseStart = 'Required';
  if (!form.leaseEnd) errs.leaseEnd = 'Required';
  // Rent cannot commence before the lease does — there is a CHECK constraint and a
  // service guard behind this; catching it here just saves a round-trip.
  if (form.rentStartDate && form.leaseStart && form.rentStartDate < form.leaseStart) {
    errs.rentStartDate = 'Cannot be before the lease start date';
  }
  if (form.holdoverRatePct) {
    const h = Number(form.holdoverRatePct);
    // Zero is not a discount, it is a mistake — it would generate months at no rent,
    // indistinguishable from free rent. Mirrors the DB CHECK.
    if (!Number.isFinite(h) || h <= 0) errs.holdoverRatePct = 'Must be greater than 0 (100 = the same rent)';
  }
  if (form.rentDueDay) {
    const d = Number(form.rentDueDay);
    if (!Number.isInteger(d) || d < 1 || d > 31) errs.rentDueDay = 'Must be a whole number between 1 and 31';
  }
  return errs;
}

/**
 * A lease row -> the form's string map.
 *
 * Both edit dialogs (project Revenue tab, Unit Detail) had their own hand-rolled copy
 * of this mapping, and they had already drifted — one of them silently dropped
 * rentPerSqft on edit. Adding rentStartDate and the NNN fields to two places would
 * have repeated that, so the mapping lives here with EMPTY_LEASE and the payload
 * builder it has to stay consistent with.
 */
export function leaseToForm(l: any, fallbackUnitId = ''): Record<string, string> {
  const day = (d: any) => (d ? String(d).slice(0, 10) : '');
  const num = (v: any) => (v != null && v !== '' ? String(Number(v)) : '');
  return {
    ...EMPTY_LEASE,
    unitId: l.unitId || l.unit?.id || fallbackUnitId || '',
    tenantName: l.tenantName || '',
    tenantLegalName: l.tenantLegalName || '',
    tenantBrand: l.tenantBrand || '',
    tenantContact: l.tenantContact || '',
    tenantEmail: l.tenantEmail || '',
    tenantPhone: l.tenantPhone || '',
    monthlyRent: num(l.monthlyRent),
    rentPerSqft: num(l.rentPerSqft),
    nnnPerSqft: num(l.nnnPerSqft),
    nnnTotalAmount: num(l.nnnTotalAmount),
    leaseStart: day(l.leaseStart || l.startDate),
    // Shown as the lease start when null, so the field is never blank next to a date
    // it must not precede. buildLeasePayload drops it again when the two match.
    rentStartDate: day(l.rentStartDate) || day(l.leaseStart || l.startDate),
    leaseEnd: day(l.leaseEnd || l.endDate),
    termMonths: l.termMonths != null ? String(l.termMonths) : '',
    escalationPct: num(l.escalationPct ?? l.annualEscalation),
    escalationFreq: l.escalationFreq != null ? String(l.escalationFreq) : '',
    securityDeposit: num(l.securityDeposit),
    tiAllowance: num(l.tiAllowance),
    rentDueDay: l.rentDueDay != null ? String(l.rentDueDay) : '',
    holdoverRatePct: l.holdoverRatePct != null ? String(l.holdoverRatePct) : '',
    freeRentMonths: l.freeRentMonths ? String(l.freeRentMonths) : '',
    freeRentStartDate: day(l.freeRentStartDate),
    brokerId: l.brokerId || '',
    brokerCommissionBasis: l.brokerCommissionBasis || '',
    brokerCommissionPct: num(l.brokerCommissionPct),
    brokerCommissionAmt: num(l.brokerCommissionAmt),
    status: l.status || 'DRAFT',
    notes: l.notes || '',
  };
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
    // Rent commencement. Omitted when it matches the lease start, so the column stays
    // null and keeps meaning "nobody has told us there is a fit-out gap" rather than
    // "there is definitely none".
    rentStartDate:
      form.rentStartDate && form.rentStartDate !== form.leaseStart
        ? toApiDate(form.rentStartDate)
        : undefined,
    leaseEnd: toApiDate(form.leaseEnd),
    // termMonths is derived server-side and whatever is sent is overwritten. Sent
    // anyway so the request body matches what the user was shown.
    termMonths: deriveTermMonths(form) ?? undefined,
    rentPerSqft: form.rentPerSqft ? parseFloat(form.rentPerSqft) : undefined,
    nnnPerSqft: form.nnnPerSqft ? parseFloat(form.nnnPerSqft) : undefined,
    // Only sent when overridden away from the derived figure — otherwise the server
    // recomputes it from the rate and the unit's area.
    nnnTotalAmount: form.nnnTotalAmount ? parseFloat(form.nnnTotalAmount) : undefined,
    escalationPct: form.escalationPct ? parseFloat(form.escalationPct) : undefined,
    escalationFreq: form.escalationFreq ? parseInt(form.escalationFreq, 10) : undefined,
    securityDeposit: form.securityDeposit ? parseFloat(form.securityDeposit) : undefined,
    tiAllowance: form.tiAllowance ? parseFloat(form.tiAllowance) : undefined,
    rentDueDay: form.rentDueDay ? parseInt(form.rentDueDay, 10) : undefined,
    // Blank must send NULL, not undefined: blank means "do not bill holdover", and
    // undefined would leave a previously-set rate in place when someone clears the field.
    holdoverRatePct: form.holdoverRatePct === '' ? null : parseFloat(form.holdoverRatePct),
    // Rent abatement. Free months sit inside the term; the rent-period generator emits
    // them as isFreeRent periods at rent 0. Sent as 0/undefined when the toggle is off
    // so switching it off actually clears an existing abatement.
    freeRentMonths: form.freeRentMonths ? parseInt(form.freeRentMonths, 10) : 0,
    freeRentStartDate: form.freeRentMonths && form.freeRentStartDate
      ? toApiDate(form.freeRentStartDate) : undefined,
    // Leasing commission (R23). The amount is computed server-side on activation from
    // the basis; it is only sent when the user overrode it.
    brokerId: form.brokerId || undefined,
    brokerCommissionBasis: form.brokerCommissionBasis || undefined,
    brokerCommissionPct: form.brokerCommissionPct ? parseFloat(form.brokerCommissionPct) : undefined,
    brokerCommissionAmt: form.brokerCommissionAmt ? parseFloat(form.brokerCommissionAmt) : undefined,
    status: form.status,
    notes: form.notes || undefined,
  };
}

/**
 * The one and only lease field set. Rendered by the LeasesTab create/edit modal and by the
 * UnitsTab post-status-change prompt so the two can never drift apart.
 */
export function LeaseFormFields({
  form, setForm, errors = {}, clearError, unitOptions, lockUnit = false, isHistorical = false,
}: {
  form: Record<string, string>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  errors?: Record<string, string>;
  clearError?: (field: string) => void;
  unitOptions: any[];
  lockUnit?: boolean;
  /** Hides fields the backfill endpoint (POST /leases/backfill) has nowhere to put —
   *  otherwise a value typed here would be silently discarded on save. Mirrors exactly
   *  what BackfillTenancyDialog exposes today. */
  isHistorical?: boolean;
}) {
  // Fetched here rather than prop-drilled through all three call sites. useBrokers is
  // gated on broker:view, so a viewer without it gets nothing back and the commission
  // block hides itself — no extra permission check needed at the call sites.
  const { data: brokersData } = useBrokers();
  const brokerOptions: any[] = Array.isArray(brokersData) ? brokersData : [];
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    clearError?.(field);
  };

  const term = deriveTermMonths(form);
  const gapDays = fitOutDays(form);
  // The one-time NNN total shown live beside the rate, so the per-sqft figure is
  // checkable against the sum that will actually be charged. Falls back to the unit's
  // sqft from the option list; the server recomputes authoritatively on save.
  const selectedUnit = unitOptions.find((u: any) => u.id === form.unitId);
  const unitSqft = Number(selectedUnit?.sqft) || 0;
  const nnnRate = parseFloat(form.nnnPerSqft);
  const derivedNnnTotal =
    Number.isFinite(nnnRate) && unitSqft > 0 ? Math.round(nnnRate * unitSqft * 100) / 100 : null;

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
      {!isHistorical && (
        <>
          <Input size="sm" label="Contact Person" value={form.tenantContact} onChange={set('tenantContact')} />
          <Input size="sm" label="Tenant Email" type="email" value={form.tenantEmail} onChange={set('tenantEmail')} />
          <Input size="sm" label="Tenant Phone" type="tel" value={form.tenantPhone} onChange={set('tenantPhone')} />
        </>
      )}
      <Input
        size="sm"
        label="Monthly Rent ($/month)"
        isRequired
        type="number"
        value={form.monthlyRent}
        onChange={set('monthlyRent')}
        isInvalid={!!errors.monthlyRent}
        errorMessage={errors.monthlyRent}
        description="Total contracted rent incl. NNN"
      />
      <Input
        size="sm"
        label="Lease Start (legal commencement)"
        isRequired
        type="date"
        value={form.leaseStart}
        onChange={set('leaseStart')}
        isInvalid={!!errors.leaseStart}
        errorMessage={errors.leaseStart}
        description="When the lease binds"
      />
      <Input
        size="sm"
        label="Rent Start (rent commencement)"
        type="date"
        value={form.rentStartDate}
        onChange={set('rentStartDate')}
        isInvalid={!!errors.rentStartDate}
        errorMessage={errors.rentStartDate}
        description={
          gapDays > 0
            ? `${gapDays} days of fit-out — no rent billed before this date`
            : 'Blank = rent starts with the lease. Set it later if fit-out delays rent.'
        }
      />
      <Input
        size="sm"
        label="Rent End (term expiry)"
        isRequired
        type="date"
        value={form.leaseEnd}
        onChange={set('leaseEnd')}
        isInvalid={!!errors.leaseEnd}
        errorMessage={errors.leaseEnd}
        description="Last day of the rent term"
      />
      {/* Derived, not entered. See deriveTermMonths. */}
      <Input
        size="sm"
        label="Term (months)"
        type="text"
        isReadOnly
        value={term != null ? String(term) : ''}
        placeholder="Set the dates"
        description="Calculated from rent start to rent end"
        classNames={{ input: 'text-gray-500' }}
      />
      {!isHistorical && (
        <>
          <Input size="sm" label="Base Rent ($/sqft/month)" type="number" value={form.rentPerSqft} onChange={set('rentPerSqft')} />
          <Input
            size="sm"
            label="NNN ($/sqft, one-time)"
            type="number"
            value={form.nnnPerSqft}
            onChange={set('nnnPerSqft')}
            description={
              derivedNnnTotal != null
                ? `= $${derivedNnnTotal.toLocaleString()} once, on ${unitSqft.toLocaleString()} sqft`
                : 'Quoted rate. Charged once at signing — not monthly.'
            }
          />
          <Input
            size="sm"
            label="NNN total override ($)"
            type="number"
            value={form.nnnTotalAmount}
            onChange={set('nnnTotalAmount')}
            description="Only for leases quoted as a flat one-time sum"
          />
          <Input
            size="sm"
            label="Escalation (% per step)"
            type="number"
            value={form.escalationPct}
            onChange={set('escalationPct')}
            description="Compounds, and applies to base rent only — never to NNN"
          />
          <Input
            size="sm"
            label="Escalation every (months)"
            type="number"
            value={form.escalationFreq}
            onChange={set('escalationFreq')}
            description="Blank = annual (12)"
          />
        </>
      )}
      {/* The three agreed sums, together. Each seeds a matching obligation on save, so
          the Deposits & Allowances panel is populated from the moment the lease exists
          rather than needing a second trip to enter the same numbers again. Editing an
          amount here follows through ONLY while nothing has been collected against it. */}
      <Input
        size="sm"
        label="Security Deposit ($ total)"
        type="number"
        value={form.securityDeposit}
        onChange={set('securityDeposit')}
        description="Tenant → Prime. Tracked in Deposits & Allowances."
      />
      {!isHistorical && (
        <Input
          size="sm"
          label="TI Allowance ($ total)"
          type="number"
          value={form.tiAllowance}
          onChange={set('tiAllowance')}
          description="Prime → Tenant. Disbursed in phases against this total."
        />
      )}
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
      {/* Holdover — occupancy past the contracted end.
          Blank is the default and means "do not bill", deliberately: the system cannot
          tell a real holdover from a lease nobody closed, and an invoice is permanent
          once generated. Leadership is notified either way. */}
      {!isHistorical && (
        <>
          <Input
            size="sm"
            label="Holdover rent (%)"
            type="number"
            min={1}
            value={form.holdoverRatePct}
            onChange={set('holdoverRatePct')}
            isInvalid={!!errors.holdoverRatePct}
            errorMessage={errors.holdoverRatePct}
            description="If they stay past the end date. 100 = same rent. Blank = do not bill."
          />
          {/* Not shown in historical mode: the backfill endpoint always derives
              EXPIRED/TERMINATED from the dates itself and ignores this field entirely. */}
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
        </>
      )}
      {/* Rent abatement. Free months sit INSIDE the term — leaseEnd is unchanged and the
          escalation clock still runs from leaseStart, so derived dates never contradict
          the signed contract. Turning the toggle off submits 0 months, which clears an
          existing abatement rather than leaving it stranded. */}
      {!isHistorical && (
      <div className="sm:col-span-2 rounded-xl border border-gray-100 p-3">
        <Switch
          size="sm"
          isSelected={!!form.freeRentMonths}
          onValueChange={(on) =>
            setForm((f) => ({
              ...f,
              freeRentMonths: on ? (f.freeRentMonths || '1') : '',
              // Anchored to RENT commencement, not legal commencement — abating
              // months during a fit-out the tenant already pays nothing for would
              // silently waste the concession.
              freeRentStartDate: on ? (f.freeRentStartDate || f.rentStartDate || f.leaseStart || '') : '',
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
              description="Billed at $0. Free months sit INSIDE the term — the rent end date does not move"
            />
            <Input
              size="sm"
              label="Free rent starts"
              type="date"
              value={form.freeRentStartDate}
              onChange={set('freeRentStartDate')}
              description="Defaults to rent commencement"
            />
          </div>
        )}
      </div>
      )}

      {/* Leasing commission (R23). Hidden entirely when the viewer cannot see brokers,
          rather than rendered empty — an unfillable Select reads as a broken form.
          The amount is computed server-side on activation from the chosen basis; the
          override box is for a fee negotiated outside the formula. Also hidden in
          historical mode: the backfill endpoint has no broker/commission fields. */}
      {!isHistorical && brokerOptions.length > 0 && (
        <div className="sm:col-span-2 rounded-xl border border-gray-100 p-3">
          <p className="text-xs font-semibold text-gray-600 mb-3">Leasing commission</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              size="sm"
              label="Broker"
              selectedKeys={form.brokerId ? [form.brokerId] : []}
              onSelectionChange={(keys) => {
                const val = (Array.from(keys)[0] as string) || '';
                setForm((f) => ({ ...f, brokerId: val }));
              }}
              description="Who brought the tenant"
            >
              {brokerOptions.map((b: any) => (
                <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              label="Commission basis"
              selectedKeys={form.brokerCommissionBasis ? [form.brokerCommissionBasis] : []}
              onSelectionChange={(keys) => {
                const val = (Array.from(keys)[0] as string) || '';
                setForm((f) => ({ ...f, brokerCommissionBasis: val }));
              }}
              isDisabled={!form.brokerId}
              description={
                form.brokerId && !form.brokerCommissionBasis
                  ? 'Required — no fee is calculated until this is set'
                  : 'How the fee is calculated'
              }
            >
              {COMMISSION_BASES.map((c) => (
                <SelectItem key={c.key} textValue={c.label} description={c.hint}>{c.label}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm"
              label="Commission (%)"
              type="number"
              value={form.brokerCommissionPct}
              onChange={set('brokerCommissionPct')}
              isDisabled={!form.brokerId || form.brokerCommissionBasis === 'FLAT'}
              description={
                form.brokerCommissionBasis === 'FLAT'
                  ? "Not used — a flat fee comes from the broker's record"
                  : "Blank = the broker's default rate"
              }
            />
            <Input
              size="sm"
              label="Commission override ($)"
              type="number"
              value={form.brokerCommissionAmt}
              onChange={set('brokerCommissionAmt')}
              isDisabled={!form.brokerId}
              description="Only for a fee agreed outside the formula"
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            The fee is calculated and stamped when the lease becomes ACTIVE, and
            recalculated if the broker, rate, basis, rent or term later changes.
          </p>
        </div>
      )}

      {/* Term summary — states the free-rent arithmetic in words, because "36 months
          with 3 free" is ambiguous until you say which number the tenant pays. The
          client asked whether 33 paying months recover the full 36-month value; they
          do not, and this line says so plainly rather than leaving it to be inferred
          from the schedule table. (Open question Q11: if Prime intends the grossed-up
          reading instead, the generator needs a mode — this text would change too.) */}
      {term != null && (
        <div className="sm:col-span-2 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
          <p className="text-xs text-gray-600">
            <span className="font-semibold">{term}-month term</span>
            {gapDays > 0 && <> · {gapDays} days fit-out before rent starts</>}
            {!!form.freeRentMonths && Number(form.freeRentMonths) > 0 ? (
              <>
                {' · '}{form.freeRentMonths} month{Number(form.freeRentMonths) === 1 ? '' : 's'} free
                {' · '}
                <span className="font-semibold text-emerald-700">
                  {Math.max(0, term - Number(form.freeRentMonths))} paying months
                </span>
                {form.monthlyRent && (
                  <> at {`$${Number(form.monthlyRent).toLocaleString()}`}/mo — the abated months are forgone, not recovered</>
                )}
              </>
            ) : (
              <> · {term} paying months</>
            )}
          </p>
        </div>
      )}

      <div className="sm:col-span-2">
        <Input size="sm" label="Notes" value={form.notes} onChange={set('notes')} />
      </div>
    </div>
  );
}
