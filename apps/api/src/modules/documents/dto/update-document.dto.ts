import { IsString, IsOptional, IsNotEmpty, IsDateString } from 'class-validator';
import { EmptyStringToUndefined } from './upload-document.dto';

/**
 * Body for PATCH /documents/:id.
 *
 * This route used to take an inline `@Body() body: { fileName: string }`, which the global
 * ValidationPipe skips entirely (the metatype is Object) — so nothing was validated and
 * nothing could be whitelisted. A real DTO class re-enables whitelist +
 * forbidNonWhitelisted, which is what makes `expiresAt` reachable at all: an undeclared
 * field 400s under `forbidNonWhitelisted: true`.
 *
 * Both fields are optional and INDEPENDENT: a caller renaming a document must not have to
 * restate its expiry, and vice versa. Omitting a field leaves it untouched.
 */
export class UpdateDocumentDto {
  @IsOptional() @IsString() @IsNotEmpty()
  fileName?: string;

  /**
   * Tri-state, exactly like the notification preferences:
   *   omitted -> leave the stored expiry alone
   *   null    -> CLEAR it (the date was entered in error, or turned out not to apply)
   *   string  -> set it (ISO 8601)
   *
   * `@IsOptional()` skips validation for BOTH null and undefined, so null reaches the
   * service intact; the service tells "clear this" apart from "don't touch this" on key
   * presence, not on falsiness.
   */
  @IsOptional()
  @EmptyStringToUndefined()
  @IsDateString()
  expiresAt?: string | null;
}
