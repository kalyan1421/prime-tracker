import { Logger } from '@nestjs/common';
import { DrawFundingOverdueCron } from './draws/draw-funding-overdue.cron';
import { SalesStaleCron } from './sales/sales-stale.cron';
import { VarianceAlertCron } from './budgets/variance-alert.cron';
import { OverdueDetectionCron } from './milestones/overdue-detection.cron';

/**
 * A cron that throws must say WHICH job failed, and must not take anything down with it.
 *
 * These four had no try/catch: a throw surfaced as an anonymous scheduler error, and three
 * of them share the 08:00 slot. Each run() now catches, logs with the job's @Cron name,
 * and resolves.
 */
describe('cron failure handling', () => {
  const failing = () => jest.fn().mockRejectedValue(new Error('db unavailable'));
  const prisma: any = {
    drawRequest: { findMany: failing() },
    sale: { findMany: failing() },
    project: { findMany: failing() },
    milestone: { updateMany: failing() },
  };
  const bus: any = { emit: jest.fn() };
  const cache: any = { get: jest.fn(), set: jest.fn(), invalidateKey: jest.fn(), invalidateTag: jest.fn() };

  let error: jest.SpyInstance;
  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => error.mockRestore());

  it.each([
    ['draw-funding-overdue', () => new DrawFundingOverdueCron(prisma, bus)],
    ['sales-stale', () => new SalesStaleCron(prisma, bus)],
    ['budget-variance-alerts', () => new VarianceAlertCron(prisma, cache, bus)],
    ['milestone-overdue-detection', () => new OverdueDetectionCron(prisma, cache)],
  ])('%s logs the failure under its own name and resolves', async (name, make) => {
    await expect(make().run()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(`Cron ${name} failed: db unavailable`, expect.any(String));
  });
});
