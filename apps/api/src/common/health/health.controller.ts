import { Controller, Get, HttpStatus, HttpCode, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Health check endpoint for load balancers, uptime monitors, and CI smoke tests.
 *
 * - GET /api/health        — liveness (always 200 if process is up)
 * - GET /api/health/ready  — readiness (200 only if DB reachable)
 *
 * No auth required. Returns minimal info on purpose — don't leak deployment internals.
 */
@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe — does the process respond at all?' })
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * Uptime monitors key on the STATUS CODE. This used to answer 200 with a body of
   * `{"status":"degraded"}` when the database was unreachable — a total outage that
   * every monitor in front of it would have reported as healthy. The code now matches
   * what the docstring above always claimed.
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — can the API serve traffic?' })
  async readiness(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    // DB check
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true, latencyMs: Date.now() - dbStart };
    } catch (err) {
      // The real message goes to the LOGS, never the response body.
      //
      // This endpoint is unauthenticated (and @SkipThrottle'd), and Prisma's connection
      // errors name the host, port and database — "Can't reach database server at
      // prime-tracker-db.<id>.<region>.rds.amazonaws.com:5432". Returning that handed an
      // anonymous caller the infrastructure layout at exactly the moment it is most useful
      // to them, and contradicted this controller's own "don't leak deployment internals".
      //
      // Monitors key on the status code, which is still 503 below, so nothing that consumes
      // this endpoint loses information — and whoever is debugging the outage has the real
      // error in CloudWatch.
      this.logger.error(`Readiness DB check failed: ${(err as Error).message}`);
      checks.database = {
        ok: false,
        latencyMs: Date.now() - dbStart,
        error: 'unreachable',
      };
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    res.status(allOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
