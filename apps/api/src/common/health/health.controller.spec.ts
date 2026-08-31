import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { HealthController } from './health.controller';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The status code of /api/health/ready is load-bearing infrastructure: the Route 53
 * health check in infra/terraform/monitoring.tf pages a human off it. It returned 200
 * with a `degraded` body when the database was unreachable, which is a total outage
 * reported as healthy. These tests exist so it cannot regress to that quietly.
 */
describe('HealthController', () => {
  const mockRes = () => {
    const res = { status: jest.fn() };
    return res as unknown as Response & { status: jest.Mock };
  };

  const controllerWith = (queryRaw: jest.Mock) =>
    new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);

  describe('liveness', () => {
    it('answers ok without touching the database', () => {
      const queryRaw = jest.fn();
      expect(controllerWith(queryRaw).liveness().status).toBe('ok');
      expect(queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('is 200 and ok when the database answers', async () => {
      const res = mockRes();
      const body = await controllerWith(jest.fn().mockResolvedValue([{ '?column?': 1 }])).readiness(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(body.status).toBe('ok');
      expect(body.checks.database.ok).toBe(true);
    });

    it('is 503, not 200, when the database is unreachable', async () => {
      const res = mockRes();
      const body = await controllerWith(
        jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
      ).readiness(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.status).toBe('degraded');
      expect(body.checks.database.ok).toBe(false);
    });

    it('keeps saying "status":"ok" on the happy path — the health check string-matches it', async () => {
      const res = mockRes();
      const body = await controllerWith(jest.fn().mockResolvedValue([])).readiness(res);

      expect(JSON.stringify(body)).toContain('"status":"ok"');
    });
  });
});
