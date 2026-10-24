import { IsString, Matches } from 'class-validator';

/**
 * A TOTP code, for /auth/mfa/enable, /disable and /verify.
 *
 * These took an inline `{ token: string }` the ValidationPipe never saw. Six digits is
 * what every authenticator app shows and what the web modals already enforce, so anything
 * else is refused before it costs a decrypt and a check.
 */
export class MfaTokenDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from your authenticator app' })
  token!: string;
}
