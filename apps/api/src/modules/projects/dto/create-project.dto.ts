import {
  IsString, IsNotEmpty, MinLength, MaxLength, Matches,
  IsOptional, IsEnum, IsNumber, IsPositive, IsDateString, Min,
} from 'class-validator';
import { ProjectType } from '@prisma/client';

export class CreateProjectDto {
  @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(80)
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: 'slug must be lowercase letters/numbers with optional dashes (no spaces or leading/trailing dashes)',
  })
  slug!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  location!: string;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @IsNumber() @IsPositive()
  acreage?: number;

  @IsOptional() @IsNumber() @Min(0)
  approvedBudget?: number;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  phase?: string;

  @IsOptional() @IsEnum(ProjectType)
  projectType?: ProjectType;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsDateString()
  targetEnd?: string;
}
