import { IsString, IsNotEmpty, IsNumber, IsPositive, IsDateString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { BudgetCategory } from '@prisma/client';

export class CreateActualDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsEnum(BudgetCategory)
  category!: BudgetCategory;

  @IsString() @IsNotEmpty() @MaxLength(500)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount!: number;

  @IsDateString()
  txnDate!: string;

  @IsOptional() @IsString() @MaxLength(200)
  vendor?: string;
}

export class UpdateActualDto {
  @IsOptional() @IsEnum(BudgetCategory)
  category?: BudgetCategory;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500)
  description?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount?: number;

  @IsOptional() @IsDateString()
  txnDate?: string;

  @IsOptional() @IsString() @MaxLength(200)
  vendor?: string;
}
