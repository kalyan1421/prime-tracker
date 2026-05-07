import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsEnum, IsDateString, MaxLength, Min, IsInt } from 'class-validator';
import { LeaseStatus } from '@prisma/client';

export class CreateLeaseDto {
  @IsString() @IsNotEmpty()
  unitId!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  tenantName!: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantContact?: string;

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

  @IsOptional() @IsEnum(LeaseStatus)
  status?: LeaseStatus;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdateLeaseDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  tenantName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantContact?: string;

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

  @IsOptional() @IsEnum(LeaseStatus)
  status?: LeaseStatus;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}
