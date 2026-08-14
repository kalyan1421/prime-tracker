import {
  IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional,
  IsString, Max, MaxLength, Min,
} from 'class-validator';
import { TERMINATION_REASONS, TerminationReason } from '../leases.service';

/**
 * A tenancy that has already ended, entered by hand (H2).
 *
 * Note what is NOT here: no `status`. A backfilled tenancy is EXPIRED or TERMINATED and
 * the service derives which from the dates, exactly as endTenancy does — letting a
 * caller choose would allow a "historical" record that claims to still be running.
 */
export class BackfillTenancyDto {
  @IsString() @IsNotEmpty()
  unitId!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  tenantName!: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantLegalName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantBrand?: string;

  @IsDateString()
  leaseStart!: string;

  @IsDateString()
  leaseEnd!: string;

  /** When they actually left. The service refuses a future date — that is a live lease. */
  @IsDateString()
  terminationDate!: string;

  @IsOptional() @IsIn(TERMINATION_REASONS as unknown as string[])
  terminationReason?: TerminationReason;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  monthlyRent!: number;

  /** Rent commencement, if it differed from the lease start (a fit-out gap). */
  @IsOptional() @IsDateString()
  rentStartDate?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  securityDeposit?: number;

  @IsOptional() @IsInt() @Min(1) @Max(31)
  rentDueDay?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  /**
   * Months where collection differed from paid-in-full, keyed 'YYYY-MM'.
   *
   * Left loose deliberately: the shape is a sparse map over an unknown span of months,
   * and enumerating them in a DTO would mean regenerating it per lease. The service
   * validates each key against the ledger it actually generated, which is the only
   * check that means anything.
   */
  @IsOptional() @IsObject()
  collections?: Record<string, number>;
}
