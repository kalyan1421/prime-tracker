import { Controller, Get, HttpStatus, HttpCode } from '@nestjs/common';
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

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — can the API serve traffic?' })
  async readiness() {
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
    return {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
