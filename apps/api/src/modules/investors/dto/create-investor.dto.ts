import { IsString, IsNotEmpty, IsOptional, IsEmail, IsNumber, IsPositive, Min, Max, IsDateString, MaxLength } from 'class-validator';

export class CreateInvestorDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(200)
  entityName?: string;
}

export class UpdateInvestorDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(200)
  entityName?: string;
}

export class AddEquityPositionDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  pctOwnership!: number;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  committedAmt!: number;
}

export class CreateCapitalCallDto {
  @IsString() @IsNotEmpty()
  investorId!: string;

  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount!: number;

  @IsDateString()
  dueDate!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class CreateDistributionDto {
  @IsString() @IsNotEmpty()
  investorId!: string;

  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount!: number;

  @IsDateString()
  distDate!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  distType!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}
