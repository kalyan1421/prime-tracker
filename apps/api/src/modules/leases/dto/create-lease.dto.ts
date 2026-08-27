import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsDateString, MaxLength, Min, Max, IsInt, IsEmail, IsIn , ValidateIf } from 'class-validator';

export class CreateLeaseDto {
  // Sprint 1: leases are polymorphic — exactly one of (unitId, buildingId) is required.
  // Both individually optional here; service enforces the XOR.
  @IsOptional() @IsString()
  unitId?: string;

  @IsOptional() @IsString()
  buildingId?: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  tenantName!: string;

  // Tenant legal entity (signs the lease) vs brand (doing-business-as customer-facing).
  // Examples from client data: tenantLegalName "ABC LLC" + tenantBrand "Cream Stone".
  @IsOptional() @IsString() @MaxLength(200)
  tenantLegalName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantBrand?: string;

  /** Free text — the owning LLC named on the lease, if it varies property to property. */
  @IsOptional() @IsString() @MaxLength(200)
  landlordEntity?: string;

  // tenantContact is the contact PERSON's name; email/phone are stored separately so they
  // can be validated and rendered as links. Contact data only — tenants are never emailed
  // by the platform (notifications only ever address internal User rows).
  @IsOptional() @IsString() @MaxLength(200)
  tenantContact?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  tenantEmail?: string;

  @IsOptional() @IsString() @MaxLength(50)
  tenantPhone?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  monthlyRent!: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  rentPerSqft?: number;

  /**
   * NNN quoted per sqft. Charged ONCE at lease signing, not monthly — the total is
   * derived from this rate unless supplied. Money collected against it is tracked as a
   * LeaseObligation of kind NNN, the same way a security deposit is.
   */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  nnnPerSqft?: number;

  /** Overrides the derived total, for leases quoted as a flat one-time sum. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  nnnTotalAmount?: number;

  /** Legal commencement. */
  @IsDateString()
  leaseStart!: string;

  /** Rent commencement. Omit when rent starts with the lease. Never before leaseStart. */
  @IsOptional() @IsDateString()
  rentStartDate?: string;

  /** Rent end date — the term expiry. */
  @IsDateString()
  leaseEnd!: string;

  /**
   * DERIVED server-side from (rentStartDate ?? leaseStart) -> leaseEnd and overwritten
   * on every write. Still accepted so existing API clients do not break, but whatever
   * is sent is ignored — the dates are the single source of truth for the term.
   */
  @IsOptional() @IsInt() @IsPositive()
  termMonths?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  escalationPct?: number;

  @IsOptional() @IsInt() @IsPositive()
  escalationFreq?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  securityDeposit?: number;

  /**
   * Agreed tenant-improvement allowance — money Prime owes the TENANT. Seeds a
   * TI_ALLOWANCE obligation (direction TO_TENANT), which is where the phased
   * disbursements are then recorded.
   */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  tiAllowance?: number;


  // Rent abatement: free months sit INSIDE the term, so leaseEnd and the escalation clock
  // are unaffected. Defaults to leaseStart when freeRentStartDate is omitted.
  // Day of month rent falls due (1-31); omit for the 1st. Per-lease because Prime's
  // leases genuinely differ. The invoice generator clamps to month end, so 31 bills
  // 28 Feb (29 in a leap year) rather than rolling into March.
  @IsOptional() @IsInt() @Min(1) @Max(31)
  rentDueDay?: number;

  /**
   * Holdover rent as a percentage of the last paying rent, for months occupied past
   * leaseEnd. 100 = the same rent (client decision 2026-08-13).
   *
   * Nullable, and NULL is the default — it means "do not bill holdover on this lease".
   * The system cannot tell a genuine holdover from a lease nobody closed, and invoices
   * are permanent once generated, so billing waits for a person. Leadership is notified
   * either way. Must be explicitly nullable so clearing the field actually clears it.
   */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  holdoverRatePct?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(60)
  freeRentMonths?: number;

  @IsOptional() @IsDateString()
  freeRentStartDate?: string;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  // ---- Leasing commission (R23) ----
  /** Broker who brought the tenant. Internal-only; brokers have no login. */
  @IsOptional() @IsString()
  brokerId?: string;

  /** Per-lease override of Broker.commissionRate. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  brokerCommissionPct?: number;

  /**
   * How the fee is calculated. An amount is only computed when this is set — see
   * LeasesService.computeBrokerCommission. Prime's standard basis is open question Q12,
   * which is why it is recorded per lease rather than assumed.
   */
  @IsOptional() @IsIn(['FIRST_MONTH_RENT', 'TOTAL_TERM_RENT', 'FLAT'])
  brokerCommissionBasis?: string;

  /** Overrides the computed figure. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  brokerCommissionAmt?: number;

  /** Set when the commission is actually remitted to the broker. */
  @IsOptional() @IsDateString()
  brokerCommissionPaidAt?: string;

}

export class UpdateLeaseDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  tenantName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantLegalName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantBrand?: string;

  /** Free text — the owning LLC named on the lease, if it varies property to property. */
  @IsOptional() @IsString() @MaxLength(200)
  landlordEntity?: string;

  // Contact PERSON's name + their email/phone. Contact data only — the platform never
  // emails tenants (notifications only ever address internal User rows).
  @IsOptional() @IsString() @MaxLength(200)
  tenantContact?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  tenantEmail?: string;

  @IsOptional() @IsString() @MaxLength(50)
  tenantPhone?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  monthlyRent?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  rentPerSqft?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  nnnPerSqft?: number;

  /** One-time NNN total. See CreateLeaseDto. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  nnnTotalAmount?: number;

  @IsOptional() @IsDateString()
  leaseStart?: string;

  /** Rent commencement. Never before leaseStart. */
  @IsOptional() @IsDateString()
  rentStartDate?: string;

  @IsOptional() @IsDateString()
  leaseEnd?: string;

  /** DERIVED server-side — see CreateLeaseDto.termMonths. */
  @IsOptional() @IsInt() @IsPositive()
  termMonths?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  escalationPct?: number;

  @IsOptional() @IsInt() @IsPositive()
  escalationFreq?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  securityDeposit?: number;

  /**
   * Agreed tenant-improvement allowance — money Prime owes the TENANT. Seeds a
   * TI_ALLOWANCE obligation (direction TO_TENANT), which is where the phased
   * disbursements are then recorded.
   */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  tiAllowance?: number;


  // Rent abatement — see CreateLeaseDto: free months sit inside the term.
  // Day of month rent falls due (1-31); omit for the 1st. Per-lease because Prime's
  // leases genuinely differ. The invoice generator clamps to month end, so 31 bills
  // 28 Feb (29 in a leap year) rather than rolling into March.
  @IsOptional() @IsInt() @Min(1) @Max(31)
  rentDueDay?: number;

  /**
   * Holdover rent as a percentage of the last paying rent, for months occupied past
   * leaseEnd. 100 = the same rent (client decision 2026-08-13).
   *
   * Nullable, and NULL is the default — it means "do not bill holdover on this lease".
   * The system cannot tell a genuine holdover from a lease nobody closed, and invoices
   * are permanent once generated, so billing waits for a person. Leadership is notified
   * either way. Must be explicitly nullable so clearing the field actually clears it.
   */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  holdoverRatePct?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(60)
  freeRentMonths?: number;

  @IsOptional() @IsDateString()
  freeRentStartDate?: string;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  // ---- Leasing commission (R23) ----
  /** Broker who brought the tenant. Internal-only; brokers have no login. */
  @IsOptional() @IsString()
  brokerId?: string;

  /** Per-lease override of Broker.commissionRate. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  brokerCommissionPct?: number;

  /**
   * How the fee is calculated. An amount is only computed when this is set — see
   * LeasesService.computeBrokerCommission. Prime's standard basis is open question Q12,
   * which is why it is recorded per lease rather than assumed.
   */
  @IsOptional() @IsIn(['FIRST_MONTH_RENT', 'TOTAL_TERM_RENT', 'FLAT'])
  brokerCommissionBasis?: string;

  /** Overrides the computed figure. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  brokerCommissionAmt?: number;

  /** Set when the commission is actually remitted to the broker. */
  @IsOptional() @IsDateString()
  brokerCommissionPaidAt?: string;

}
