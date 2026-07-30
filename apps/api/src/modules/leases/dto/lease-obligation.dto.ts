import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { OBLIGATION_DIRECTIONS, OBLIGATION_KINDS } from '../lease-obligation.service';

/**
 * Bodies for the obligation ledger (security deposits + TI allowances).
 * Shapes mirror `CreateObligationInput` / `UpdateObligationInput` /
 * `RecordPaymentInput` minus what the controller supplies (leaseId from the
 * path, recordedById from the JWT).
 *
 * `status` and `paidAmount` are deliberately absent: both are derived by the
 * service and are never accepted from a caller. With `forbidNonWhitelisted` on,
 * a client that tries to set them gets a 400 rather than being silently ignored.
 */
export class CreateLeaseObligationDto {
  // Validated against the service's own constants so the two can't drift.
  @IsIn(OBLIGATION_KINDS)
  kind!: string;

  // Implied for SECURITY_DEPOSIT (FROM_TENANT) and TI_ALLOWANCE (TO_TENANT);
  // the service requires it for OTHER and rejects an inverted pair.
  @IsOptional() @IsIn(OBLIGATION_DIRECTIONS)
  direction?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  totalAmount!: number;

  @IsOptional() @IsDateString()
  dueDate?: string | null;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string | null;
}

export class UpdateLeaseObligationDto {
  // Accepted only so a caller that round-trips the whole row gets the service's
  // explicit "kind cannot be changed" error instead of an opaque whitelist 400.
  @IsOptional() @IsIn(OBLIGATION_KINDS)
  kind?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  totalAmount?: number;

  @IsOptional() @IsDateString()
  dueDate?: string | null;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string | null;
}

export class WaiveLeaseObligationDto {
  // REQUIRED — forgiving money without a stated reason is not auditable.
  @IsString() @IsNotEmpty() @MaxLength(1000)
  reason!: string;
}

export class RecordObligationPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount!: number;

  // Defaults to now in the service when omitted.
  @IsOptional() @IsDateString()
  paidAt?: string;

  @IsOptional() @IsString() @MaxLength(100)
  method?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  reference?: string | null;

  @IsOptional() @IsString()
  documentId?: string | null;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string | null;
}
