import { IsString, MinLength, MaxLength } from 'class-validator';

/**
 * Admin reset of ANOTHER user's password.
 *
 * Deliberately does not take the target's current password: the entire point is that an
 * admin uses this when the user cannot sign in. Self-service change lives at
 * POST /auth/change-password and does require it, because there an unattended session
 * must not be enough to take over the account.
 *
 * Bounds match ChangePasswordDto and UsersService.create so all three paths agree. The
 * ceiling is bcrypt's: it silently truncates past 72 bytes, which would make a longer
 * password weaker than it looks.
 */
export class SetUserPasswordDto {
  @IsString() @MinLength(8) @MaxLength(72)
  newPassword!: string;
}
