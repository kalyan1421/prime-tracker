import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { NotificationType } from '@prisma/client';

/** Body for POST /notifications/read — omit `ids` to mark everything read. */
export class MarkNotificationsReadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true })
  ids?: string[];
}

/**
 * Body for PUT /notifications/preferences. Both channels optional and independent: the
 * settings page changes one at a time, and `emailEnabled: null` (clear the override back
 * to the tier default) is distinct from omitting the field. The type must be a real
 * NotificationType — it was a free string, so a typo created a preference row for a type
 * that does not exist.
 */
export class SetNotificationPreferenceDto {
  @IsEnum(NotificationType)
  type!: NotificationType;

  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsBoolean()
  emailEnabled?: boolean | null;
}
