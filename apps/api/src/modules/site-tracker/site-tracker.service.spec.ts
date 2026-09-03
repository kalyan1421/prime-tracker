import { SiteTrackerService } from './site-tracker.service';

const mockPrisma: any = { unit: { findMany: jest.fn() } };
const mockAccess = { isScoped: jest.fn().mockReturnValue(false), accessibleProjectIds: jest.fn() };
const make = () => new SiteTrackerService(mockPrisma as any, mockAccess as any);

const viewer = (permissions: string[], over: any = {}) =>
  ({ userId: 'u1', role: 'CONSTRUCTION', permissions, ...over });

/** A unit row shaped the way the service's `select` returns it. */
function unitRow(over: any = {}) {
  return {
    id: 'u1', unitNumber: '101', status: 'UNDER_CONSTRUCTION',
    blockerStatus: null, blockerReason: null, blockerSince: null,
    sitePriority: null, templateVersion: 1,
    building: { id: 'b1', name: 'Building 1', project: { id: 'p1', name: 'Project 1' } },
    template: { id: 't1', name: 'Ground-up Shell', version: 1 },
    siteAssignees: [],
    constructionStages: [],
    ...over,
  };
}
const stage = (label: string, status: string, over: any = {}) =>
  ({ id: label, label, status, sortOrder: 0, inspectionStatus: null, inspectionDate: null, startsOn: null, endsOn: null, owner: null, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  mockAccess.isScoped.mockReturnValue(false);
});

const selectOf = () => mockPrisma.unit.findMany.mock.calls[0][0].select;
const whereOf = () => mockPrisma.unit.findMany.mock.calls[0][0].where;

describe('SiteTrackerService.grid — tenant redaction', () => {
  it('does not even QUERY leases for a viewer without lease:view', async () => {
    // CONSTRUCTION holds siteTracker:view and NOT lease:view — the role most likely to be
    // looking at this grid is the one that must not see tenant identity. Redacting after
    // the fact would still pull the rows; this asserts they are never selected.
    mockPrisma.unit.findMany.mockResolvedValue([unitRow()]);
    const out = await make().grid({}, viewer(['siteTracker:view']));
    expect(selectOf().leases).toBeUndefined();
    expect(out.rows[0].tenantName).toBeUndefined();
  });

  it('returns the active tenant for a viewer with lease:view', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([
      unitRow({ leases: [{ id: 'l1', tenantName: 'Qamaria Coffee' }] }),
    ]);
    const out = await make().grid({}, viewer(['siteTracker:view', 'lease:view']));
    expect(selectOf().leases.where).toMatchObject({ status: 'ACTIVE', deletedAt: null });
    expect(out.rows[0].tenantName).toBe('Qamaria Coffee');
  });

  it('distinguishes "no tenant" (null) from "not allowed to see" (undefined)', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([unitRow({ leases: [] })]);
    const permitted = await make().grid({}, viewer(['siteTracker:view', 'lease:view']));
    expect(permitted.rows[0].tenantName).toBeNull();

    jest.clearAllMocks();
    mockPrisma.unit.findMany.mockResolvedValue([unitRow()]);
    const denied = await make().grid({}, viewer(['siteTracker:view']));
    expect(denied.rows[0].tenantName).toBeUndefined();
  });

  it('never lets a search term match a tenant the viewer cannot see', async () => {
    // Otherwise the filter itself is an oracle: type a tenant name, see which row survives.
    mockPrisma.unit.findMany.mockResolvedValue([unitRow()]);
    const out = await make().grid({ search: 'Qamaria' }, viewer(['siteTracker:view']));
    expect(out.rows).toHaveLength(0);
  });

  it('omits update counts for a viewer without dailylog:view', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([unitRow()]);
    const out = await make().grid({}, viewer(['siteTracker:view']));
    expect(selectOf().dailyLogs).toBeUndefined();
    expect(out.rows[0].updateCount).toBeUndefined();
    // A silent 0 would read as "all healthy" rather than "you cannot see this".
    expect(out.summary.stale).toBeNull();
  });
});

describe('SiteTrackerService.grid — project scoping', () => {
  it('limits a scoped role to its own projects', async () => {
    mockAccess.isScoped.mockReturnValue(true);
    mockAccess.accessibleProjectIds.mockResolvedValue(['p1', 'p2']);
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({}, viewer(['siteTracker:view']));
    expect((whereOf().building as any).projectId).toEqual({ in: ['p1', 'p2'] });
  });

  it('does not widen scope when an explicit projectId is given', async () => {
    // ProjectAccessGuard already 404s a scoped user asking for someone else's project.
    mockAccess.isScoped.mockReturnValue(true);
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({ projectId: 'p9' }, viewer(['siteTracker:view']));
    expect((whereOf().building as any).projectId).toBe('p9');
    expect(mockAccess.accessibleProjectIds).not.toHaveBeenCalled();
  });

  it('excludes soft-deleted units and buildings', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({}, viewer(['siteTracker:view']));
    expect(whereOf().deletedAt).toBeNull();
    expect((whereOf().building as any).deletedAt).toBeNull();
  });
});

describe('SiteTrackerService.grid — blocker filter', () => {
  it('translates NONE into a null match, not an equality on the string', async () => {
    // "Nobody has assessed this" is a real third state; `blockerStatus = 'NONE'` would
    // match nothing at all.
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({ blockerStatus: 'NONE' }, viewer(['siteTracker:view']));
    expect(whereOf().blockerStatus).toBeNull();
  });

  it('passes YES straight through', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({ blockerStatus: 'YES' }, viewer(['siteTracker:view']));
    expect(whereOf().blockerStatus).toBe('YES');
  });
});

describe('SiteTrackerService.grid — derived columns', () => {
  it('computes percent complete from the unit\'s own stage list', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([unitRow({
      constructionStages: [stage('a', 'DONE'), stage('b', 'DONE'), stage('c', 'NOT_STARTED'), stage('d', 'NOT_STARTED')],
    })]);
    const out = await make().grid({}, viewer(['siteTracker:view']));
    expect(out.rows[0].pctComplete).toBe(50);
    expect(out.rows[0].doneStages).toBe(2);
  });

  it('returns null percent — not 0 — for a unit with no checklist', async () => {
    // 0% reads as "not started"; null reads as "not tracked". They are different problems.
    mockPrisma.unit.findMany.mockResolvedValue([unitRow({ constructionStages: [] })]);
    const out = await make().grid({}, viewer(['siteTracker:view']));
    expect(out.rows[0].pctComplete).toBeNull();
    expect(out.summary.noChecklist).toBe(1);
  });

  it('surfaces a BLOCKED stage ahead of the first merely-incomplete one', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([unitRow({
      constructionStages: [stage('a', 'DONE'), stage('b', 'NOT_STARTED'), stage('c', 'BLOCKED')],
    })]);
    const out = await make().grid({}, viewer(['siteTracker:view']));
    expect(out.rows[0].currentStage?.label).toBe('c');
  });

  it('reports blocker age in whole days', async () => {
    const since = new Date(Date.now() - 11 * 86_400_000);
    mockPrisma.unit.findMany.mockResolvedValue([unitRow({ blockerStatus: 'YES', blockerSince: since })]);
    const out = await make().grid({}, viewer(['siteTracker:view']));
    expect(out.rows[0].blockerDays).toBe(11);
    expect(out.summary.oldestBlockerDays).toBe(11);
  });

  it('averages completion over units that HAVE a checklist only', async () => {
    // Folding untracked units in as 0% would drag the portfolio number down for a reason
    // that has nothing to do with construction progress.
    mockPrisma.unit.findMany.mockResolvedValue([
      unitRow({ id: 'a', constructionStages: [stage('x', 'DONE')] }),
      unitRow({ id: 'b', constructionStages: [] }),
    ]);
    const out = await make().grid({}, viewer(['siteTracker:view']));
    expect(out.summary.avgPctComplete).toBe(100);
  });

  it('counts scheduled and in-progress inspections', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([unitRow({
      constructionStages: [
        stage('a', 'DONE', { inspectionStatus: 'PASSED' }),
        stage('b', 'NOT_STARTED', { inspectionStatus: 'SCHEDULED' }),
        stage('c', 'NOT_STARTED', { inspectionStatus: 'IN_PROGRESS' }),
      ],
    })]);
    const out = await make().grid({}, viewer(['siteTracker:view']));
    expect(out.summary.awaitingInspection).toBe(2);
  });

  it('treats a unit that has never been posted about as stale', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([unitRow({ dailyLogs: [], _count: { dailyLogs: 0 } })]);
    const out = await make().grid({}, viewer(['siteTracker:view', 'dailylog:view']));
    expect(out.rows[0].staleDays).toBeNull();
    expect(out.summary.stale).toBe(1);
  });

  it('searches the current stage label, not just the unit columns', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([unitRow({
      constructionStages: [stage('Rough Electrical', 'NOT_STARTED')],
    })]);
    const out = await make().grid({ search: 'electrical' }, viewer(['siteTracker:view']));
    expect(out.rows).toHaveLength(1);
  });
});

describe('SiteTrackerService.grid — what counts as "on the tracker"', () => {
  it('excludes units with no site-work record at all by default', async () => {
    // Found live: without this the grid listed all 636 units in the portfolio, of which
    // 622 had no checklist, and the "no update 7d+" tile read 636. The 14 units actually
    // under construction were unfindable.
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({}, viewer(['siteTracker:view']));
    expect(whereOf().OR).toEqual([
      { constructionStages: { some: {} } },
      { blockerStatus: { not: null } },
      { sitePriority: { not: null } },
      { siteAssignees: { some: {} } },
    ]);
  });

  it('drops the filter when a caller explicitly asks for untracked units', async () => {
    // "Which units are not on the tracker yet?" is a real question — just not the default.
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({ includeUntracked: true }, viewer(['siteTracker:view']));
    expect(whereOf().OR).toBeUndefined();
  });

  it('keeps the tracked filter alongside a project filter', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({ projectId: 'p1' }, viewer(['siteTracker:view']));
    expect(whereOf().OR).toBeDefined();
    expect((whereOf().building as any).projectId).toBe('p1');
  });
});

describe('SiteTrackerService.grid — latest update text on the unit row', () => {
  const withLog = (over: any = {}) => unitRow({
    dailyLogs: [{
      id: 'l1', logDate: new Date('2026-08-27'), notes: 'Electrician confirmed for Thursday.',
      author: { name: 'Demo PM' }, stage: { id: 's1', label: '08 - Rough Electrical' }, ...over,
    }],
    _count: { dailyLogs: 3 },
  });

  it('returns the newest update TEXT, not just a count', async () => {
    // A count says something happened; the sentence says what, which is the reason anyone
    // opens the row in the first place.
    mockPrisma.unit.findMany.mockResolvedValue([withLog()]);
    const out = await make().grid({}, viewer(['siteTracker:view', 'dailylog:view']));
    expect(out.rows[0].latestUpdate).toMatchObject({
      notes: 'Electrician confirmed for Thursday.',
      authorName: 'Demo PM',
      stageLabel: '08 - Rough Electrical',
    });
  });

  it('names no stage when the update was not pinned to one', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([withLog({ stage: null })]);
    const out = await make().grid({}, viewer(['siteTracker:view', 'dailylog:view']));
    expect(out.rows[0].latestUpdate?.stageLabel).toBeNull();
  });

  it('is null when the unit has never been posted about', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([unitRow({ dailyLogs: [], _count: { dailyLogs: 0 } })]);
    const out = await make().grid({}, viewer(['siteTracker:view', 'dailylog:view']));
    expect(out.rows[0].latestUpdate).toBeNull();
  });

  it('is withheld from a viewer who cannot read the feed', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([unitRow()]);
    const out = await make().grid({}, viewer(['siteTracker:view']));
    expect(out.rows[0].latestUpdate).toBeNull();
  });

  it('takes the newest by log date, then by creation', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([withLog()]);
    await make().grid({}, viewer(['siteTracker:view', 'dailylog:view']));
    expect(selectOf().dailyLogs.orderBy).toEqual([{ logDate: 'desc' }, { createdAt: 'desc' }]);
    expect(selectOf().dailyLogs.take).toBe(1);
  });
});

describe('SiteTrackerService.grid — sold units', () => {
  it('excludes SOLD units for a viewer without sales:view', async () => {
    // A sold unit is a closed deal, not site work; it only appears here because it kept
    // the checklist from when it was built. Asserted on the WHERE clause rather than the
    // returned rows so the exclusion is proven to happen in the query, not after it.
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({}, viewer(['siteTracker:view']));
    expect(whereOf().status).toEqual({ not: 'SOLD' });
  });

  it('leaves SOLD units in for a viewer with sales:view', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({}, viewer(['siteTracker:view', 'sales:view']));
    expect(whereOf().status).toBeUndefined();
  });

  it('applies the sold filter alongside the on-the-tracker filter, not instead of it', async () => {
    // Both narrow the same query: status is its own key so it ANDs with the OR block.
    // If either ever moved into that OR array it would widen the result instead.
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({}, viewer(['siteTracker:view']));
    expect(whereOf().status).toEqual({ not: 'SOLD' });
    expect(Array.isArray(whereOf().OR)).toBe(true);
  });

  it('still excludes SOLD when untracked units are opted in', async () => {
    mockPrisma.unit.findMany.mockResolvedValue([]);
    await make().grid({ includeUntracked: true }, viewer(['siteTracker:view']));
    expect(whereOf().status).toEqual({ not: 'SOLD' });
    expect(whereOf().OR).toBeUndefined();
  });
});
