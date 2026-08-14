/**
 * The derivations behind "who is actually in this unit" and "what did that edit mean".
 *
 * These exist because of a real defect: a unit reading AVAILABLE while the panel above it
 * confidently displayed a tenant, because the panel trusted `lease.status` — a field a
 * human has to remember to change. Everything here is computed from dates, which cannot
 * drift, and these tests are what hold that line.
 */
import { describe, it, expect } from 'vitest';
import {
  TENANTED_STATUSES, tenancyState, changeDelta, summariseChanges, fmtChangeValue,
} from './tenancy';

/** N days from now, as an ISO date the helpers accept. */
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString();

describe('TENANTED_STATUSES', () => {
  it('covers every status that asserts somebody is in the space', () => {
    expect(TENANTED_STATUSES).toEqual(['LEASED', 'LEASE_PENDING', 'OCCUPIED']);
  });

  it('excludes UNDER_CONTRACT — that is a SALE being negotiated, not a tenancy', () => {
    expect(TENANTED_STATUSES).not.toContain('UNDER_CONTRACT');
    expect(TENANTED_STATUSES).not.toContain('SOLD');
  });
});

describe('tenancyState', () => {
  it('reads a move-out date as ended, whatever the status still says', () => {
    // The drift case in its purest form: status ACTIVE, tenant gone.
    const s = tenancyState({ status: 'ACTIVE', leaseEnd: inDays(400), terminationDate: inDays(-30) });
    expect(s.key).toBe('ENDED');
    expect(s.isPast).toBe(true);
    expect(s.note).toMatch(/Moved out/);
  });

  it('treats a term that ran out as "Term ended", NOT as Active', () => {
    const s = tenancyState({ status: 'ACTIVE', leaseEnd: inDays(-10) });
    expect(s.key).toBe('OVERDUE_TO_CLOSE');
    expect(s.label).toBe('Term ended');
    // Deliberately not isPast: nobody has said the tenant left, so the unit must not be
    // rendered as vacant on the strength of a date alone.
    expect(s.isPast).toBe(false);
    expect(s.note).toMatch(/never closed/);
  });

  it('warns inside the last 60 days', () => {
    const s = tenancyState({ status: 'ACTIVE', leaseEnd: inDays(30) });
    expect(s.key).toBe('ENDING_SOON');
    expect(s.note).toMatch(/30 days/);
  });

  it('is plainly current with a term well in the future', () => {
    const s = tenancyState({ status: 'ACTIVE', leaseEnd: inDays(400) });
    expect(s.key).toBe('CURRENT');
    expect(s.label).toBe('Active');
    expect(s.isPast).toBe(false);
  });

  it('says a draft is billing nothing', () => {
    const s = tenancyState({ status: 'DRAFT', leaseEnd: inDays(400) });
    expect(s.key).toBe('DRAFT');
    expect(s.note).toMatch(/no rent is being billed/);
  });

  it('a terminated status ends the tenancy even with no move-out date recorded', () => {
    const s = tenancyState({ status: 'TERMINATED', leaseEnd: inDays(-5) });
    expect(s.key).toBe('ENDED');
    expect(s.isPast).toBe(true);
  });

  it('an ended tenancy outranks a draft — a draft that was terminated is over, not pending', () => {
    const s = tenancyState({ status: 'DRAFT', leaseEnd: inDays(400), terminationDate: inDays(-1) });
    expect(s.key).toBe('ENDED');
  });

  it('survives a lease with no end date at all', () => {
    expect(tenancyState({ status: 'ACTIVE' }).key).toBe('CURRENT');
    expect(tenancyState(null).key).toBe('CURRENT');
  });
});

describe('changeDelta', () => {
  it('states the direction of a money change in words, never by colour', () => {
    // Up is good for rent and bad for a TI allowance, so a green/red judgement would be
    // wrong half the time.
    expect(changeDelta({ from: '1000', to: '1250', type: 'money' })).toBe('+$250');
    expect(changeDelta({ from: '1250', to: '1000', type: 'money' })).toBe('−$250');
  });

  it('does the date arithmetic the reader was about to do', () => {
    expect(changeDelta({ from: '2026-01-01', to: '2026-01-15', type: 'date' })).toBe('14 days later');
    expect(changeDelta({ from: '2026-01-15', to: '2026-01-01', type: 'date' })).toBe('14 days earlier');
  });

  it('switches to months once days stop being holdable in the head', () => {
    expect(changeDelta({ from: '2026-01-01', to: '2027-02-01', type: 'date' })).toBe('13 months later');
  });

  it('annotates percentages in points, not percent-of-percent', () => {
    expect(changeDelta({ from: '3', to: '5', type: 'pct' })).toBe('+2 pts');
  });

  it('counts plain numbers as more or fewer', () => {
    expect(changeDelta({ from: '36', to: '60', type: 'number' })).toBe('24 more');
    expect(changeDelta({ from: '60', to: '36', type: 'number' })).toBe('24 fewer');
  });

  it('says nothing when there is nothing useful to say', () => {
    // An annotation on every row is noise, and noise is what stops people reading a log.
    expect(changeDelta({ from: null, to: '1000', type: 'money' })).toBeNull();
    expect(changeDelta({ from: '1000', to: '1000', type: 'money' })).toBeNull();
    expect(changeDelta({ from: '2026-01-01', to: '2026-01-01', type: 'date' })).toBeNull();
    expect(changeDelta({ from: 'Acme', to: 'Acme Corp', type: 'text' })).toBeNull();
  });

  it('returns null rather than NaN on unparseable values', () => {
    expect(changeDelta({ from: 'abc', to: 'def', type: 'money' })).toBeNull();
    expect(changeDelta({ from: 'not-a-date', to: '2026-01-01', type: 'date' })).toBeNull();
  });
});

describe('summariseChanges', () => {
  it('reads naturally at one, two and many', () => {
    expect(summariseChanges([{ label: 'Rent' }])).toBe('Rent changed');
    expect(summariseChanges([{ label: 'Rent' }, { label: 'Term' }]))
      .toBe('Rent and Term changed');
    expect(summariseChanges([{ label: 'Rent' }, { label: 'Term' }, { label: 'Deposit' }, { label: 'TI' }]))
      .toBe('Rent, Term and 2 more changed');
  });

  it('says nothing for an empty change set', () => {
    expect(summariseChanges([])).toBeNull();
    expect(summariseChanges()).toBeNull();
  });
});

describe('fmtChangeValue', () => {
  it('renders a missing value as "not set" rather than an empty gap', () => {
    expect(fmtChangeValue(null, 'money')).toBe('not set');
    expect(fmtChangeValue('', 'date')).toBe('not set');
  });

  it('puts strings back into the shape they were stored from', () => {
    expect(fmtChangeValue('1500', 'money')).toBe('$1,500');
    expect(fmtChangeValue('Acme', 'text')).toBe('Acme');
  });
});
