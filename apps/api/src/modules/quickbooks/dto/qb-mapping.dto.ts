import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for POST /quickbooks/mappings — was an inline type the ValidationPipe skipped. */
export class UpsertQbMappingDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  projectId!: string;

  @IsOptional() @IsString() @MaxLength(100)
  qbClassId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  qbClassName?: string;

  @IsOptional() @IsString() @MaxLength(100)
  qbLocationId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  qbLocationName?: string;
}
