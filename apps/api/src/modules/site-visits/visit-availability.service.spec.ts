import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { VisitAvailabilityService } from './visit-availability.service';

const mockPrisma: any = {
  orgSettings: { findFirst: jest.fn() },
  visitAvailability: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  $transaction: jest.fn((ops: any) => Promise.all(ops)),
  siteVisit: { findMany: jest.fn() },
};

const make = () => new VisitAvailabilityService(mockPrisma as any);

/** Mon-Fri 09:00-12:00 CT, 60-minute slots — three slots a weekday. */
const openRule = (over: Record<string, any> = {}) => ({
  id: 'r1', hostId: 'h1', kind: 'OPEN', dayOfWeek: 1, date: null,
  startMin: 540, endMin: 720, slotMinutes: 60, timezone: 'America/Chicago',
  effectiveFrom: null, effectiveTo: null, ...over,
});

describe('VisitAvailabilityService.slots — diagnostics', () => {
  let service: VisitAvailabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = make();
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null); // 6h notice, 60m slots
    mockPrisma.siteVisit.findMany.mockResolvedValue([]);
  });

  // A far-future Monday, so the 6h notice never interferes.
  const FAR_MON = { from: '2027-03-01', to: '2027-03-01' };

  it('reports hasAvailability=false when the host published NOTHING', async () => {
    // This is the case the UI used to mislabel as "taken, blocked, or inside the notice
    // period" — none of which is true when no rule exists at all.
    mockPrisma.visitAvailability.findMany.mockResolvedValue([]);
    const res = await service.slots({ hostId: 'h1', ...FAR_MON });
    expect(res.slots).toEqual([]);
    expect(res.diagnostics.hasAvailability).toBe(false);
    expect(res.diagnostics.generated).toBe(0);
  });

  it('reports hasAvailability=true and counts generated slots', async () => {
    mockPrisma.visitAvailability.findMany.mockResolvedValue([openRule()]);
    const res = await service.slots({ hostId: 'h1', ...FAR_MON });
    expect(res.diagnostics.hasAvailability).toBe(true);
    expect(res.diagnostics.generated).toBe(3);
    expect(res.slots).toHaveLength(3);
  });

  it('attributes removals to BLOCKED', async () => {
    mockPrisma.visitAvailability.findMany.mockResolvedValue([
      openRule(),
      openRule({ id: 'r2', kind: 'BLOCKED', startMin: 600, endMin: 720 }),
    ]);
    const res = await service.slots({ hostId: 'h1', ...FAR_MON });
    expect(res.diagnostics.removedBlocked).toBe(2);
    expect(res.slots).toHaveLength(1);
  });

  it('attributes removals to an already-booked slot', async () => {
    mockPrisma.visitAvailability.findMany.mockResolvedValue([openRule()]);
    // 09:00 CT on 2027-03-01 is 15:00Z (CST, UTC-6).
    mockPrisma.siteVisit.findMany.mockResolvedValue([
      { startsAt: new Date('2027-03-01T15:00:00.000Z') },
    ]);
    const res = await service.slots({ hostId: 'h1', ...FAR_MON });
    expect(res.diagnostics.removedTaken).toBe(1);
    expect(res.slots).toHaveLength(2);
  });

  it('attributes removals to the notice period', async () => {
    // A window covering today: everything inside the next 6h must be dropped AND counted.
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    mockPrisma.visitAvailability.findMany.mockResolvedValue([
      openRule({ dayOfWeek: null, date: new Date(`${today}T00:00:00.000Z`), startMin: 0, endMin: 1440 }),
    ]);
    const res = await service.slots({ hostId: 'h1', from: today, to: today });
    expect(res.diagnostics.hasAvailability).toBe(true);
    expect(res.diagnostics.removedNotice).toBeGreaterThan(0);
    expect(res.diagnostics.minNoticeHours).toBe(6);
  });

  it('carries an admin-changed notice period into the diagnostics', async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue({ siteVisitMinNoticeHours: 24 });
    mockPrisma.visitAvailability.findMany.mockResolvedValue([openRule()]);
    const res = await service.slots({ hostId: 'h1', ...FAR_MON });
    expect(res.diagnostics.minNoticeHours).toBe(24);
  });

  it('still validates its inputs', async () => {
    await expect(service.slots({ hostId: 'h1', from: 'nope', to: 'nope' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.slots({ hostId: '', ...FAR_MON }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});


// ---------------------------------------------------------------------------
// Per-day status — what colours the booking calendar.
//
// A blocked day and a fully-booked day look identical as "no slots"; these pin the
// distinction, because they mean completely different things to whoever is booking.
// ---------------------------------------------------------------------------
describe('VisitAvailabilityService.slots — per-day status', () => {
  let service: VisitAvailabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = make();
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    mockPrisma.siteVisit.findMany.mockResolvedValue([]);
  });

  const MON = { from: '2027-03-01', to: '2027-03-01' };
  const dayOf = (res: any) => res.days.find((d: any) => d.date === '2027-03-01');

  it('returns one entry per calendar day in range', async () => {
    mockPrisma.visitAvailability.findMany.mockResolvedValue([openRule()]);
    const res = await service.slots({ hostId: 'h1', from: '2027-03-01', to: '2027-03-03' });
    expect(res.days.map((d: any) => d.date)).toEqual(['2027-03-01', '2027-03-02', '2027-03-03']);
  });

  it('marks a free day with its open count', async () => {
    mockPrisma.visitAvailability.findMany.mockResolvedValue([openRule()]);
    expect(dayOf(await service.slots({ hostId: 'h1', ...MON })))
      .toMatchObject({ generated: 3, open: 3, blocked: 0, taken: 0 });
  });

  it('distinguishes FULL from BLOCKED', async () => {
    // Fully booked: rules exist, slots generated, every one already taken.
    mockPrisma.visitAvailability.findMany.mockResolvedValue([openRule()]);
    mockPrisma.siteVisit.findMany.mockResolvedValue([
      { startsAt: new Date('2027-03-01T15:00:00.000Z') },
      { startsAt: new Date('2027-03-01T16:00:00.000Z') },
      { startsAt: new Date('2027-03-01T17:00:00.000Z') },
    ]);
    expect(dayOf(await service.slots({ hostId: 'h1', ...MON })))
      .toMatchObject({ open: 0, taken: 3, blocked: 0 });

    // Blocked: same window, carved out entirely.
    mockPrisma.siteVisit.findMany.mockResolvedValue([]);
    mockPrisma.visitAvailability.findMany.mockResolvedValue([
      openRule(),
      openRule({ id: 'r2', kind: 'BLOCKED', startMin: 540, endMin: 720 }),
    ]);
    expect(dayOf(await service.slots({ hostId: 'h1', ...MON })))
      .toMatchObject({ open: 0, blocked: 3, taken: 0 });
  });

  it('reports a day with no matching rule as generating nothing', async () => {
    mockPrisma.visitAvailability.findMany.mockResolvedValue([openRule()]); // Mondays only
    const res = await service.slots({ hostId: 'h1', from: '2027-03-02', to: '2027-03-02' });
    expect(res.days[0]).toMatchObject({ generated: 0, open: 0 });
  });

  it('does not double-count a day covered by two overlapping OPEN rules', async () => {
    // Same window declared twice — the picker offers each instant once, so `open` must
    // agree with the deduped slot list rather than the raw walk.
    mockPrisma.visitAvailability.findMany.mockResolvedValue([
      openRule(),
      openRule({ id: 'r2' }),
    ]);
    const res = await service.slots({ hostId: 'h1', ...MON });
    expect(res.slots).toHaveLength(3);
    expect(dayOf(res).open).toBe(3);
  });
});


// ---------------------------------------------------------------------------
// Monthly rules + who may manage whose calendar (client, 2026-09-22).
// ---------------------------------------------------------------------------
describe('VisitAvailabilityService — monthly rules', () => {
  let service: VisitAvailabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = make();
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    mockPrisma.siteVisit.findMany.mockResolvedValue([]);
  });

  const monthly = (day: number) => ({
    id: 'm1', hostId: 'h1', kind: 'OPEN', dayOfWeek: null, dayOfMonth: day, date: null,
    startMin: 540, endMin: 720, slotMinutes: 60, timezone: 'America/Chicago',
    effectiveFrom: null, effectiveTo: null,
  });

  it('matches only that calendar day each month', async () => {
    mockPrisma.visitAvailability.findMany.mockResolvedValue([monthly(15)]);
    const res = await service.slots({ hostId: 'h1', from: '2027-03-01', to: '2027-03-31' });
    const withSlots = res.days.filter((d: any) => d.generated > 0).map((d: any) => d.date);
    expect(withSlots).toEqual(['2027-03-15']);
  });

  it('simply produces nothing in a month that has no such day', async () => {
    // Day 31 in a 30-day month. Clamping to the 30th would put the host somewhere they
    // never agreed to be, so the rule does not apply at all.
    mockPrisma.visitAvailability.findMany.mockResolvedValue([monthly(31)]);
    const res = await service.slots({ hostId: 'h1', from: '2027-04-01', to: '2027-04-30' });
    expect(res.slots).toHaveLength(0);
    expect(res.days.every((d: any) => d.generated === 0)).toBe(true);
  });

  it('applies across consecutive months', async () => {
    mockPrisma.visitAvailability.findMany.mockResolvedValue([monthly(2)]);
    const res = await service.slots({ hostId: 'h1', from: '2027-03-01', to: '2027-04-30' });
    const withSlots = res.days.filter((d: any) => d.generated > 0).map((d: any) => d.date);
    expect(withSlots).toEqual(['2027-03-02', '2027-04-02']);
  });

  it('rejects a rule that is two kinds at once', async () => {
    await expect(service.create(
      { hostId: 'h1', dayOfWeek: 1, dayOfMonth: 5, startMin: 540, endMin: 600 }, 'u1',
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a day-of-month outside 1..31', async () => {
    await expect(service.create(
      { hostId: 'h1', dayOfMonth: 0, startMin: 540, endMin: 600 }, 'u1',
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('VisitAvailabilityService — whose calendar', () => {
  let service: VisitAvailabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = make();
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    mockPrisma.visitAvailability.create.mockResolvedValue({ id: 'a1' });
    mockPrisma.visitAvailability.findUnique.mockResolvedValue({ id: 'a1', hostId: 'someone-else', kind: 'OPEN', dayOfWeek: 1, dayOfMonth: null, date: null, startMin: 540, endMin: 600, slotMinutes: 60 });
    mockPrisma.siteVisit.findMany.mockResolvedValue([]);
  });

  const rule = { hostId: 'me', dayOfWeek: 1, startMin: 540, endMin: 600 };

  it('lets anyone publish their OWN hours — that is what makes a role bookable', async () => {
    await expect(service.create(rule, 'me', { userId: 'me', roles: ['SALES'] })).resolves.toBeDefined();
  });

  it("refuses a non-leader publishing on somebody ELSE's calendar", async () => {
    await expect(service.create({ ...rule, hostId: 'other' }, 'me', { userId: 'me', roles: ['SALES'] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets leadership publish for anyone', async () => {
    await expect(service.create({ ...rule, hostId: 'other' }, 'me', { userId: 'me', roles: ['FOUNDER'] }))
      .resolves.toBeDefined();
  });

  it("refuses a non-leader EDITING somebody else's rule", async () => {
    await expect(service.update('a1', { startMin: 600 }, { userId: 'me', roles: ['SALES'] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses a non-leader DELETING somebody else's rule", async () => {
    await expect(service.remove('a1', { userId: 'me', roles: ['MARKETING'] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});


// ---------------------------------------------------------------------------
// Date ranges + bulk publishing (client, 2026-09-22).
//
// Blocking a week was seven rows to create and seven to remove; publishing a working week
// was five requests, which the throttler could silently truncate.
// ---------------------------------------------------------------------------
describe('VisitAvailabilityService — date ranges', () => {
  let service: VisitAvailabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = make();
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    mockPrisma.siteVisit.findMany.mockResolvedValue([]);
  });

  const open = () => ({
    id: 'r1', hostId: 'h1', kind: 'OPEN', dayOfWeek: 1, dayOfMonth: null, date: null, endDate: null,
    startMin: 540, endMin: 720, slotMinutes: 60, timezone: 'America/Chicago',
    effectiveFrom: null, effectiveTo: null,
  });
  const blockedRange = (from: string, to: string) => ({
    ...open(), id: 'b1', kind: 'BLOCKED', dayOfWeek: null,
    date: new Date(`${from}T00:00:00.000Z`), endDate: new Date(`${to}T00:00:00.000Z`),
  });

  it('blocks EVERY day inside the range, not just the first', async () => {
    // Mondays are open; a range covering two of them must remove both.
    mockPrisma.visitAvailability.findMany.mockResolvedValue([
      open(), blockedRange('2027-03-01', '2027-03-14'),
    ]);
    const res = await service.slots({ hostId: 'h1', from: '2027-03-01', to: '2027-03-31' });
    const free = res.days.filter((d: any) => d.open > 0).map((d: any) => d.date);
    // 1 and 8 March fall in the range; 15, 22, 29 survive.
    expect(free).toEqual(['2027-03-15', '2027-03-22', '2027-03-29']);
  });

  it('treats a range with no endDate as a single day', async () => {
    const single = { ...blockedRange('2027-03-01', '2027-03-01'), endDate: null };
    mockPrisma.visitAvailability.findMany.mockResolvedValue([open(), single]);
    const res = await service.slots({ hostId: 'h1', from: '2027-03-01', to: '2027-03-31' });
    const free = res.days.filter((d: any) => d.open > 0).map((d: any) => d.date);
    expect(free).toEqual(['2027-03-08', '2027-03-15', '2027-03-22', '2027-03-29']);
  });

  it('rejects an endDate with no start', async () => {
    await expect(service.create(
      { hostId: 'h1', endDate: '2027-03-05', startMin: 540, endMin: 600 }, 'u1',
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a backwards range', async () => {
    await expect(service.create(
      { hostId: 'h1', date: '2027-03-10', endDate: '2027-03-01', startMin: 540, endMin: 600 }, 'u1',
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('VisitAvailabilityService.createMany', () => {
  let service: VisitAvailabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = make();
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    mockPrisma.visitAvailability.create.mockImplementation((args: any) => Promise.resolve(args.data));
  });

  const week = [1, 2, 3, 4, 5].map((d) => ({ hostId: 'me', dayOfWeek: d, startMin: 540, endMin: 1080 }));

  it('writes a whole week in ONE transaction, not five requests', async () => {
    const res = await service.createMany(week, 'me', { userId: 'me', roles: ['SALES'] });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(res).toHaveLength(5);
    expect(res.map((r: any) => r.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
  });

  it('validates EVERY rule before writing any, so a bad one cannot half-apply', async () => {
    const bad = [...week, { hostId: 'me', dayOfWeek: 9, startMin: 540, endMin: 600 }];
    await expect(service.createMany(bad, 'me')).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses the whole batch if any rule targets somebody else's calendar", async () => {
    const mixed = [...week, { hostId: 'other', dayOfWeek: 6, startMin: 540, endMin: 600 }];
    await expect(service.createMany(mixed, 'me', { userId: 'me', roles: ['SALES'] }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an empty or oversized batch', async () => {
    await expect(service.createMany([], 'me')).rejects.toBeInstanceOf(BadRequestException);
    const huge = Array.from({ length: 32 }, () => ({ hostId: 'me', dayOfWeek: 1, startMin: 540, endMin: 600 }));
    await expect(service.createMany(huge, 'me')).rejects.toBeInstanceOf(BadRequestException);
  });
});
