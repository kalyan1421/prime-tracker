import { IsString, IsNotEmpty, IsNumber, IsPositive, IsDateString, IsOptional, MaxLength } from 'class-validator';

export class CreateActualDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional() @IsString()
  buildingId?: string;

  @IsOptional() @IsString()
  unitId?: string;

  // Free-text key backed by CustomOption (category="budget_category") — see BudgetLine
  // schema comment. QuickBooks sync hardcodes 'OTHER' for unmapped transactions, which
  // stays a valid system default.
  @IsString() @IsNotEmpty() @MaxLength(100)
  category!: string;

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
  @IsOptional() @IsString()
  buildingId?: string | null;

  @IsOptional() @IsString()
  unitId?: string | null;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  category?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500)
  description?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount?: number;

  @IsOptional() @IsDateString()
  txnDate?: string;

  @IsOptional() @IsString() @MaxLength(200)
  vendor?: string;
}
