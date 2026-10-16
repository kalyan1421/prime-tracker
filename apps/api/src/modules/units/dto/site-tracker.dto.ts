import {
  ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateIf,
} from 'class-validator';

/**
 * Site Tracker fields (Phase 1). Deliberately a separate DTO and a separate endpoint from
 * UpdateUnitDto: those fields are gated on `unit:edit`, which CONSTRUCTION does not hold
 * and SALES/MARKETING do. Blocker and site priority belong to the people on site.
 */
export class UpdateSiteTrackerDto {
  /**
   * 'YES' | 'NO' | null. Three states on purpose — null means nobody has assessed this
   * unit yet, which is a different claim from "not blocked".
   */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(['YES', 'NO'])
  blockerStatus?: 'YES' | 'NO' | null;

  /** Required by the service whenever blockerStatus is set to YES. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500)
  blockerReason?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100)
  sitePriority?: string | null;
}

export class SetUnitAssigneesDto {
  /** Full replacement set — send [] to clear. Capped to keep the avatar stack sane. */
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true })
  userIds!: string[];
}

export class SetSiteGroupDto {
  /**
   * The OTHER units this row covers — the lead is the unit in the URL. Full replacement;
   * [] makes it a single-unit row again. Thirty is far past any real fit-out (the largest
   * on the monday board covers six).
   */
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true })
  unitIds!: string[];
}
