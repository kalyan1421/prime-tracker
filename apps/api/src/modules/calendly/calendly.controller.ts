import {
  Controller, Post, Get, Req, Headers, HttpCode, Logger,
  UnauthorizedException, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiExcludeEndpoint, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { CalendlyService } from './calendly.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Calendly')
@Controller('calendly')
export class CalendlyController {
  private readonly logger = new Logger(CalendlyController.name);

  constructor(private service: CalendlyService) {}

  /**
   * Calendly's webhook receiver.
   *
   * DELIBERATELY UNAUTHENTICATED — Calendly posts server-to-server with no bearer token,
   * exactly like the Intuit OAuth callback. The HMAC signature is the authentication, and
   * it is checked before anything is read from the body.
   *
   * Always answers 200 once the signature is good, including for payloads it decides to
   * ignore. A non-2xx makes Calendly retry, and retrying something we will never
   * understand is a queue that never drains.
   */
  @Post('webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  // Higher than a human endpoint: a burst of real bookings must not be throttled into
  // retries, but it is still bounded against someone spraying the public path.
  @Throttle({ medium: { limit: 120, ttl: 60_000 } })
  async webhook(@Req() req: Request, @Headers('calendly-webhook-signature') signature?: string) {
    if (!this.service.isConfigured()) {
      // 503 rather than 200: unconfigured is a deployment problem, and Calendly retrying
      // later is exactly the behaviour we want while it is being fixed.
      throw new ServiceUnavailableException('Calendly integration is not configured');
    }

    // The RAW bytes, not the parsed body — see calendly-signature.ts.
    const raw = (req as any).rawBody as Buffer | undefined;
    if (!raw) throw new UnauthorizedException('Raw body unavailable; cannot verify signature');

    const { verifyCalendlySignature } = await import('./calendly-signature');
    const check = verifyCalendlySignature({
      rawBody: raw,
      header: signature,
      signingKey: this.service.signingKey!,
    });
    if (!check.ok) {
      this.logger.warn(`Rejected Calendly webhook: ${check.reason}`);
      throw new UnauthorizedException('Invalid signature');
    }

    const result = await this.service.handleEvent(req.body);
    this.logger.log(`Calendly webhook ${req.body?.event}: ${result.status}`);
    return result;
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @RequirePermissions('siteVisit:view')
  @ApiOperation({ summary: 'Whether the Calendly webhook is configured on this deployment' })
  status() {
    return { configured: this.service.isConfigured() };
  }
}
