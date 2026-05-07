import {
  IsString, IsNotEmpty, MinLength, MaxLength,
  IsOptional, IsNumber, IsPositive, IsInt, Min, Max, IsEnum,
} from 'class-validator';
import { BuildingType, ProjectPhase } from '@prisma/client';

export class CreateBuildingDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(120)
  name!: string;

  @IsOptional() @IsNumber() @IsPositive()
  totalSqft?: number;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  stories?: number;

  @IsOptional() @IsEnum(BuildingType)
  buildingType?: BuildingType;

  @IsOptional() @IsEnum(ProjectPhase)
  phase?: ProjectPhase;
}
