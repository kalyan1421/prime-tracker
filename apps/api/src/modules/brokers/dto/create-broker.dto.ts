import { IsString, IsNotEmpty, IsOptional, IsEmail, IsNumber, Min, Max, IsBoolean, MaxLength, IsPositive, IsDateString } from 'class-validator';

export class CreateBrokerDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(200)
  company?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  commissionRate?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  commissionFlat?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdateBrokerDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsString() @MaxLength(200)
  company?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  commissionRate?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  commissionFlat?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

/**
 * Body for POST /brokers/{sales|leases}/:id/commission-installments. Was an inline type
 * the ValidationPipe skipped, so a non-numeric or negative amount reached the ledger.
 */
export class AddCommissionInstallmentDto {
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }) @IsPositive()
  amount!: number;

  @IsOptional() @IsDateString()
  paidAt?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

/** Body for PATCH /brokers/commission-installments/:installmentId/mark-paid. Optional date. */
export class MarkInstallmentPaidDto {
  @IsOptional() @IsDateString()
  paidAt?: string;
}
