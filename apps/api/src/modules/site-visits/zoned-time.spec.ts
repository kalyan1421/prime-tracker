import {
  zonedWallClockToUtc, tzOffsetMs, calendarDayOfWeek, parseCalendarDate, eachCalendarDate,
} from './zoned-time';

const CT = 'America/Chicago';

/**
 * These assert against REAL DST transitions rather than a fixed offset. The whole reason
 * availability is stored as local-minutes-plus-a-zone is that a stored absolute instant
 * drifts an hour twice a year; if this file were wrong, the drift would come straight back.
 */
describe('zonedWallClockToUtc', () => {
  it('resolves 10:00 CT in winter (CST, UTC-6)', () => {
    expect(zonedWallClockToUtc(2026, 1, 20, 600, CT).toISOString()).toBe('2026-01-20T16:00:00.000Z');
  });

  it('resolves 10:00 CT in summer (CDT, UTC-5)', () => {
    expect(zonedWallClockToUtc(2026, 7, 21, 600, CT).toISOString()).toBe('2026-07-21T15:00:00.000Z');
  });

  it('keeps the same WALL CLOCK across the spring-forward boundary', () => {
    // US DST 2026 begins Sun 8 March. A 10:00 slot must stay 10:00 local on both sides —
    // the UTC instant is what moves, which is exactly what a stored instant gets wrong.
    const before = zonedWallClockToUtc(2026, 3, 3, 600, CT);
    const after = zonedWallClockToUtc(2026, 3, 10, 600, CT);
    expect(before.toISOString()).toBe('2026-03-03T16:00:00.000Z');
    expect(after.toISOString()).toBe('2026-03-10T15:00:00.000Z');
  });

  it('keeps the same wall clock across the fall-back boundary', () => {
    // US DST 2026 ends Sun 1 November.
    expect(zonedWallClockToUtc(2026, 10, 27, 600, CT).toISOString()).toBe('2026-10-27T15:00:00.000Z');
    expect(zonedWallClockToUtc(2026, 11, 3, 600, CT).toISOString()).toBe('2026-11-03T16:00:00.000Z');
  });

  it('lands on a real instant for a wall-clock time that does not exist', () => {
    // 02:30 on spring-forward morning never occurs. A slot must still be a moment that
    // happens, so it resolves forward rather than throwing or going backwards.
    const d = zonedWallClockToUtc(2026, 3, 8, 150, CT);
    expect(Number.isNaN(d.getTime())).toBe(false);
    expect(d.toISOString()).toBe('2026-03-08T08:30:00.000Z');
  });

  it('is independent of the host timezone', () => {
    // The point of the whole file: same answer wherever the server runs.
    expect(zonedWallClockToUtc(2026, 7, 21, 600, 'UTC').toISOString()).toBe('2026-07-21T10:00:00.000Z');
  });
});

describe('tzOffsetMs', () => {
  it('reports -6h in January and -5h in July for Chicago', () => {
    expect(tzOffsetMs(new Date('2026-01-20T12:00:00Z'), CT)).toBe(-6 * 3_600_000);
    expect(tzOffsetMs(new Date('2026-07-20T12:00:00Z'), CT)).toBe(-5 * 3_600_000);
  });
});

describe('calendar helpers', () => {
  it('computes day of week without touching timezones', () => {
    expect(calendarDayOfWeek(2026, 9, 21)).toBe(1); // Monday
    expect(calendarDayOfWeek(2026, 9, 27)).toBe(0); // Sunday
  });

  it('parses and rejects', () => {
    expect(parseCalendarDate('2026-09-21')).toEqual({ year: 2026, month: 9, day: 21 });
    expect(parseCalendarDate('2026-13-01')).toBeNull();
    expect(parseCalendarDate('nonsense')).toBeNull();
  });

  it('enumerates inclusive ranges and respects the cap', () => {
    const r = eachCalendarDate({ year: 2026, month: 9, day: 21 }, { year: 2026, month: 9, day: 24 }, 365);
    expect(r).toHaveLength(4);
    expect(r[3]).toEqual({ year: 2026, month: 9, day: 24 });
    expect(eachCalendarDate({ year: 2026, month: 9, day: 1 }, { year: 2027, month: 9, day: 1 }, 10)).toHaveLength(10);
  });

  it('crosses a month boundary correctly', () => {
    const r = eachCalendarDate({ year: 2026, month: 9, day: 30 }, { year: 2026, month: 10, day: 2 }, 365);
    expect(r).toEqual([
      { year: 2026, month: 9, day: 30 },
      { year: 2026, month: 10, day: 1 },
      { year: 2026, month: 10, day: 2 },
    ]);
  });
});
