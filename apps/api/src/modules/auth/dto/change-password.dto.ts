import { IsString, MinLength, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  // No MinLength here: the current password is only ever compared, never stored, and a
  // length rule on it would leak the old policy to an attacker probing the endpoint.
  @IsString()
  currentPassword!: string;

  // Matches the 8-character floor UsersService.create enforces when an admin sets an
  // initial password, so the two paths cannot disagree. The upper bound is bcrypt's:
  // it silently truncates beyond 72 bytes, which would make longer passwords weaker
  // than they appear.
  @IsString() @MinLength(8) @MaxLength(72)
  newPassword!: string;
}
