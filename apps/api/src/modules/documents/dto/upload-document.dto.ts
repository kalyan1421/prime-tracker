import { IsString, IsOptional, IsEnum } from 'class-validator';
import { DocCategory } from '@prisma/client';

export class UploadDocumentDto {
  @IsOptional() @IsString()
  projectId?: string;

  @IsOptional() @IsString()
  unitId?: string;

  @IsOptional() @IsEnum(DocCategory)
  category?: DocCategory;
}
