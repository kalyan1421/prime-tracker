import { IsString, IsNotEmpty, IsOptional, IsNumber, IsPositive, Min, IsDateString, MaxLength } from 'class-validator';
import { EmptyStringToUndefined } from '../../documents/dto/upload-document.dto';

export class AddScopeItemDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  description!: string;

  @IsOptional() @IsString() @MaxLength(100)
  category?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  quantity?: number;

  @IsOptional() @IsString() @MaxLength(50)
  unit?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  unitPrice?: number;
}

export class AddInteriorInvoiceDto {
  @IsString() @IsNotEmpty()
  vendorId!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount!: number;

  @IsOptional() @IsString() @MaxLength(100)
  invoiceNo?: string;

  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  invoiceDate?: string;
}
