import {
  IsArray, IsDateString, IsEmail, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional,
  IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TERMINATION_REASONS, TerminationReason } from '../leases.service';

/** One broker-commission installment (R7). Mirrors HistoricalCommissionInstallmentDto on the sale side. */
export class BackfillCommissionInstallmentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  amount!: number;

  @IsOptional() @IsDateString()
  paidAt?: string;
}

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

  /** Free text — the owning LLC named on the lease, if it varies property to property. */
  @IsOptional() @IsString() @MaxLength(200)
  landlordEntity?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  tenantEmail?: string;

  @IsOptional() @IsString() @MaxLength(50)
  tenantPhone?: string;

  @IsDateString()
  leaseStart!: string;

  @IsDateString()
  leaseEnd!: string;

  /**
   * When they actually left. The service refuses a future date.
   * Omit entirely for a tenancy that's STILL GOING — the lease is created ACTIVE
   * instead of EXPIRED/TERMINATED.
   */
  @IsOptional() @IsDateString()
  terminationDate?: string;

  @IsOptional() @IsIn(TERMINATION_REASONS as unknown as string[])
  terminationReason?: TerminationReason;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  monthlyRent!: number;

  /** Rent commencement, if it differed from the lease start (a fit-out gap). */
  @IsOptional() @IsDateString()
  rentStartDate?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  securityDeposit?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  rentPerSqft?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  escalationPct?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  nnnPerSqft?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  nnnTotalAmount?: number;

  /** Agreed TI allowance — seeds a TI_ALLOWANCE obligation the same way a live lease does. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  tiAllowance?: number;

  @IsOptional() @IsInt() @Min(1) @Max(31)
  rentDueDay?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  /** R8 — links this lease to its sibling(s) on other units in the same combined deal. */
  @IsOptional() @IsString() @MaxLength(200)
  combinedDealRef?: string;

  @IsOptional() @IsString()
  brokerId?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BackfillCommissionInstallmentDto)
  commissionInstallments?: BackfillCommissionInstallmentDto[];

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
