import { describe, it, expect } from 'vitest';
import { looksLikeCombinedUnitRef, looksLikeWholeBuildingRef, looksLikeNonUnitRef } from './import-helpers';

describe('looksLikeCombinedUnitRef', () => {
  it('flags comma-separated unit lists', () => {
    expect(looksLikeCombinedUnitRef('104, 106')).toBe(true);
    expect(looksLikeCombinedUnitRef('108, 110, 112, 114')).toBe(true);
  });

  it('flags "and"/"&" joined unit lists', () => {
    expect(looksLikeCombinedUnitRef('700 and 701')).toBe(true);
    expect(looksLikeCombinedUnitRef('1001 & 1002')).toBe(true);
  });

  it('does not flag a plain unit number', () => {
    expect(looksLikeCombinedUnitRef('104')).toBe(false);
    expect(looksLikeCombinedUnitRef('B12')).toBe(false);
  });
});

describe('looksLikeWholeBuildingRef', () => {
  it('flags "Entire Building" case-insensitively, with surrounding whitespace', () => {
    expect(looksLikeWholeBuildingRef('Entire Building')).toBe(true);
    expect(looksLikeWholeBuildingRef('entire building')).toBe(true);
    expect(looksLikeWholeBuildingRef('  Entire Building  ')).toBe(true);
  });

  it('flags the lease workbook\'s "Building N (whole)" spelling', () => {
    expect(looksLikeWholeBuildingRef('Building 6 (whole)')).toBe(true);
    expect(looksLikeWholeBuildingRef('Building 10 (whole)')).toBe(true);
    expect(looksLikeWholeBuildingRef('building 5 (WHOLE)')).toBe(true);
  });

  it('does not flag a real unit number, even one containing the word "building"', () => {
    expect(looksLikeWholeBuildingRef('104')).toBe(false);
    expect(looksLikeWholeBuildingRef('Building 1 - 104')).toBe(false);
  });
});

describe('looksLikeNonUnitRef', () => {
  it('flags a "(prior)" suffix marking an earlier tenancy of an existing unit', () => {
    expect(looksLikeNonUnitRef('101 (prior)')).toBe(true);
    expect(looksLikeNonUnitRef('700-701 (prior)')).toBe(true);
  });

  it('flags placeholders standing in for a unit number the source never recorded', () => {
    expect(looksLikeNonUnitRef('Not recorded')).toBe(true);
    expect(looksLikeNonUnitRef('N/A')).toBe(true);
    expect(looksLikeNonUnitRef('TBD')).toBe(true);
    expect(looksLikeNonUnitRef('  -  ')).toBe(true);
  });

  it('does not flag a real unit number', () => {
    expect(looksLikeNonUnitRef('101')).toBe(false);
    expect(looksLikeNonUnitRef('12110')).toBe(false);
    expect(looksLikeNonUnitRef('B12')).toBe(false);
  });
});
