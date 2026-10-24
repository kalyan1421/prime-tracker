import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { IsStorageKey } from '../../../common/storage/storage-key';

/**
 * Body for POST /milestones/:id/photos. Was an inline type the ValidationPipe skipped, so
 * `storagePath` was stored unchecked and later handed to the signer — the one photo route
 * without the "relative bucket key, no traversal, not a URL" check that the task,
 * daily-log, update-board and checklist equivalents all carry.
 */
export class AttachMilestonePhotoDto {
  @IsString() @IsStorageKey()
  storagePath!: string;

  @IsOptional() @IsString() @MaxLength(300)
  caption?: string;
}

/** Body for PATCH /milestones/:id/depends-on. `dependsOnId` must be sent; `null` clears it. */
export class SetMilestoneDependencyDto {
  @ValidateIf((o) => o.dependsOnId !== null)
  @IsString() @MaxLength(64)
  dependsOnId!: string | null;
}
