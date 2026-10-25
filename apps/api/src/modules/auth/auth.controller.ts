import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  SetMetadata,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService, GoogleProfile, LoginContext } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto, RefreshTokenDto } from './dto/refresh-token.dto';
import { MfaTokenDto } from './dto/mfa-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/index';
import { ConfigService } from '@nestjs/config';
import { GoogleAuthGuard } from './google-auth.guard';

/** Request origin for the audit row. Behind the proxy, `trust proxy` makes req.ip the client. */
function clientOf(req: Request): LoginContext {
  const ua = req.headers?.['user-agent'];
  return { ipAddress: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 512) : undefined };
}

/**
 * Rate limits on this controller use the throttler name `medium`, NOT `default`.
 *
 * ThrottlerModule.forRoot (app.module.ts) registers three NAMED throttlers — short, medium,
 * long — and no unnamed one. ThrottlerGuard resolves a per-route override by reading the
 * metadata key `THROTTLER_LIMIT_<name>` for each configured throttler, so `@Throttle({
 * default: ... })` set a key (`..._default`) that nothing ever looks up: every limit below
 * was silently discarded and the global ceiling applied instead. That meant 100 requests a
 * minute against /auth/login and, worse, against /auth/mfa/verify — 100 guesses a minute at
 * a 6-digit TOTP code, with no account lockout anywhere.
 *
 * `medium` is the per-minute tier, so overriding it is what tightens a per-minute limit.
 * The short (10/sec) and long (1000/15min) tiers still apply on top; all three must pass,
 * so the tightest wins. throttle-names.spec.ts fails if a `default` key reappears.
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  @Post('login')
  @SetMetadata('isPublic', true)
  @Throttle({ medium: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() body: LoginDto, @Req() req: Request) {
    return this.authService.loginWithPassword(body.email, body.password, clientOf(req));
  }

  @Get('google')
  @SetMetadata('isPublic', true)
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google SSO login' })
  googleLogin() {
    // Passport redirects to Google
  }

  @Get('google/callback')
  @SetMetadata('isPublic', true)
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google SSO callback' })
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const profile = req.user as GoogleProfile;

    const result = await this.authService.validateGoogleUser(profile, clientOf(req));
    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:5173');

    // Tokens go in the URL FRAGMENT, not the query string.
    //
    // A query string is part of the request the browser makes for /auth/callback, so the
    // access token and the 7-day refresh token were landing in CloudFront/nginx access
    // logs, in any proxy on the way, and in the browser's history as a plain URL. A
    // fragment is never sent to a server at all — it exists only in the browser, where
    // AuthCallbackPage reads it and then wipes it from history.
    const fragment = new URLSearchParams({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn.toString(),
      user: JSON.stringify(result.user),
    });

    res.redirect(`${frontendUrl}/auth/callback#${fragment.toString()}`);
  }

  @Post('refresh')
  @SetMetadata('isPublic', true)
  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() body: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refreshTokens(body.refreshToken, clientOf(req));
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Logout and revoke tokens' })
  async logout(
    @CurrentUser('sub') userId: string,
    @Body() body: LogoutDto,
  ) {
    await this.authService.logout(userId, body.refreshToken);
    return { success: true };
  }

  // ---- MFA Endpoints ----

  @Post('mfa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Setup TOTP MFA - returns QR code' })
  async setupMfa(@CurrentUser('sub') userId: string) {
    return this.authService.setupMfa(userId);
  }

  @Post('mfa/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable MFA by verifying TOTP code' })
  async enableMfa(
    @CurrentUser('sub') userId: string,
    @Body() body: MfaTokenDto,
  ) {
    const enabled = await this.authService.enableMfa(userId, body.token);
    return { success: enabled };
  }

  @Post('mfa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ medium: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Disable MFA by verifying a current TOTP code' })
  async disableMfa(
    @CurrentUser('sub') userId: string,
    @Body() body: MfaTokenDto,
  ) {
    const disabled = await this.authService.disableMfa(userId, body.token);
    return { success: disabled };
  }

  @Post('mfa/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ medium: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify TOTP for step-up auth' })
  async verifyMfa(
    @CurrentUser('sub') userId: string,
    @Body() body: MfaTokenDto,
  ) {
    return this.authService.verifyMfa(userId, body.token);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ medium: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Change your own password (requires the current one)' })
  async changePassword(
    @CurrentUser('sub') userId: string,
    @Body() body: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, body.currentPassword, body.newPassword);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@CurrentUser() user: Record<string, unknown>) {
    return user;
  }
}
