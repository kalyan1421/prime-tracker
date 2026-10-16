/**
 * Ordering rules for the Leads list. The ones worth pinning are the non-obvious ones:
 * blanks always sink, pipeline stage follows the funnel rather than the alphabet, and
 * follow-ups compare as calendar days.
 */
import { describe, it, expect } from 'vitest';
import {
  sortLeads, matchFollowUp, followUpDays, defaultDirFor, isLeadSortKey,
} from './leadSort';

/** YYYY-MM-DD, N days from today in local time — what followUpDate carries. */
const day = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const ago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const names = (xs: any[]) => xs.map((x) => x.name);

describe('sortLeads', () => {
  it('returns a copy and leaves the input alone', () => {
    const input = [{ name: 'b' }, { name: 'a' }];
    const out = sortLeads(input, { key: 'name', dir: 'asc' });
    expect(names(out)).toEqual(['a', 'b']);
    expect(names(input)).toEqual(['b', 'a']);
  });

  it('sorts names case-insensitively, and flips on desc', () => {
    const leads = [{ name: 'charlie' }, { name: 'Alpha' }, { name: 'bravo' }];
    expect(names(sortLeads(leads, { key: 'name', dir: 'asc' }))).toEqual(['Alpha', 'bravo', 'charlie']);
    expect(names(sortLeads(leads, { key: 'name', dir: 'desc' }))).toEqual(['charlie', 'bravo', 'Alpha']);
  });

  it('sinks blanks to the bottom in BOTH directions', () => {
    const leads = [{ name: '' }, { name: 'b' }, { name: null }, { name: 'a' }];
    expect(names(sortLeads(leads, { key: 'name', dir: 'asc' })).slice(0, 2)).toEqual(['a', 'b']);
    expect(names(sortLeads(leads, { key: 'name', dir: 'desc' })).slice(0, 2)).toEqual(['b', 'a']);
  });

  it('orders pipeline stage by the funnel, not the alphabet', () => {
    const order = ['NEW', 'CONTACTED', 'NEGOTIATING', 'CONVERTED'];
    const leads = [
      { name: 'c', status: 'CONVERTED' }, { name: 'n', status: 'NEW' },
      { name: 'g', status: 'NEGOTIATING' }, { name: 't', status: 'CONTACTED' },
    ];
    expect(names(sortLeads(leads, { key: 'status', dir: 'asc' }, order))).toEqual(['n', 't', 'g', 'c']);
  });

  it('puts overdue follow-ups first and leads with none set last', () => {
    const leads = [
      { name: 'none' }, { name: 'next week', followUpDate: day(7) },
      { name: 'late', followUpDate: day(-3) }, { name: 'today', followUpDate: day(0) },
    ];
    expect(names(sortLeads(leads, { key: 'followUp', dir: 'asc' })))
      .toEqual(['late', 'today', 'next week', 'none']);
  });

  it('sorts unit numbers naturally — 9 before 10', () => {
    const leads = [{ name: 'x', unit: { unitNumber: '10' } }, { name: 'y', unit: { unitNumber: '9' } }];
    expect(names(sortLeads(leads, { key: 'unit', dir: 'asc' }))).toEqual(['y', 'x']);
  });

  it('falls back to the building name for whole-building leads', () => {
    const leads = [{ name: 'u', unit: { unitNumber: 'Z1' } }, { name: 'b', building: { name: 'B2' } }];
    expect(names(sortLeads(leads, { key: 'unit', dir: 'asc' }))).toEqual(['b', 'u']);
  });

  it('treats a missing call count as zero, not blank', () => {
    const leads = [{ name: 'none' }, { name: 'two', callCount: 2 }];
    expect(names(sortLeads(leads, { key: 'calls', dir: 'asc' }))).toEqual(['none', 'two']);
  });

  it('most-stale keeps the old default: stale first, fresh and closed leads after', () => {
    const leads = [
      { name: 'fresh', status: 'NEW', updatedAt: ago(1) },
      { name: 'cold', status: 'NEW', updatedAt: ago(40) },
      { name: 'closed', status: 'CONVERTED', updatedAt: ago(90) },
      { name: 'cool', status: 'NEW', updatedAt: ago(20) },
    ];
    expect(names(sortLeads(leads, { key: 'stale', dir: 'desc' })))
      .toEqual(['cold', 'cool', 'fresh', 'closed']);
  });

  it('is stable — ties keep their incoming order', () => {
    const leads = [{ name: 'first', source: 'WEBSITE' }, { name: 'second', source: 'WEBSITE' }];
    expect(names(sortLeads(leads, { key: 'source', dir: 'desc' }))).toEqual(['first', 'second']);
  });
});

describe('matchFollowUp', () => {
  const late = { followUpDate: day(-1) };
  const today = { followUpDate: day(0) };
  const soon = { followUpDate: day(5) };
  const far = { followUpDate: day(30) };
  const none = {};

  it('passes everything when no filter is set', () => {
    expect([late, today, soon, far, none].every((l) => matchFollowUp(l, ''))).toBe(true);
  });
  it('overdue is strictly before today', () => {
    expect([late, today, soon, none].map((l) => matchFollowUp(l, 'overdue'))).toEqual([true, false, false, false]);
  });
  it('next 7 days includes today and excludes overdue', () => {
    expect([late, today, soon, far].map((l) => matchFollowUp(l, 'week'))).toEqual([false, true, true, false]);
  });
  it('"none" finds leads nobody has scheduled', () => {
    expect([late, none].map((l) => matchFollowUp(l, 'none'))).toEqual([false, true]);
  });
});

describe('helpers', () => {
  it('followUpDays compares calendar days', () => {
    expect(followUpDays({ followUpDate: `${day(0)}T00:00:00.000Z` })).toBe(0);
    expect(followUpDays({})).toBeNull();
  });
  it('fields start in the direction a person means', () => {
    expect(defaultDirFor('added')).toBe('desc');
    expect(defaultDirFor('followUp')).toBe('asc');
  });
  it('rejects unknown keys read back from storage', () => {
    expect(isLeadSortKey('name')).toBe(true);
    expect(isLeadSortKey('drop table')).toBe(false);
  });
});
