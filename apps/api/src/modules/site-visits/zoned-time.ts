/**
 * Local-wall-clock <-> UTC conversion for a named IANA timezone, with no date library.
 *
 * Availability is stored as a RULE — "Tuesdays, minute 600 to minute 960, America/Chicago"
 * — because a recurring weekly window has no absolute instant. Bookings are stored as
 * absolute UTC. Something has to bridge the two, and that is this file.
 *
 * Doing it with `new Date(...)` and the host's local timezone would make every generated
 * slot depend on where the server happens to run, which is the same class of bug that
 * already produced a time-of-day-dependent test failure in this repo. Intl is used instead
 * because it is the only thing in the platform that actually knows about DST.
 */

/**
 * Milliseconds that `timeZone` is ahead of UTC AT THIS INSTANT. Must be evaluated per
 * instant, not per zone: America/Chicago is -6h in January and -5h in July.
 */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    // Intl emits hour 24 for midnight under hour12:false in some ICU versions.
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** The wall clock an instant shows in `timeZone`, as calendar parts plus minutes-past-midnight. */
export function wallClockInZone(
  date: Date, timeZone: string,
): { year: number; month: number; day: number; minutes: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads y-m-d at `minutes` past
 * midnight.
 *
 * Two passes, deliberately: the offset depends on the instant, but the instant is what we
 * are solving for. The first pass guesses using the offset at the naive time; the second
 * re-reads the offset at that candidate. That converges for every wall-clock time that
 * actually exists.
 *
 * The hour skipped by spring-forward does NOT exist, and there the two passes disagree —
 * left alone, the second pass resolves 02:30 backwards to 01:30, which is not what anyone
 * booking a slot means. So the result is round-tripped: if it does not read back as the
 * time that was asked for, we are inside the gap, and the first pass (which lands just
 * after the transition) is the forward resolution. A slot must be a moment that occurs.
 *
 * The hour repeated by fall-back exists TWICE; either instant is defensible and the two
 * passes agree on the first, which is what we keep.
 */
export function zonedWallClockToUtc(
  year: number, month: number, day: number, minutes: number, timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  const firstPass = new Date(naive - tzOffsetMs(new Date(naive), timeZone));
  const settled = new Date(naive - tzOffsetMs(firstPass, timeZone));

  const readBack = wallClockInZone(settled, timeZone);
  const asked = { year, month, day, minutes };
  const matches = readBack.year === asked.year && readBack.month === asked.month
    && readBack.day === asked.day && readBack.minutes === asked.minutes;
  return matches ? settled : firstPass;
}

/** Day of week (0=Sun..6=Sat) for a plain calendar date. Pure arithmetic — no zone involved. */
export function calendarDayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Parse "YYYY-MM-DD" into its parts. Returns null when it is not a plain calendar date. */
export function parseCalendarDate(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Inclusive list of calendar dates from `from` to `to`, as plain Y/M/D tuples. */
export function eachCalendarDate(
  from: { year: number; month: number; day: number },
  to: { year: number; month: number; day: number },
  maxDays: number,
): Array<{ year: number; month: number; day: number }> {
  const out: Array<{ year: number; month: number; day: number }> = [];
  const end = Date.UTC(to.year, to.month - 1, to.day);
  let cursor = Date.UTC(from.year, from.month - 1, from.day);
  while (cursor <= end && out.length < maxDays) {
    const d = new Date(cursor);
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
    cursor += 86_400_000;
  }
  return out;
}

/** "Tue 24 Sep, 10:00 AM" in the visit's own timezone — for notification and UI copy. */
export function formatInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date);
}
