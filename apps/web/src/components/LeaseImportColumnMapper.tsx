import { Select, SelectItem, Switch } from '@heroui/react';

/**
 * The mapping screen for R9 (generic column-mapping import) — see
 * docs/client-discovery/HISTORICAL_DATA_SHEET_IMPORT_SPEC.md.
 *
 * Shows one row per detected column: its raw header, a few sample values, and a dropdown
 * pre-filled with the backend's best guess at which of our fields it is. The user corrects
 * anything wrong before a single row is validated — this screen never touches the DB.
 *
 * Field list extended 2026-08-23 after auditing a real client sheet against it — several
 * of these (landlordEntity, tenantEmail/Phone, escalationPct, NNN, TI) were already real
 * Lease fields, just never exposed to import before.
 */

export const TENANCY_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: 'unitNumber', label: 'Unit Number', required: true },
  { key: 'building', label: 'Building' },
  { key: 'tenantName', label: 'Tenant Name', required: true },
  { key: 'tenantLegalName', label: 'Tenant Legal Name' },
  { key: 'tenantBrand', label: 'Tenant Brand' },
  { key: 'landlordEntity', label: 'Landlord / Owning Entity' },
  { key: 'tenantEmail', label: 'Tenant Email' },
  { key: 'tenantPhone', label: 'Tenant Phone' },
  { key: 'sqft', label: 'Sqft' },
  { key: 'leaseStart', label: 'Lease Start', required: true },
  { key: 'leaseEnd', label: 'Lease End', required: true },
  { key: 'leaseTermMonths', label: 'Lease Term (duration, e.g. "10 years")' },
  { key: 'terminationDate', label: 'Termination Date', required: true },
  { key: 'terminationReason', label: 'Termination Reason' },
  { key: 'monthlyRent', label: 'Monthly Rent', required: true },
  { key: 'rentPsf', label: 'Rent PSF' },
  { key: 'rentStartDate', label: 'Rent Start Date' },
  { key: 'escalationPct', label: 'Annual Increase %' },
  { key: 'securityDeposit', label: 'Security Deposit' },
  { key: 'nnnTotalAmount', label: 'NNN Total' },
  { key: 'nnnPsf', label: 'NNN PSF (informational)' },
  { key: 'tiAllowance', label: 'TI Allowance — Agreed Total' },
  { key: 'tiPsf', label: 'TI PSF (informational)' },
  { key: 'rentDueDay', label: 'Rent Due Day' },
  { key: 'brokerName', label: 'Broker Name' },
  { key: 'commissionInstallment1', label: 'Commission Installment 1 Amount' },
  { key: 'commissionInstallment2', label: 'Commission Installment 2 Amount' },
  { key: 'commissionInstallment3', label: 'Commission Installment 3 Amount' },
  { key: 'combinedDealRef', label: 'Combined Deal Reference' },
  { key: 'notes', label: 'Notes' },
];

const FIELD_LABEL: Record<string, string> = Object.fromEntries(TENANCY_FIELDS.map((f) => [f.key, f.label]));

export interface ColumnSelection {
  field: string; // '' = not imported
  splitEnabled: boolean; // only meaningful when the column has a splitSuggestion
}

interface Props {
  fields: {
    index: number;
    header: string;
    samples: string[];
    suggestedField: string | null;
    confidence: number;
    splitSuggestion?: { type: 'psf_total'; parts: [string, string] };
  }[];
  recordCount: number;
  selections: Record<number, ColumnSelection>;
  onChange: (index: number, selection: ColumnSelection) => void;
}

export function LeaseImportColumnMapper({ fields, recordCount, selections, onChange }: Props) {
  const mappedFieldKeys = new Set(
    fields.flatMap((f) => {
      const sel = selections[f.index];
      if (!sel) return [];
      if (sel.splitEnabled) return f.splitSuggestion?.parts ?? [];
      return sel.field ? [sel.field] : [];
    }),
  );
  const missingRequired = TENANCY_FIELDS.filter((f) => f.required && !mappedFieldKeys.has(f.key));

  return (
    <div className="space-y-4">
      {missingRequired.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800">
            Not yet mapped: {missingRequired.map((f) => f.label).join(', ')}. Rows will show as errors for whichever of these matter to them until every required field has a column.
          </p>
        </div>
      )}

      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="px-2 py-1.5 font-semibold">Column in your file</th>
              <th className="px-2 py-1.5 font-semibold">Sample values (up to 3 of your {recordCount} records)</th>
              <th className="px-2 py-1.5 font-semibold">Maps to</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const sel = selections[f.index] ?? { field: '', splitEnabled: false };
              const splitLabels = f.splitSuggestion ? f.splitSuggestion.parts.map((k) => FIELD_LABEL[k] ?? k) : null;
              return (
                <tr key={f.index} className="border-b border-gray-50 align-top">
                  <td className="px-2 py-2 font-medium text-gray-800 whitespace-nowrap">{f.header || `Column ${f.index + 1}`}</td>
                  <td className="px-2 py-2 text-gray-500">
                    {f.samples.length ? f.samples.slice(0, 3).join(' · ') : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2 py-2 min-w-[220px]">
                    {splitLabels ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Switch
                            size="sm"
                            isSelected={sel.splitEnabled}
                            onValueChange={(checked) => onChange(f.index, { field: '', splitEnabled: checked })}
                          />
                          <span className="text-gray-700">Split into {splitLabels[0]} + {splitLabels[1]}</span>
                        </div>
                        {!sel.splitEnabled && (
                          <Select
                            size="sm"
                            aria-label={`Field for ${f.header}`}
                            selectedKeys={sel.field ? [sel.field] : []}
                            onSelectionChange={(keys) => onChange(f.index, { field: (Array.from(keys)[0] as string) || '', splitEnabled: false })}
                          >
                            {[{ key: '', label: '— not imported —' }, ...TENANCY_FIELDS].map((opt) => (
                              <SelectItem key={opt.key} textValue={opt.label}>{opt.label}</SelectItem>
                            ))}
                          </Select>
                        )}
                      </div>
                    ) : (
                      <Select
                        size="sm"
                        aria-label={`Field for ${f.header}`}
                        selectedKeys={sel.field ? [sel.field] : []}
                        onSelectionChange={(keys) => onChange(f.index, { field: (Array.from(keys)[0] as string) || '', splitEnabled: false })}
                      >
                        {[{ key: '', label: '— not imported —' }, ...TENANCY_FIELDS].map((opt) => (
                          <SelectItem key={opt.key} textValue={opt.label}>{opt.label}</SelectItem>
                        ))}
                      </Select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
