import { IsString, IsNotEmpty, IsOptional, MaxLength, IsInt, Min } from 'class-validator';

/**
 * Body for POST /documents/presigned-upload. Was an inline `@Body()` type, which the
 * global ValidationPipe skips entirely (metatype is Object) — so filename length was
 * unbounded and projectId/category arrived unvalidated. A real DTO class re-enables
 * whitelist + forbidNonWhitelisted + the bounds below. The S3 key is additionally
 * sanitized in StorageService.buildPath (path-traversal defense-in-depth).
 *
 * `size` and `contentType` are what the URL gets bound to: StorageService checks the
 * pair against the upload allowlist and size cap, then signs both into the PUT, so the
 * bucket refuses a body of any other length or type.
 */
export class PresignedUploadDto {
  @IsString() @IsNotEmpty() @MaxLength(255)
  filename!: string;

  /** The browser's `File.type`. Checked against the extension; the signed type is derived. */
  @IsOptional() @IsString() @MaxLength(255)
  contentType?: string;

  /** Exact size in bytes (`File.size`). The PUT must send exactly this many. */
  @IsInt() @Min(1)
  size!: number;

  @IsOptional() @IsString() @MaxLength(64)
  projectId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  projectName?: string;

  @IsOptional() @IsString() @MaxLength(64)
  category?: string;
}

/** Multipart fields for POST /documents/upload-file — was an inline type the pipe skipped. */
export class UploadFileDto {
  @IsOptional() @IsString() @MaxLength(64)
  projectId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  projectName?: string;

  @IsOptional() @IsString() @MaxLength(64)
  category?: string;
}

/** Multipart fields for POST /documents/:id/replace — was an inline type the pipe skipped. */
export class ReplaceDocumentDto {
  @IsOptional() @IsString() @MaxLength(255)
  fileName?: string;
}
