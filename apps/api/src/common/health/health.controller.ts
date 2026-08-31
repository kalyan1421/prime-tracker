import { Controller, Get, HttpStatus, HttpCode, Res } from '@nestjs/common';
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
      checks.database = {
        ok: false,
        latencyMs: Date.now() - dbStart,
        error: (err as Error).message,
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
