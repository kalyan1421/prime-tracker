import { Logger } from '@nestjs/common';
import { StaleUnitsCron, highestCrossedBucket } from './stale-units.cron';

/**
 * The stale-vacancy alert catches up.
 *
 * It used to fire only when a unit's vacancy age landed in the exact 24h window after a
 * bucket, so one missed run lost that bucket's alert permanently. It now alerts on the
 * highest bucket crossed that this vacancy has not been alerted for, remembered in
 * unit_vacancy_alerts.
 */
const DAY = 86_400_000;
const NOW = new Date('2026-10-24T13:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function makeCron(units: any[], vacancyStarts: Map<string, Date> = new Map()) {
  const prisma: any = {
    unit: { findMany: jest.fn().mockResolvedValue(units) },
    unitVacancyAlert: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const bus: any = { emit: jest.fn() };
  const statusEvents: any = { currentVacancyStartByUnit: jest.fn().mockResolvedValue(vacancyStarts) };
  return { cron: new StaleUnitsCron(prisma, bus, statusEvents), prisma, bus };
}

const unit = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  availableSince: null,
  createdAt: daysAgo(1000),
  building: { projectId: 'p1' },
  vacancyAlert: null,
  ...over,
});

describe('highestCrossedBucket', () => {
  it.each([[89, null], [90, 90], [119, 90], [120, 120], [200, 180], [400, 365]])('%i days → %p', (d, b) => {
    expect(highestCrossedBucket(d)).toBe(b);
  });
});

describe('StaleUnitsCron.check', () => {
  it('alerts a unit whose 90-day mark passed on a day the cron did not run', async () => {
    // Vacant 92 days, never alerted: the old exact-window rule would never fire for it.
    const { cron, bus, prisma } = makeCron([unit('u1')], new Map([['u1', daysAgo(92)]]));
    expect(await cron.check(NOW)).toBe(1);
    expect(bus.emit).toHaveBeenCalledWith({ type: 'unit.staleAvailable', unitId: 'u1', days: 90, projectId: 'p1' });
    expect(prisma.unitVacancyAlert.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { unitId: 'u1' },
      create: expect.objectContaining({ vacancyStart: daysAgo(92), days: 90 }),
    }));
  });

  it('does not repeat an alert already given for this vacancy', async () => {
    const start = daysAgo(100);
    const { cron, bus } = makeCron(
      [unit('u1', { vacancyAlert: { vacancyStart: start, days: 90 } })],
      new Map([['u1', start]]),
    );
    expect(await cron.check(NOW)).toBe(0);
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('after several missed buckets, alerts once at the bucket the unit is actually in', async () => {
    const start = daysAgo(190);
    const { cron, bus } = makeCron(
      [unit('u1', { vacancyAlert: { vacancyStart: start, days: 90 } })],
      new Map([['u1', start]]),
    );
    expect(await cron.check(NOW)).toBe(1);
    expect(bus.emit).toHaveBeenCalledTimes(1);
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ days: 180 }));
  });

  it('a NEW vacancy starts the buckets over, whatever the previous one reached', async () => {
    // Alerted at 365 for an earlier vacancy; the unit was let and is now 95 days vacant again.
    const { cron, bus } = makeCron(
      [unit('u1', { vacancyAlert: { vacancyStart: daysAgo(900), days: 365 } })],
      new Map([['u1', daysAgo(95)]]),
    );
    expect(await cron.check(NOW)).toBe(1);
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ days: 90 }));
  });

  it('records the alert BEFORE emitting, so a failed write is retried rather than forgotten', async () => {
    const { cron, bus, prisma } = makeCron([unit('u1')], new Map([['u1', daysAgo(92)]]));
    prisma.unitVacancyAlert.upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(cron.check(NOW)).rejects.toThrow('db down');
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('ignores units under the first bucket', async () => {
    const { cron, bus } = makeCron([unit('u1')], new Map([['u1', daysAgo(30)]]));
    expect(await cron.check(NOW)).toBe(0);
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('run() logs a failure with the job name instead of throwing', async () => {
    const { cron, prisma } = makeCron([]);
    prisma.unit.findMany.mockRejectedValueOnce(new Error('boom'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(cron.run()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('stale-units'), expect.any(String));
    error.mockRestore();
  });
});
