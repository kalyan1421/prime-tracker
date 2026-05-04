import {
  IsString, IsNotEmpty, MinLength, MaxLength,
  IsOptional, IsEnum, IsNumber, Min,
} from 'class-validator';
import { BudgetCategory } from '@prisma/client';

export class CreateBudgetLineDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsEnum(BudgetCategory)
  category!: BudgetCategory;

  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(200)
  description!: string;

  @IsNumber() @Min(0)
  baselineAmt!: number;

  @IsOptional() @IsNumber() @Min(0)
  revisedAmt?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
