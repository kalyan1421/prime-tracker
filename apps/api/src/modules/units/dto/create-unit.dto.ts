import {
  IsString, IsNotEmpty, MinLength, MaxLength,
  IsOptional, IsEnum, IsNumber, IsPositive, IsBoolean, IsInt, Min,
} from 'class-validator';
import { UnitType } from '@prisma/client';

export class CreateUnitDto {
  @IsString() @IsNotEmpty()
  buildingId!: string;

  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(40)
  unitNumber!: string;

  @IsEnum(UnitType)
  unitType!: UnitType;

  @IsOptional() @IsString()
  status?: string;

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
