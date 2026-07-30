import {
  IsString, IsNotEmpty, IsNumber, IsOptional, IsDateString, Min, MaxLength,
} from 'class-validator';

export class GenerateRentInvoicesDto {
  /** Bill up to this date. Defaults to today. */
  @IsOptional() @IsDateString()
  through?: string;
}

export class RecordRentPaymentDto {
  // Zero is allowed so a mis-keyed amount can be corrected down to nothing without
  // deleting the invoice; the service derives DUE/PARTIAL/PAID from it.
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  amountPaid!: number;

  @IsOptional() @IsDateString()
  paidAt?: string;

  // Free-text, matching LeaseObligationPayment's DTO — the UI offers
  // WIRE/CHECK/ACH/CASH/ADJUSTMENT but the column is not an enum.
  @IsOptional() @IsString() @MaxLength(100)
  method?: string;

  @IsOptional() @IsString() @MaxLength(120)
  reference?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class WaiveRentInvoiceDto {
  // Required: waiving a month's rent with no stated reason is not auditable.
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
