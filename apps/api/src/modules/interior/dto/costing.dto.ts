import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional,
  IsString, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { EmptyStringToUndefined } from '../../documents/dto/upload-document.dto';

const PAYERS = ['PRIME', 'TENANT'];
const COST_TYPES = ['Subcontractor', 'Material', 'Labor', 'Equipment', 'Other'];
const CO_REASONS = ['Tenant request', 'Scope add', 'Cost increase', 'Plan change', 'Credit', 'Other'];
const ROLE_NAMES = [
  'SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP', 'PROJECT_MANAGER',
  'CONSTRUCTION', 'SALES', 'MARKETING', 'LEGAL', 'VIEWER',
];

export class EstimateLineDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  costCodeId?: string | null;

  @IsString() @IsNotEmpty() @MaxLength(500)
  description!: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  quantity?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20)
  unit?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  unitPrice?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(COST_TYPES)
  costType?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  supplier?: string | null;

  @IsOptional() @IsIn(PAYERS)
  paidBy?: string;
}

/** Every field optional — an inline edit changes one cell. */
export class UpdateEstimateLineDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  costCodeId?: string | null;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500)
  description?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  quantity?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20)
  unit?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  unitPrice?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(COST_TYPES)
  costType?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  supplier?: string | null;

  @IsOptional() @IsIn(PAYERS)
  paidBy?: string;
}

export class UnlockEstimateDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}

export class CreateChangeOrderDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  costCodeId?: string | null;

  /** Negative for a credit. */
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @IsIn(CO_REASONS)
  reason!: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  note!: string;

  @IsOptional() @IsIn(PAYERS)
  paidBy?: string;
}

export class DecideChangeOrderDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';
}

export class PurchaseOrderLineDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  costCodeId?: string | null;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  amount!: number;

  @IsOptional() @IsIn(PAYERS)
  paidBy?: string;
}

export class CreatePurchaseOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  /** An existing supplier — or `vendorName`, which finds or creates one by name. */
  @IsOptional() @IsString()
  vendorId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  vendorName?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  scope?: string;

  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  scheduledCompletion?: string;

  @IsOptional() @IsBoolean()
  materialsOnly?: boolean;

  @IsOptional() @IsBoolean()
  variance?: boolean;

  @IsOptional() @IsIn(['DRAFT', 'PENDING'])
  status?: 'DRAFT' | 'PENDING';

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}

export class CompletePurchaseOrderDto {
  @IsBoolean()
  complete!: boolean;
}

export class CostCodeDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20)
  code?: string | null;

  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20)
  groupCode?: string | null;

  @IsString() @IsNotEmpty() @MaxLength(120)
  groupName!: string;

  @IsOptional() @IsNumber() @Min(0)
  sortOrder?: number;
}

export class UpdateCostCodeDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20)
  code?: string | null;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120)
  name?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20)
  groupCode?: string | null;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120)
  groupName?: string;

  @IsOptional() @IsNumber() @Min(0)
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class InteriorSettingsDto {
  @IsOptional() @IsArray() @IsIn(ROLE_NAMES, { each: true })
  lockRoles?: string[];

  @IsOptional() @IsArray() @IsIn(ROLE_NAMES, { each: true })
  unlockRoles?: string[];

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  coLimit?: number;

  @IsOptional() @IsArray() @IsIn(ROLE_NAMES, { each: true })
  coApproverRoles?: string[];

  @IsOptional() @IsArray() @IsIn(ROLE_NAMES, { each: true })
  coAboveLimitRoles?: string[];

  @IsOptional() @IsArray() @IsIn(ROLE_NAMES, { each: true })
  poApproverRoles?: string[];

  @IsOptional() @IsArray() @IsIn(ROLE_NAMES, { each: true })
  varianceRoles?: string[];

  @IsOptional() @IsArray() @IsIn(ROLE_NAMES, { each: true })
  billApproverRoles?: string[];
}
