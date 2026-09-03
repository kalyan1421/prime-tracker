import {
  IsString, IsNotEmpty, IsOptional, IsIn, IsDateString, MaxLength,
} from 'class-validator';
import { EmptyStringToUndefined } from '../../documents/dto/upload-document.dto';

/** SnagStatus values, as strings — the client sends the enum name. */
export const SNAG_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;

export class CreateSnagDto {
  @IsString() @IsNotEmpty() @MaxLength(1000)
  description!: string;

  @IsOptional() @IsString() @MaxLength(120)
  room?: string;

  @IsOptional() @EmptyStringToUndefined() @IsString()
  assigneeId?: string;

  /**
   * Target date for the fix. Feeds the SNAG_OVERDUE daily check — which, until this was
   * reachable from the UI, could never fire because nothing ever set a due date.
   */
  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  dueDate?: string;

  /** The "before" / defect shot — a storage key from the presigned-upload flow. */
  @IsOptional() @EmptyStringToUndefined() @IsString() @MaxLength(500)
  photoPath?: string;
}

export class UpdateSnagDto {
  @IsOptional() @IsIn(SNAG_STATUSES as unknown as string[])
  status?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(1000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(120)
  room?: string;

  @IsOptional() @IsString()
  assigneeId?: string;

  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  dueDate?: string;

  /** Proof-of-fix ("after") shot — required to reach RESOLVED. */
  @IsOptional() @IsString() @MaxLength(500)
  afterPhotoPath?: string;
}

export class ResolveSnagDto {
  @IsOptional() @IsString() @MaxLength(500)
  afterPhotoPath?: string;
}
