import {
  IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min,
} from 'class-validator';
import { SalePaymentTrigger } from '@prisma/client';
import { PAYMENT_TEMPLATES } from '../sale-payments.service';

/**
 * Installment bodies. These four routes took inline `@Body()` types, which the global
 * ValidationPipe skips (the metatype is Object): an amount of "abc", a negative
 * percentage or an unknown trigger reached the service unchecked, and a template key of
 * "constructor" resolved to Object's own constructor and crashed the request.
 */
const MONEY = { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 } as const;

export class AddSalePaymentDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  label!: string;

  /** Give an amount, or a percentage of the sale price — the service needs one of them. */
  @IsOptional() @IsNumber(MONEY) @IsPositive()
  amount?: number;

  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  percentOfPrice?: number;

  @IsOptional() @IsEnum(SalePaymentTrigger)
  trigger?: SalePaymentTrigger;

  @IsOptional() @IsDateString()
  dueDate?: string;

  @IsOptional() @IsString() @MaxLength(64)
  milestoneId?: string;

  @IsOptional() @IsString() @MaxLength(64)
  interiorProjectId?: string;

  @IsOptional() @IsInt() @Min(0)
  sequence?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

export class UpdateSalePaymentDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  label?: string;

  @IsOptional() @IsNumber(MONEY) @IsPositive()
  amount?: number;

  @IsOptional() @IsDateString()
  dueDate?: string;

  /** `null` or '' detaches the milestone. */
  @IsOptional() @IsString() @MaxLength(64)
  milestoneId?: string | null;

  @IsOptional() @IsInt() @Min(0)
  sequence?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

export class ApplyPaymentTemplateDto {
  @IsIn(Object.keys(PAYMENT_TEMPLATES))
  template!: keyof typeof PAYMENT_TEMPLATES;
}

export class LogSalePaymentDto {
  @IsNumber(MONEY) @IsPositive()
  amount!: number;
}
