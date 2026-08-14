import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { SaleCancellationDisposition } from '@prisma/client';

/**
 * What became of the money already collected, recorded alongside the cancellation.
 *
 * Mixed into UpdateSaleDto so the existing `PUT /sales/:id` with `status: 'CANCELLED'`
 * carries the ledger — one call, one transaction, the unit released and the money
 * accounted for together. main.ts runs ValidationPipe({ forbidNonWhitelisted: true }),
 * so these fields have to be declared or the whole cancellation 400s (which is exactly
 * what happened to the old modal, and why it stopped sending them).
 */
export class SaleCancellationFieldsDto {
  /**
   * Defaults to DECIDE_LATER in the service. Deliberately not defaulted here: a
   * disposition nobody chose should read as "nobody has decided", not as a decision.
   */
  @IsOptional() @IsEnum(SaleCancellationDisposition)
  cancellationDisposition?: SaleCancellationDisposition;

  /** Going back to the buyer. Required (with penaltyAmount) unless DECIDE_LATER. */
  @IsOptional() @IsNumber() @Min(0)
  refundAmount?: number;

  /** Retained by Prime. Required (with refundAmount) unless DECIDE_LATER. */
  @IsOptional() @IsNumber() @Min(0)
  penaltyAmount?: number;

  /** When the refund ACTUALLY moved — usually later than the decision, often never. */
  @IsOptional() @IsDateString()
  refundPaidAt?: string;

  @IsOptional() @IsString() @MaxLength(200)
  refundReference?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  cancellationNote?: string;
}

/**
 * Finance settling a DECIDE_LATER after the fact, or stamping the payment reference once
 * the money has actually moved. Same fields, same invariant — but reconciled against the
 * `totalCollected` SNAPSHOT taken when the sale was cancelled, never a fresh sum.
 */
export class SettleSaleCancellationDto {
  @IsOptional() @IsEnum(SaleCancellationDisposition)
  disposition?: SaleCancellationDisposition;

  @IsOptional() @IsNumber() @Min(0)
  refundAmount?: number;

  @IsOptional() @IsNumber() @Min(0)
  penaltyAmount?: number;

  @IsOptional() @IsDateString()
  refundPaidAt?: string;

  @IsOptional() @IsString() @MaxLength(200)
  refundReference?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}
