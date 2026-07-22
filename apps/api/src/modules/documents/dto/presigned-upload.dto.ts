import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

/**
 * Body for POST /documents/presigned-upload. Was an inline `@Body()` type, which the
 * global ValidationPipe skips entirely (metatype is Object) — so filename length was
 * unbounded and projectId/category arrived unvalidated. A real DTO class re-enables
 * whitelist + forbidNonWhitelisted + the bounds below. The S3 key is additionally
 * sanitized in StorageService.buildPath (path-traversal defense-in-depth).
 */
export class PresignedUploadDto {
  @IsString() @IsNotEmpty() @MaxLength(255)
  filename!: string;

  @IsOptional() @IsString() @MaxLength(64)
  projectId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  projectName?: string;

  @IsOptional() @IsString() @MaxLength(64)
  category?: string;
}
