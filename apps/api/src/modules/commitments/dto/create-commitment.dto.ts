import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsEnum, IsDateString, MaxLength, Min } from 'class-validator';
import { BudgetCategory } from '@prisma/client';

export class CreateCommitmentDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  vendor!: string;

  @IsString() @IsNotEmpty() @MaxLength(500)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  contractAmt!: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  paidToDate?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  retainage?: number;

  @IsEnum(BudgetCategory)
  category!: BudgetCategory;

  @IsOptional() @IsDateString()
  contractDate?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdateCommitmentDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  vendor?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500)
  description?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  contractAmt?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  paidToDate?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  retainage?: number;

  @IsOptional() @IsEnum(BudgetCategory)
  category?: BudgetCategory;

  @IsOptional() @IsDateString()
  contractDate?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}
