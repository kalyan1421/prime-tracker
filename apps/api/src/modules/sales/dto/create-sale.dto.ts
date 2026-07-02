import {
  IsString, IsNotEmpty, IsOptional,
  IsNumber, IsPositive, IsDateString, MaxLength,
} from 'class-validator';

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

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  // Broker attribution (internal-only). Commission amount is computed server-side on close.
  @IsOptional() @IsString()
  brokerId?: string;

  @IsOptional() @IsNumber()
  brokerCommissionPct?: number;
}
