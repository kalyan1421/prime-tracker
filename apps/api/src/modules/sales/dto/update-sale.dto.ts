import {
  IsString, IsOptional,
  IsNumber, IsPositive, IsDateString, MaxLength, IsEnum,
} from 'class-validator';
import { LostReason } from '@prisma/client';

// Note: projectId/unitId/buildingId are deliberately absent — a sale's project and
// asset link are fixed at creation. update() has no re-link logic, so accepting them
// would silently ignore the change rather than move the sale.
export class UpdateSaleDto {
  @IsOptional() @IsString() @MaxLength(200)
  buyer?: string;

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
