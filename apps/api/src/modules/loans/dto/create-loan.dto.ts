import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsEnum, IsDateString, MaxLength, IsInt, Min, Max } from 'class-validator';
import { LoanType, DrawStatus } from '@prisma/client';

export class CreateLoanDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional() @IsString()
  unitId?: string;

  @IsEnum(LoanType)
  loanType!: LoanType;

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
  @IsOptional() @IsEnum(LoanType)
  loanType?: LoanType;

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
