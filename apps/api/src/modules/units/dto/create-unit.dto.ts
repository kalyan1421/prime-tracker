import {
  IsString, IsNotEmpty, MinLength, MaxLength,
  IsOptional, IsNumber, IsPositive, IsBoolean, IsInt, Min, IsEnum,
} from 'class-validator';
import { UnitStatus } from '@prisma/client';

export class CreateUnitDto {
  @IsString() @IsNotEmpty()
  buildingId!: string;

  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(40)
  unitNumber!: string;

  @IsString() @IsNotEmpty()
  unitType!: string;

  // Validated against the UnitStatus enum, not accepted as any string. Until the column
  // became an enum this took @IsString(), so a typo'd status was written verbatim and the
  // unit then failed to appear in every status-filtered query and had no colour or label
  // in the UI — invisible rather than wrong.
  @IsOptional() @IsEnum(UnitStatus)
  status?: UnitStatus;

  @IsOptional() @IsInt() @Min(1)
  sqft?: number;

  @IsOptional() @IsNumber() @IsPositive()
  askingRent?: number;

  @IsOptional() @IsNumber() @IsPositive()
  askingPrice?: number;

  @IsOptional() @IsBoolean()
  primeOwned?: boolean;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
