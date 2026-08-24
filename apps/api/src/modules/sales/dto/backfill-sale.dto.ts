import {
  IsArray, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional,
  IsString, Min, MaxLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SaleBuyerType } from '@prisma/client';

/**
 * One installment against the sale — a deposit, a second payment, whatever the historical
 * record actually shows. Composes the existing Sale Payment Schedule (`SalePayment`)
 * rather than inventing flat "depositDate"/"secondPaymentDate" columns (R4 spec).
 */
export class HistoricalSalePaymentDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  label!: string; // "Deposit" | "Second Payment" | ...

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  amount!: number;

  /** When it was actually collected. Omitted = treated as collected on the closing date. */
  @IsOptional() @IsDateString()
  paidAt?: string;
}

/** One broker-commission installment (R7). Omit entirely to auto-derive a single one. */
export class HistoricalCommissionInstallmentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  amount!: number;

  @IsOptional() @IsDateString()
  paidAt?: string;
}

/**
 * A sale that already closed, entered by hand (R4). Note what is NOT here: no `status` —
 * a backfilled sale is always CLOSED, exactly as a backfilled tenancy is always EXPIRED or
 * TERMINATED, never something the caller gets to leave ambiguous.
 */
export class BackfillSaleDto {
  @IsOptional() @IsString()
  unitId?: string;

  @IsOptional() @IsString()
  buildingId?: string;

  /** Free text — Prime Tracker has no structured owning-entity/LLC model (see spec Non-Goals). */
  @IsOptional() @IsString() @MaxLength(200)
  seller?: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  buyer!: string;

  @IsOptional() @IsEnum(SaleBuyerType)
  buyerType?: SaleBuyerType;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  salePrice!: number;

  /** Sale agreement / executed date. */
  @IsOptional() @IsDateString()
  contractDate?: string;

  /** Required — the service refuses a future date. This is what flips the unit SOLD. */
  @IsDateString()
  closingDate!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsString()
  brokerId?: string;

  @IsOptional() @IsNumber()
  brokerCommissionPct?: number;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => HistoricalSalePaymentDto)
  payments?: HistoricalSalePaymentDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => HistoricalCommissionInstallmentDto)
  commissionInstallments?: HistoricalCommissionInstallmentDto[];
}
