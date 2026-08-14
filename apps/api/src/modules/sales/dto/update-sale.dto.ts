import {
  IsString, IsOptional,
  IsNumber, IsPositive, IsDateString, MaxLength, IsEnum,
} from 'class-validator';
import { LostReason, SaleBuyerType } from '@prisma/client';
import { SaleCancellationFieldsDto } from './sale-cancellation.dto';

// Note: projectId/unitId/buildingId are deliberately absent — a sale's project and
// asset link are fixed at creation. update() has no re-link logic, so accepting them
// would silently ignore the change rather than move the sale.
//
// Extends the cancellation fields rather than listing them here: they are one coherent
// group that also has to be strippable from the body before it reaches Prisma (none of
// them is a column on Sale), and the controller does that by name from one place.
export class UpdateSaleDto extends SaleCancellationFieldsDto {
  @IsOptional() @IsString() @MaxLength(200)
  buyer?: string;

  /**
   * Who the buyer is relative to the sitting tenant (S4/T1). Sent with the CLOSE, since
   * that is the request whose behaviour it changes: SITTING_TENANT ends the tenancy as
   * TENANT_BOUGHT, THIRD_PARTY leaves the rent schedule and invoices untouched and hands
   * the tenancy to the buyer.
   *
   * A value sent on this request beats the stored one — the answer to "who bought it" is
   * given at completion, not before it.
   */
  @IsOptional() @IsEnum(SaleBuyerType)
  buyerType?: SaleBuyerType;

  @IsOptional() @IsNumber() @IsPositive()
  salePrice?: number;

  @IsOptional() @IsNumber() @IsPositive()
  depositAmt?: number;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsDateString()
  loiDate?: string;

  @IsOptional() @IsDateString()
  contractDate?: string;

  @IsOptional() @IsDateString()
  closingDate?: string;

  @IsOptional() @IsDateString()
  expectedCloseDate?: string;

  // Captured when status -> CANCELLED; update() defaults it to OTHER if omitted.
  @IsOptional() @IsEnum(LostReason)
  lostReason?: LostReason;

  @IsOptional() @IsString() @MaxLength(2000)
  lostReasonNote?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  // Broker attribution (internal-only). Commission amount is computed server-side on close.
  @IsOptional() @IsString()
  brokerId?: string;

  @IsOptional() @IsNumber()
  brokerCommissionPct?: number;
}
