import { IsObject, ValidateIf } from 'class-validator';

/**
 * Partial update of an organization's OrgSettings row.
 *
 * Every field is optional and the service merges what it is given over what is already
 * stored, so adding `unitStaleDaysThreshold`, `budgetVarianceAlertPct`, etc. later is a
 * matter of declaring another optional property here plus a branch in the service — no
 * caller and no existing field changes shape.
 *
 * The service, not the DTO, rejects a body that sets nothing at all.
 */
export class UpdateOrgSettingsDto {
  /**
   * Sale stage → probability (0..1), e.g. `{ "PROSPECT": 0.15, "LOI_SIGNED": 0.4 }`.
   *
   * Only `@IsObject()` here on purpose. `main.ts` runs the pipe with
   * `whitelist: true, forbidNonWhitelisted: true`, which strips/rejects undeclared
   * properties — but that applies to properties of a *validated class*, and this value is
   * a free-form map, not a nested DTO. There is no class to declare its keys on, so
   * expressing it structurally would mean inventing one class per stage set and would
   * still not catch an unknown key any earlier than the service does.
   *
   * So the shape check stops at "it is a non-null, non-array object" and
   * `OrganizationsService.updateSettings` owns the real rules: known key, writable stage,
   * finite number in 0..1, and non-decreasing order across the merged result. Those
   * produce messages that name the offending key and say what is allowed, which
   * class-validator's generic per-property message cannot.
   */
  /**
   * `@ValidateIf(... !== undefined)` rather than `@IsOptional()`: IsOptional skips validation
   * for null as well as undefined, so an explicit `"saleStageProbabilities": null` would sail
   * through the pipe and land in the service, where it is neither "absent" (null !== undefined)
   * nor iterable. This way only a genuinely omitted field is skipped and null hits `@IsObject()`.
   */
  @ValidateIf((o: UpdateOrgSettingsDto) => o.saleStageProbabilities !== undefined)
  @IsObject()
  saleStageProbabilities?: Record<string, unknown>;
}
