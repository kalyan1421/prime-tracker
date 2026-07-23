import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsEnum, IsDateString, MaxLength, IsInt, Min, Max } from 'class-validator';
import { DrawStatus } from '@prisma/client';

export class CreateLoanDto {
  // Sprint 1: a loan attaches at project- or building-level. At least one is
  // required; service enforces this (and back-fills projectId from the building
  // when only buildingId is set).
  @IsOptional() @IsString()
  projectId?: string;

  @IsOptional() @IsString()
  buildingId?: string;

  @IsOptional() @IsString()
  unitId?: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  loanType!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  lender!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  principalAmt!: number;

  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100)
  interestRate!: number;

  @IsInt() @IsPositive()
  termMonths!: number;

  @IsOptional() @IsDateString()
  maturityDate?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  currentBalance?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  monthlyPayment?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdateLoanDto {
  // Sprint 1 backend supported building/unit linkage on create but never exposed it
  // on update — a loan created at the wrong level had no way to be re-linked short of
  // delete-and-recreate. Allow explicit null to clear a linkage (e.g. detach from a unit).
  @IsOptional() @IsString()
  projectId?: string;

  @IsOptional() @IsString()
  buildingId?: string | null;

  @IsOptional() @IsString()
  unitId?: string | null;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  loanType?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  lender?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  principalAmt?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100)
  interestRate?: number;

  @IsOptional() @IsInt() @IsPositive()
  termMonths?: number;

  @IsOptional() @IsDateString()
  maturityDate?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  currentBalance?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  monthlyPayment?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class CreateDrawDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  requestedAmount?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount?: number;

  @IsOptional() @IsDateString()
  requestDate?: string;

  // Manual input for the same field the milestone-auto-draft path sets automatically
  // (+14 days) — lets DrawFundingOverdueCron cover manually-created draws too.
  @IsOptional() @IsDateString()
  expectedFundingDate?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdateDrawDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  requestedAmount?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount?: number;

  @IsOptional() @IsDateString()
  requestDate?: string;

  @IsOptional() @IsDateString()
  expectedFundingDate?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdateDrawStatusDto {
  @IsEnum(DrawStatus)
  status!: DrawStatus;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  approvedAmount?: number;

  @IsOptional() @IsString() @MaxLength(500)
  rejectionReason?: string;
}

export class UpsertDrawScheduleDto {
  @IsInt() @IsPositive()
  drawNumber!: number;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  plannedAmount!: number;

  @IsDateString()
  plannedDate!: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;
}
