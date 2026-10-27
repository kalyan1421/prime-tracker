import { looksLikeWholeBuildingRef, resolveBuilding } from './xlsx-import';

const buildings = [
  { id: 'b7', name: 'Building 7' },
  { id: 'b8', name: 'Building 8' },
];

describe('whole-building import rows', () => {
  it('recognises both spellings but not an ordinary unit', () => {
    expect(looksLikeWholeBuildingRef('Entire Building')).toBe(true);
    expect(looksLikeWholeBuildingRef('Building 6 (whole)')).toBe(true);
    expect(looksLikeWholeBuildingRef('Building 1 - 104')).toBe(false);
    expect(looksLikeWholeBuildingRef('104')).toBe(false);
  });

  it('resolves by the Building column, case-insensitively', () => {
    expect(resolveBuilding(buildings, 'Entire Building', 'building 7')).toEqual({ buildingId: 'b7' });
  });

  it('accepts a longer sheet label that ends with the building name', () => {
    expect(resolveBuilding(buildings, 'Entire Building', 'Reagan Ranch Commercial (RRC) - Building 7'))
      .toEqual({ buildingId: 'b7' });
  });

  it('takes the building from "Building 8 (whole)" when no column is given', () => {
    expect(resolveBuilding(buildings, 'Building 8 (whole)', '')).toEqual({ buildingId: 'b8' });
  });

  it('never guesses when the building is not named', () => {
    const r = resolveBuilding(buildings, 'Entire Building', '');
    expect(r.buildingId).toBeNull();
    expect(r.error).toMatch(/name the building/i);
  });

  it('reports an unknown building', () => {
    const r = resolveBuilding(buildings, 'Entire Building', 'Building 9');
    expect(r.buildingId).toBeNull();
    expect(r.error).toMatch(/not found/);
  });
});
