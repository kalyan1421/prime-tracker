import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsDateString, MaxLength, Min, Max, IsInt, IsEmail } from 'class-validator';

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

  @IsDateString()
  leaseStart!: string;

  @IsDateString()
  leaseEnd!: string;

  @IsInt() @IsPositive()
  termMonths!: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  escalationPct?: number;

  @IsOptional() @IsInt() @IsPositive()
  escalationFreq?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  securityDeposit?: number;

  // Rent abatement: free months sit INSIDE the term, so leaseEnd and the escalation clock
  // are unaffected. Defaults to leaseStart when freeRentStartDate is omitted.
  // Day of month rent falls due (1-31); omit for the 1st. Per-lease because Prime's
  // leases genuinely differ. The invoice generator clamps to month end, so 31 bills
  // 28 Feb (29 in a leap year) rather than rolling into March.
  @IsOptional() @IsInt() @Min(1) @Max(31)
  rentDueDay?: number;

  @IsOptional() @IsInt() @Min(0) @Max(60)
  freeRentMonths?: number;

  @IsOptional() @IsDateString()
  freeRentStartDate?: string;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdateLeaseDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  tenantName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantLegalName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantBrand?: string;

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

  @IsOptional() @IsDateString()
  leaseStart?: string;

  @IsOptional() @IsDateString()
  leaseEnd?: string;

  @IsOptional() @IsInt() @IsPositive()
  termMonths?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  escalationPct?: number;

  @IsOptional() @IsInt() @IsPositive()
  escalationFreq?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  securityDeposit?: number;

  // Rent abatement — see CreateLeaseDto: free months sit inside the term.
  // Day of month rent falls due (1-31); omit for the 1st. Per-lease because Prime's
  // leases genuinely differ. The invoice generator clamps to month end, so 31 bills
  // 28 Feb (29 in a leap year) rather than rolling into March.
  @IsOptional() @IsInt() @Min(1) @Max(31)
  rentDueDay?: number;

  @IsOptional() @IsInt() @Min(0) @Max(60)
  freeRentMonths?: number;

  @IsOptional() @IsDateString()
  freeRentStartDate?: string;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}
