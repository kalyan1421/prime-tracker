import { Type, Transform } from 'class-transformer';
import {
  IsOptional, IsEnum, IsString, IsInt, Min, Max, IsIn, MaxLength, IsBoolean,
} from 'class-validator';
import { ProjectType } from '@prisma/client';

export class ListProjectsDto {
  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  phase?: string;

  @IsOptional() @IsEnum(ProjectType)
  projectType?: ProjectType;

  @IsOptional() @IsString() @MaxLength(120)
  search?: string;

  @IsOptional() @IsIn(['name', 'phase', 'budget', 'createdAt', 'updatedAt'])
  sortBy?: 'name' | 'phase' | 'budget' | 'createdAt' | 'updatedAt';

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;

  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean()
  archived?: boolean;
}
