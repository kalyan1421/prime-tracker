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
  // Splits lease.monthlyRent into base + NNN. Omit both and the whole
  // monthlyRent is treated as base rent. Zero is legal (a fully abated lease).
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  baseRent?: number;

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

  // Derived as baseRent + nnnAmount when omitted; validated against that sum when given.
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  monthlyRent?: number;

  // REQUIRED — a mid-term rent change with no stated reason is not auditable.
  // @IsNotEmpty rejects '' here; the service additionally rejects whitespace-only.
  @IsString() @IsNotEmpty() @MaxLength(1000)
  reason!: string;
}
