import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The identity fields a person may change about themselves, and the same set an admin
 * may change on someone else. Deliberately excludes `email` (the OAuth identity key),
 * `role`, `roles` and `isActive` — those are authorization, not identity, and live on
 * their own admin-only routes. Keeping them out of this DTO means the global
 * ValidationPipe rejects the request outright rather than relying on the service to
 * remember to ignore them, so a Viewer cannot promote themselves by adding a field.
 */
export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(500)
  avatarUrl?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(120)
  jobTitle?: string;
}
