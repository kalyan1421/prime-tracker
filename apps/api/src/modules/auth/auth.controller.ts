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
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/index';
import { ConfigService } from '@nestjs/config';
import { GoogleAuthGuard } from './google-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  @Post('login')
  @SetMetadata('isPublic', true)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.loginWithPassword(body.email, body.password);
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
    const profile = req.user as {
      id: string;
      email: string;
      displayName: string;
      picture?: string;
    };

    const result = await this.authService.validateGoogleUser(profile);
    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:5173');

    // Redirect to frontend with tokens + user — AuthCallbackPage requires all three
    // and double-decodes the user param (URLSearchParams decodes once, the page
    // calls decodeURIComponent again), so encode the JSON here.
    const params = new URLSearchParams({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn.toString(),
      user: encodeURIComponent(JSON.stringify(result.user)),
    });

    res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);
  }

  @Post('refresh')
  @SetMetadata('isPublic', true)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshTokens(body.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Logout and revoke tokens' })
  async logout(
    @CurrentUser('sub') userId: string,
    @Body() body: { refreshToken?: string },
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
    @Body() body: { token: string },
  ) {
    const enabled = await this.authService.enableMfa(userId, body.token);
    return { success: enabled };
  }

  @Post('mfa/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify TOTP for step-up auth' })
  async verifyMfa(
    @CurrentUser('sub') userId: string,
    @Body() body: { token: string },
  ) {
    return this.authService.verifyMfa(userId, body.token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@CurrentUser() user: Record<string, unknown>) {
    return user;
  }
}
