import { RefreshTokenCleanupCron } from './refresh-token-cleanup.cron';

describe('RefreshTokenCleanupCron', () => {
  const prisma = { refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 42 }) } };
  const cron = new RefreshTokenCleanupCron(prisma as any);

  it('deletes every expired row', async () => {
    const before = Date.now();
    await expect(cron.run()).resolves.toBe(42);

    const { where } = prisma.refreshToken.deleteMany.mock.calls[0][0];
    const cutoff = (where.expiresAt.lt as Date).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before);
    expect(cutoff).toBeLessThanOrEqual(Date.now());
  });

  // Revoked-but-unexpired rows are what reuse detection matches a stolen token against.
  // Deleting them early would turn "this token was stolen" into "unknown token".
  it('keeps revoked rows until they expire', async () => {
    await cron.run();
    const { where } = prisma.refreshToken.deleteMany.mock.calls.at(-1)[0];
    expect(Object.keys(where)).toEqual(['expiresAt']);
  });
});
