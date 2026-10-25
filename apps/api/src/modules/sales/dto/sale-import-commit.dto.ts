import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ImportCommissionInstallmentDto, MAX_IMPORT_COMMIT_ROWS, SPREADSHEET_NUMBER,
} from '../../../common/dto/import-commit.dto';

/** A payment collected on a historical sale, as the importer's preview emits it. */
export class SaleImportPaymentDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  label!: string;

  @IsNumber(SPREADSHEET_NUMBER) @Min(0)
  amount!: number;

  @IsOptional() @IsDateString()
  paidAt?: string;
}

/**
 * One previewed sale row (SaleImportService.previewImport's `data`). Exactly the keys the
 * preview emits — with `forbidNonWhitelisted`, anything else is refused.
 *
 * Required-ness (unit, buyer, closing date, price) is deliberately NOT asserted here: the
 * service already reports a row missing them as that row's own failure ("re-preview
 * before committing") without sinking the rest of the file. What the DTO adds is types and
 * bounds — a price that is a real number, dates that are dates, strings of sane length.
 */
export class SaleImportRowDto {
  @IsOptional() @IsString() @MaxLength(64)
  unitId?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  seller?: string;

  @IsOptional() @IsString() @MaxLength(200)
  buyer?: string;

  @IsOptional() @IsNumber(SPREADSHEET_NUMBER) @Min(0)
  salePrice?: number;

  @IsOptional() @IsDateString()
  contractDate?: string;

  @IsOptional() @IsDateString()
  closingDate?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsString() @MaxLength(64)
  brokerId?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  combinedDealRef?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SaleImportPaymentDto)
  payments?: SaleImportPaymentDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ImportCommissionInstallmentDto)
  commissionInstallments?: ImportCommissionInstallmentDto[];
}

/** Body for POST /sales/backfill/import/commit. Was `@Body('rows') rows: any[]`. */
export class SaleImportCommitDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(MAX_IMPORT_COMMIT_ROWS)
  @ValidateNested({ each: true }) @Type(() => SaleImportRowDto)
  rows!: SaleImportRowDto[];
}
