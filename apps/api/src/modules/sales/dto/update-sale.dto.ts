import {
  IsString, IsOptional, IsEnum,
  IsNumber, IsPositive, IsDateString, MaxLength,
} from 'class-validator';
import { SaleStatus } from '@prisma/client';

export class UpdateSaleDto {
  @IsOptional() @IsString() @MaxLength(200)
  buyer?: string;

  @IsOptional() @IsNumber() @IsPositive()
  salePrice?: number;

  @IsOptional() @IsNumber() @IsPositive()
  depositAmt?: number;

  @IsOptional() @IsEnum(SaleStatus)
  status?: SaleStatus;

  @IsOptional() @IsDateString()
  loiDate?: string;

  @IsOptional() @IsDateString()
  contractDate?: string;

  @IsOptional() @IsDateString()
  closingDate?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
