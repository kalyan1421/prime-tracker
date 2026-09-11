import { apportion } from './rent-apportionment';

describe('apportion — one deal total across its units', () => {
  it('divides by area when every part has one', () => {
    const { basis, shares } = apportion(4500, [
      { key: '104', area: 1200 }, { key: '105', area: 900 }, { key: '106', area: 900 },
    ]);
    expect(basis).toBe('sqft');
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(4500);
    expect(shares.find((s) => s.key === '104')!.amount).toBe(1800);
  });

  it('falls back to an even split when ANY part lacks an area', () => {
    // One part's area alone would take the whole total and zero the others.
    const { basis, shares } = apportion(4500, [
      { key: 'a', area: 1200 }, { key: 'b', area: null }, { key: 'c', area: 900 },
    ]);
    expect(basis).toBe('even');
    expect(shares.map((s) => s.amount)).toEqual([1500, 1500, 1500]);
  });

  it('makes the shares sum to the total exactly, remainder on the largest', () => {
    // 12,016.16 / 3 does not divide evenly; the group must still bill the deal.
    const { shares } = apportion(12016.16, [{ key: 'a' }, { key: 'b' }, { key: 'c' }]);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(12016.16);
  });

  it('gives the carrying part a share too, never the whole total again', () => {
    // RRC-B7-700-701 billed 8,641.66 + 4,456.83 against a real base of 8,641.66.
    const { shares } = apportion(8641.66, [{ key: '700' }, { key: '701' }]);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(8641.66);
    expect(shares.every((s) => s.amount < 8641.66)).toBe(true);
  });

  it('handles a single part and an empty list', () => {
    expect(apportion(1000, [{ key: 'a' }]).shares).toEqual([{ key: 'a', amount: 1000 }]);
    expect(apportion(1000, []).shares).toEqual([]);
  });
});
