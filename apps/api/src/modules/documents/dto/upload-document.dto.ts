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

  /**
   * Attach this document to a SALE.
   *
   * Without it the stage gate could not be satisfied by any route. The gate reads
   * `document.saleId` (SalesService.assertStageDocumentsAttached), this DTO never carried
   * the field, and the service never wrote it — so "upload the Deed, NOC and Possession
   * Certificate to the sale" named a place the app had no way to put anything. Sales could
   * see exactly why a deal would not close and could do nothing about it.
   *
   * A sale-linked document is ALSO linked to the sale's unit, in the service — see
   * DocumentsService.create. The paperwork for a deal is paperwork about the unit, and
   * filing it in one place and not the other is how a Deed becomes findable only by
   * whoever remembers which sale it came in on.
   */
  @IsOptional() @IsString()
  saleId?: string;

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
