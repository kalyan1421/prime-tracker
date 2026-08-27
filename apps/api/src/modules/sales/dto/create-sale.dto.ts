import {
  IsString, IsNotEmpty, IsOptional,
  IsNumber, IsPositive, IsDateString, MaxLength, IsEnum, Min, Max,
} from 'class-validator';
import { LostReason, SaleBuyerType } from '@prisma/client';

export class CreateSaleDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  // Sprint 1: exactly one of (unitId, buildingId) is required. Service-layer
  // enforcement; here both are individually optional so either can be omitted.
  @IsOptional() @IsString()
  unitId?: string;

  @IsOptional() @IsString()
  buildingId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  buyer?: string;

  /**
   * Who the buyer is relative to the sitting tenant. Decides what closing this sale does
   * to that tenancy: SITTING_TENANT ends it, THIRD_PARTY hands it over intact.
   *
   * Optional here, defaulting to SITTING_TENANT at the column, so existing API clients
   * keep working. The close dialog is required to make it an explicit choice with no
   * pre-selection (spec R2) — that is a UI obligation the backend deliberately does not
   * enforce, because a hard requirement would break every caller that predates the field.
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

  @IsOptional() @IsEnum(LostReason)
  lostReason?: LostReason;

  @IsOptional() @IsString() @MaxLength(2000)
  lostReasonNote?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  // Broker attribution (internal-only). Commission amount is computed server-side on close.
  @IsOptional() @IsString()
  brokerId?: string;

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  brokerCommissionPct?: number;
}
