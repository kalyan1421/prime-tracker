import { FULL_PUSH_INTERVAL_MS, WebsiteSyncService, reportIssues } from './website-sync.service';

/**
 * The cron's push decisions: push what changed, push everything hourly, stop
 * hammering a website that refused, and stay silent when switched off.
 */
const SECRET = 'a'.repeat(64);

const projectRow = (status: string) => ({
  id: 'proj-centro',
  name: 'Centro Plaza',
  websiteSlug: 'centro-plaza',
  buildings: [
    { id: 'b1', name: 'Building 1', units: [{ id: 'u1', unitNumber: '101', status, sqft: 900, leases: [], sales: [] }] },
  ],
});

function setup(env: Record<string, string> = { WEBSITE_SYNC_URL: 'https://site.test/api/integrations/tracker/snapshot', WEBSITE_SYNC_SECRET: SECRET }) {
  const prisma: any = { project: { findMany: jest.fn().mockResolvedValue([projectRow('AVAILABLE')]), findFirst: jest.fn() } };
  const config: any = { get: (key: string) => env[key] };
  const service = new WebsiteSyncService(prisma, config);
  return { service, prisma };
}

const respond = (status: number, body: unknown = { applied: true }) =>
  jest.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });

describe('WebsiteSyncService.syncPublished', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('does nothing when the website target is not configured', async () => {
    const { service, prisma } = setup({ WEBSITE_SYNC_URL: 'REPLACE_ME', WEBSITE_SYNC_SECRET: 'REPLACE_ME' });
    global.fetch = respond(200);
    await service.syncPublished();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('pushes a signed snapshot, then skips it until it changes or the hourly push is due', async () => {
    const { service, prisma } = setup();
    global.fetch = respond(200);
    const t0 = 10 * FULL_PUSH_INTERVAL_MS;

    await service.syncPublished(t0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['X-Prime-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(JSON.parse(init.body).project.websiteSlug).toBe('centro-plaza');

    await service.syncPublished(t0 + 5 * 60_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    prisma.project.findMany.mockResolvedValue([projectRow('SOLD')]);
    await service.syncPublished(t0 + 10 * 60_000);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    await service.syncPublished(t0 + FULL_PUSH_INTERVAL_MS);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('retries a failed push on the next tick', async () => {
    const { service } = setup();
    global.fetch = respond(503, 'waking up');
    await service.syncPublished(FULL_PUSH_INTERVAL_MS);
    global.fetch = respond(200);
    await service.syncPublished(FULL_PUSH_INTERVAL_MS + 5 * 60_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('warns with the counts when an applied push reports removed or unmatched items', async () => {
    const { service } = setup();
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    global.fetch = respond(200, {
      property: 'centro-plaza',
      applied: true,
      dryRun: false,
      report: {
        removedRows: 2,
        unmatchedTrackerBuildings: [{ name: 'Building 11', units: 4 }],
        counts: { removed: 2, unmatchedTrackerBuildings: 1, unmatchedUnits: 4, staleLinks: 0, unknownStatuses: 1, untouched: 1 },
        refusals: ['tracker buildings with no website building: Building 11 (4 units)'],
        refused: null,
      },
    });
    await service.syncPublished(FULL_PUSH_INTERVAL_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      'Website push for centro-plaza reported removed=2, unmatchedTrackerBuildings=1, unmatchedUnits=4, unknownStatuses=1, refusals=1',
    );
  });

  it('stays quiet on a clean report', async () => {
    const { service } = setup();
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    global.fetch = respond(200, {
      applied: true,
      report: { removedRows: 0, counts: { removed: 0, untouched: 1, added: 3 }, refusals: [], refused: null },
    });
    await service.syncPublished(FULL_PUSH_INTERVAL_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not resend a refused snapshot every tick', async () => {
    const { service } = setup();
    global.fetch = respond(409, { report: { refused: 'would remove 19 of 20 unit rows' } });
    await service.syncPublished(FULL_PUSH_INTERVAL_MS);
    await service.syncPublished(FULL_PUSH_INTERVAL_MS + 5 * 60_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('reportIssues', () => {
  it('reads the report from before `counts` existed', () => {
    expect(reportIssues({ report: { removedRows: 3, unmatchedTrackerBuildings: ['Building 5'], untouched: ['Building 10'], refused: null } })).toEqual({
      removed: 3,
      unmatchedTrackerBuildings: 1,
    });
  });

  it('flags a dry run that would be refused', () => {
    expect(reportIssues({ dryRun: true, report: { counts: {}, refusals: ['would empty Building 9'], refused: 'would empty Building 9; resend with force to apply' } })).toEqual({
      refusals: 1,
    });
  });

  it('is null for a body that is not a report', () => {
    expect(reportIssues('<html>Bad gateway</html>')).toBeNull();
    expect(reportIssues({ message: 'Property "x" already mirrors tracker project y' })).toBeNull();
  });
});
