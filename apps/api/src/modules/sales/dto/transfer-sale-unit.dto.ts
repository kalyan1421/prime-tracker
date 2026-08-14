import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * S3 — move a live sale from one unit to another, carrying the deal with it.
 *
 * Deliberately NOT part of UpdateSaleDto. A swap is not an edit: it writes two units,
 * two occupancy events, every percentage installment and an immutable transfer row, and
 * `PUT /sales/:id` with a different unitId would look like a one-field correction while
 * doing all of that silently.
 */
export class TransferSaleUnitDto {
  /** The unit the buyer is moving to. Must be in the same project and unencumbered. */
  @IsString()
  toUnitId!: string;

  /** When the switch takes effect. Defaults to today; both occupancy events carry it. */
  @IsOptional() @IsDateString()
  effectiveDate?: string;

  /**
   * The renegotiated price on the new unit. OMIT to carry the current price unchanged —
   * it is never derived from the new unit's asking price, because a sale price is a
   * negotiated number and guessing one would rewrite the deal.
   */
  @IsOptional() @IsNumber() @Min(0)
  newSalePrice?: number;

  /** Why the buyer switched — free text, shown on the sale's transfer history. */
  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}
