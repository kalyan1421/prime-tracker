import { describe, it, expect } from 'vitest';
import { fmtDateShort } from './fmt';

describe('fmtDateShort', () => {
  const thisYear = new Date().getUTCFullYear();

  it('omits the year for a date in the current year', () => {
    // Almost every date on a checklist is this year; spending four characters on something
    // the reader already knows is what made the column noisy.
    expect(fmtDateShort(`${thisYear}-09-01T00:00:00.000Z`)).toBe('Sep 1');
  });

  it('KEEPS the year once it is not obvious', () => {
    // A build running past New Year would otherwise read "Dec 20 – Jan 4" with no way to
    // tell which January.
    expect(fmtDateShort(`${thisYear + 1}-01-04T00:00:00.000Z`)).toBe(`Jan 4, ${thisYear + 1}`);
    expect(fmtDateShort(`${thisYear - 1}-12-20T00:00:00.000Z`)).toBe(`Dec 20, ${thisYear - 1}`);
  });

  it('renders an em dash for no date', () => {
    expect(fmtDateShort(null)).toBe('—');
    expect(fmtDateShort(undefined)).toBe('—');
  });

  it('reads the date in UTC, so a late-evening timestamp does not slip a day', () => {
    expect(fmtDateShort(`${thisYear}-09-01T23:30:00.000Z`)).toBe('Sep 1');
  });
});
