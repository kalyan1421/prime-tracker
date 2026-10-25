import { Logger } from '@nestjs/common';
import {
  AUDIT_PURGE_BATCH_SIZE, AUDIT_PURGE_MAX_BATCHES, AUDIT_RETAINED_ACTIONS, AUDIT_RETENTION_DAYS, AuditRetentionService,
} from './audit-retention.service';

/**
 * Audit retention: events older than AUDIT_RETENTION_DAYS are removed in bounded batches,
 * oldest first — except the actions that are the only record of something irreversible.
 */
const NOW = new Date('2028-06-01T08:45:00Z');

function makeService(batches: number[]) {
  let call = 0;
  const prisma: any = {
    auditEvent: {
      findMany: jest.fn().mockImplementation(() => {
        const n = batches[call++] ?? 0;
        return Promise.resolve(Array.from({ length: n }, (_, i) => ({ id: `e${call}-${i}` })));
      }),
      deleteMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ count: where.id.in.length })),
      count: jest.fn().mockResolvedValue(42),
    },
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new AuditRetentionService(prisma, audit), prisma, audit };
}

describe('AuditRetentionService.purge', () => {
  it('keeps two years, and never the retained actions', async () => {
    const { service, prisma } = makeService([3]);
    const result = await service.purge({ now: NOW });

    expect(AUDIT_RETENTION_DAYS).toBe(730);
    expect(result.cutoff.toISOString()).toBe(new Date(NOW.getTime() - 730 * 86_400_000).toISOString());
    const { where, orderBy, take } = prisma.auditEvent.findMany.mock.calls[0][0];
    expect(where.createdAt).toEqual({ lt: result.cutoff });
    expect(where.action.notIn).toEqual(expect.arrayContaining(['PURGE', 'LEASE_HISTORICAL_DELETED', 'SALE_HISTORICAL_DELETED']));
    expect(orderBy).toEqual({ createdAt: 'asc' });
    expect(take).toBe(AUDIT_PURGE_BATCH_SIZE);
  });

  it('deletes exactly the ids it selected, batch by batch, until a short batch', async () => {
    const { service, prisma } = makeService([AUDIT_PURGE_BATCH_SIZE, AUDIT_PURGE_BATCH_SIZE, 7]);
    const result = await service.purge({ now: NOW });

    expect(prisma.auditEvent.deleteMany).toHaveBeenCalledTimes(3);
    expect(prisma.auditEvent.deleteMany.mock.calls[2][0]).toEqual({ where: { id: { in: expect.any(Array) } } });
    expect(result).toMatchObject({ deleted: 2 * AUDIT_PURGE_BATCH_SIZE + 7, capped: false });
  });

  it('stops at the batch cap and says more remain', async () => {
    const { service, prisma } = makeService(Array(AUDIT_PURGE_MAX_BATCHES + 5).fill(AUDIT_PURGE_BATCH_SIZE));
    const result = await service.purge({ now: NOW });

    expect(prisma.auditEvent.deleteMany).toHaveBeenCalledTimes(AUDIT_PURGE_MAX_BATCHES);
    expect(result.capped).toBe(true);
  });

  it('records what it removed, under an action it will itself never purge', async () => {
    const { service, audit } = makeService([5]);
    await service.purge({ now: NOW });

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'AUDIT_RETENTION_PURGE',
      metadata: expect.objectContaining({ deleted: 5, retentionDays: AUDIT_RETENTION_DAYS }),
    }));
    expect(AUDIT_RETAINED_ACTIONS).toContain('AUDIT_RETENTION_PURGE');
  });

  it('writes nothing when there is nothing to remove', async () => {
    const { service, audit, prisma } = makeService([0]);
    const result = await service.purge({ now: NOW });
    expect(result.deleted).toBe(0);
    expect(prisma.auditEvent.deleteMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('a dry run only counts', async () => {
    const { service, prisma } = makeService([5]);
    const result = await service.purge({ now: NOW, dryRun: true });
    expect(result).toMatchObject({ dryRun: true, deleted: 42 });
    expect(prisma.auditEvent.deleteMany).not.toHaveBeenCalled();
  });

  it('the nightly run logs a failure with the job name instead of throwing', async () => {
    const { service, prisma } = makeService([]);
    prisma.auditEvent.findMany.mockRejectedValueOnce(new Error('db down'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(service.runNightly()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Cron audit-retention-purge failed: db down', expect.any(String));
    error.mockRestore();
  });
});
