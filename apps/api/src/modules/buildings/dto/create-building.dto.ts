import {
  IsString, IsNotEmpty, MinLength, MaxLength,
  IsOptional, IsNumber, IsPositive, IsInt, Min, Max, IsEnum,
} from 'class-validator';
import { BuildingType } from '@prisma/client';

export class CreateBuildingDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(120)
  name!: string;

  // Legal entity that owns the building (e.g. "Prime Leander I LLC"). Free-text label —
  // Prime tracks the LLC name per building, not LLC master data.
  @IsOptional() @IsString() @MaxLength(200)
  llcName?: string;

  @IsOptional() @IsNumber() @IsPositive()
  totalSqft?: number;

  // LOT-type buildings (raw parcels) are sized in acres rather than sqft — Decimal(10,3)
  // on the model, so fractional acreage like 1.27 or 11.98 is preserved. This was missing
  // from the DTO entirely, and main.ts runs forbidNonWhitelisted, so any client sending
  // `acreage` got a 400 and the field was unsettable through the buildings API.
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive()
  acreage?: number;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  stories?: number;

  @IsOptional() @IsEnum(BuildingType)
  buildingType?: BuildingType;

  @IsOptional() @IsString()
  phase?: string;

  @IsOptional() @IsString()
  coverPhotoPath?: string;
}
