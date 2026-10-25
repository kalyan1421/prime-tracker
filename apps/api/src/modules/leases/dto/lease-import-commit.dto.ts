import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ImportCommissionInstallmentDto, IsNumberRecord, MAX_IMPORT_COMMIT_ROWS, SPREADSHEET_NUMBER,
} from '../../../common/dto/import-commit.dto';

/**
 * One previewed tenancy row (LeaseImportService's preview `data`, plus the `collections`
 * and `commissionInstallments` the auxiliary sheets join onto it). Exactly those keys —
 * with `forbidNonWhitelisted`, anything else is refused.
 *
 * As with the sale rows, required-ness stays the service's per-row check ("re-preview
 * before committing"), so one incomplete row does not sink the file; the DTO enforces
 * types and bounds.
 */
export class LeaseImportRowDto {
  @IsOptional() @IsString() @MaxLength(64)
  unitId?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  tenantName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantLegalName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  tenantBrand?: string;

  @IsOptional() @IsString() @MaxLength(200)
  landlordEntity?: string;

  @IsOptional() @IsString() @MaxLength(320)
  tenantEmail?: string;

  @IsOptional() @IsString() @MaxLength(50)
  tenantPhone?: string;

  @IsOptional() @IsDateString()
  leaseStart?: string;

  @IsOptional() @IsDateString()
  leaseEnd?: string;

  @IsOptional() @IsDateString()
  terminationDate?: string;

  @IsOptional() @IsString() @MaxLength(64)
  terminationReason?: string;

  @IsOptional() @IsNumber(SPREADSHEET_NUMBER) @Min(0)
  monthlyRent?: number;

  @IsOptional() @IsDateString()
  rentStartDate?: string;

  @IsOptional() @IsNumber(SPREADSHEET_NUMBER) @Min(0)
  securityDeposit?: number;

  @IsOptional() @IsNumber(SPREADSHEET_NUMBER) @Min(0)
  rentPerSqft?: number;

  @IsOptional() @IsNumber(SPREADSHEET_NUMBER)
  escalationPct?: number;

  @IsOptional() @IsNumber(SPREADSHEET_NUMBER) @Min(0)
  nnnPerSqft?: number;

  @IsOptional() @IsNumber(SPREADSHEET_NUMBER) @Min(0)
  nnnTotalAmount?: number;

  @IsOptional() @IsNumber(SPREADSHEET_NUMBER) @Min(0)
  tiAllowance?: number;

  @IsOptional() @IsNumber(SPREADSHEET_NUMBER)
  rentDueDay?: number;

  @IsOptional() @IsString() @MaxLength(64)
  brokerId?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  combinedDealRef?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  /** Month → amount collected, from the Ledger Exceptions sheet. ≤ 600 months (50 years). */
  @IsOptional() @IsNumberRecord(600)
  collections?: Record<string, number>;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ImportCommissionInstallmentDto)
  commissionInstallments?: ImportCommissionInstallmentDto[];
}

/** Body for POST /leases/backfill/import/commit. Was `@Body('rows') rows: ImportCommitRowInput[]`. */
export class LeaseImportCommitDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(MAX_IMPORT_COMMIT_ROWS)
  @ValidateNested({ each: true }) @Type(() => LeaseImportRowDto)
  rows!: LeaseImportRowDto[];
}
