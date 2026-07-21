import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsDateString, MaxLength, Min } from 'class-validator';

export class CreateCommitmentDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional() @IsString()
  buildingId?: string;

  @IsOptional() @IsString()
  unitId?: string;

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

  // Free-text key backed by CustomOption (category="budget_category") — see BudgetLine
  // schema comment.
  @IsString() @IsNotEmpty() @MaxLength(100)
  category!: string;

  @IsOptional() @IsDateString()
  contractDate?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdateCommitmentDto {
  @IsOptional() @IsString()
  buildingId?: string | null;

  @IsOptional() @IsString()
  unitId?: string | null;

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

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  category?: string;

  @IsOptional() @IsDateString()
  contractDate?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}
