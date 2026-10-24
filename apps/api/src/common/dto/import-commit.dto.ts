import { IsDateString, IsNumber, IsOptional, Min, ValidateBy, ValidationOptions, buildMessage } from 'class-validator';

/**
 * Rows accepted by one import commit (sale or lease history).
 *
 * The commit routes took `@Body('rows') rows: any[]` — no validation and no bound, so one
 * request could ask for any number of rows, each a backfill that runs several writes in
 * sequence, all inside a single HTTP request. 1,000 is several times the whole portfolio
 * (≈500 units, so ≈500 sales or a few hundred tenancies per project file) while keeping
 * one request's work bounded; a bigger history is committed in more than one file.
 */
export const MAX_IMPORT_COMMIT_ROWS = 1000;

/**
 * Numbers in import rows come from a spreadsheet: they must be real numbers, but are NOT
 * held to two decimal places — a formula cell is routinely 1234.5600000001, the preview
 * accepted it, and refusing the whole commit over float noise would strand the import.
 * The services round on write (money columns are Decimal(14,2)).
 */
export const SPREADSHEET_NUMBER = { allowNaN: false, allowInfinity: false } as const;

/** One broker-commission installment carried on an import row. */
export class ImportCommissionInstallmentDto {
  @IsNumber(SPREADSHEET_NUMBER) @Min(0)
  amount!: number;

  @IsOptional() @IsDateString()
  paidAt?: string;
}

/**
 * A plain object whose every value is a finite number — e.g. a lease row's `collections`
 * ({ "2025-03": 4200 }). At most `maxKeys` entries, so the object itself is bounded too.
 */
export function IsNumberRecord(maxKeys: number, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNumberRecord',
      constraints: [maxKeys],
      validator: {
        validate: (value) => {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          return entries.length <= maxKeys
            && entries.every(([key, v]) => key.length <= 32 && typeof v === 'number' && Number.isFinite(v));
        },
        defaultMessage: buildMessage(
          (each) => `${each}$property must be an object of at most $constraint1 numeric values`,
          options,
        ),
      },
    },
    options,
  );
}
