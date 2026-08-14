import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';
import { DocCategory } from '@prisma/client';

/**
 * Multipart bodies arrive as strings, and a browser `FormData` that has never had the
 * field touched still sends `expiresAt=''`. `@IsOptional()` only skips null/undefined, so
 * an empty string would fail `@IsDateString()` and 400 the whole upload. Normalise it to
 * undefined first.
 */
export const EmptyStringToUndefined = () =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value));

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

  /**
   * D2 — validity end date (ISO 8601). Optional for EVERY category, including the three
   * that genuinely lapse (PERMIT / NOC / POSSESSION_CERTIFICATE): back-filled and
   * historical documents legitimately have no known expiry, and refusing them would mean
   * the document simply never gets filed. Those categories are instead flagged on read
   * via `expiryExpected` so the UI can nag without blocking.
   */
  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  expiresAt?: string;
}
