import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * POST /auth/refresh.
 *
 * Shape only — the token is checked against its stored hash, so anything wrong with it is
 * a 401 from the service, not a 400 here. That distinction matters to the web client: it
 * treats only a 401/403 from refresh as "the session is over" (lib/api.ts), so a too-strict
 * format rule turning a dead token into a 400 would leave it retrying forever.
 */
export class RefreshTokenDto {
  @IsString() @IsNotEmpty() @MaxLength(512)
  refreshToken!: string;
}

/** POST /auth/logout. Without a token, every session the user has is revoked. */
export class LogoutDto {
  @IsOptional() @IsString() @MaxLength(512)
  refreshToken?: string;
}
