import { IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Bodies for the rent-timeline routes. Shapes mirror `GenerateOptions` /
 * `AddManualPeriodInput` in lease-rent-period.service.ts minus the fields the
 * controller supplies itself (leaseId from the path, createdById from the JWT).
 *
 * main.ts runs `forbidNonWhitelisted`, so every field the service accepts has to
 * be declared here or the request is rejected with a 400 before it reaches it.
 */
export class GenerateRentPeriodsDto {
  // Overrides lease.monthlyRent as the first period's base rent. Omit to use the
  // lease's own monthlyRent.
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  baseRent?: number;

  // Overrides the derived default (lease.nnnTotalAmount / 12). Omit to use that
  // default — NNN is re-negotiated by hand, never auto-escalated.
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  nnnAmount?: number;

  // Terms changed after periods already existed: rewrite the future, keep the past.
  // Without it generateForLease is a no-op on a lease that already has periods.
  @IsOptional() @IsBoolean()
  force?: boolean;
}

/** regenerateFuture takes the same rent split but never `force`/`createdById`. */
export class RegenerateFutureRentPeriodsDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  baseRent?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  nnnAmount?: number;
}

export class AddManualRentPeriodDto {
  @IsDateString()
  startDate!: string;

  // Omit (or null) for "runs to lease end".
  @IsOptional() @IsDateString()
  endDate?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  baseRent!: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  nnnAmount?: number;

  // Derived from baseRent + nnnAmount when omitted; validated against that sum when given.
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  monthlyRent?: number;

  // REQUIRED — a mid-term rent change with no stated reason is not auditable.
  // @IsNotEmpty rejects '' here; the service additionally rejects whitespace-only.
  @IsString() @IsNotEmpty() @MaxLength(1000)
  reason!: string;
}

/**
 * R22 — correcting a period that was already billed.
 *
 * Everything but the reason is optional: a correction usually moves one thing, and
 * requiring the whole row back invites resending a stale value nobody meant to change.
 * The service refuses a body where nothing actually differs.
 */
export class CorrectRentPeriodDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  baseRent?: number;

  @IsOptional() @IsDateString()
  startDate?: string;

  // null is meaningful — "runs to the end of the term" — so it is accepted distinctly
  // from the field being absent.
  @IsOptional() @IsDateString()
  endDate?: string | null;

  // Mandatory, and long enough to be worth reading. This row is the only account of why
  // a billed figure changed.
  @IsString() @IsNotEmpty() @MaxLength(1000)
  reason!: string;
}
