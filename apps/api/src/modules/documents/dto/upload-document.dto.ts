import { IsString, IsOptional, IsEnum } from 'class-validator';
import { DocCategory } from '@prisma/client';

export class UploadDocumentDto {
  @IsOptional() @IsString()
  projectId?: string;

  @IsOptional() @IsString()
  unitId?: string;

  @IsOptional() @IsString()
  interiorProjectId?: string;

  @IsOptional() @IsEnum(DocCategory)
  category?: DocCategory;

  /** Optional custom display name. Falls back to the uploaded file's name. */
  @IsOptional() @IsString()
  displayName?: string;
}
