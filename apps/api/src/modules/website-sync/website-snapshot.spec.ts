import { SourceProject, SourceUnit, buildSnapshot, snapshotHash } from './website-snapshot';
import { sign } from './website-signature';

/**
 * The snapshot is the privacy boundary between the tracker and the public website.
 * These tests pin what may cross it, and that units are grouped the way the tracker's
 * own "N units leased together" groups them.
 */
const unit = (over: Partial<SourceUnit> & Pick<SourceUnit, 'id' | 'unitNumber' | 'status'>): SourceUnit => ({
  sqft: null,
  leases: [],
  sales: [],
  ...over,
});

const project = (units: SourceUnit[]): SourceProject => ({
  id: 'proj-centro',
  name: 'Centro Plaza',
  websiteSlug: 'centro-plaza',
  buildings: [{ id: 'b2', name: 'Building 2', units }],
});

const NOW = new Date('2026-10-23T10:00:00.000Z');

describe('buildSnapshot', () => {
  it('carries the active tenant brand for a leased unit, falling back to the tenant name', () => {
    const snap = buildSnapshot(
      project([
        unit({ id: 'a', unitNumber: '202', status: 'LEASED', leases: [{ combinedDealRef: null, tenantBrand: 'Devi Liquors', tenantName: 'Devi Holdings LLC' }] }),
        unit({ id: 'b', unitNumber: '206', status: 'OCCUPIED', leases: [{ combinedDealRef: null, tenantBrand: '  ', tenantName: 'JRays Corner' }] }),
      ]),
      NOW,
    );
    expect(snap.buildings[0].units.map((u) => u.occupant)).toEqual(['Devi Liquors', 'JRays Corner']);
  });

  it('never names anyone on a sold, available or pending unit', () => {
    const lease = [{ combinedDealRef: null, tenantBrand: 'Old Tenant', tenantName: 'Old Tenant LLC' }];
    const snap = buildSnapshot(
      project([
        unit({ id: 'a', unitNumber: '205', status: 'SOLD', leases: lease, sales: [{ status: 'CLOSED', combinedDealRef: null }] }),
        unit({ id: 'b', unitNumber: '207', status: 'AVAILABLE', leases: lease }),
        unit({ id: 'c', unitNumber: '208', status: 'LEASE_PENDING', leases: lease }),
      ]),
      NOW,
    );
    expect(snap.buildings[0].units.map((u) => u.occupant)).toEqual([null, null, null]);
  });

  it('puts no buyer, price, rent or contact detail anywhere in the payload', () => {
    const source = project([
      unit({
        id: 'a',
        unitNumber: '205',
        status: 'SOLD',
        // An asking price on a sold unit would read as what the buyer paid.
        askingPrice: 412001,
        sales: [{ status: 'CLOSED', combinedDealRef: 'BLDG2-SUITE', buyer: 'Sai Reddy', salePrice: 412000 } as any],
      }),
      unit({
        id: 'b',
        unitNumber: '202',
        status: 'LEASED',
        askingRent: 3685,
        leases: [{ combinedDealRef: null, tenantBrand: 'Devi Liquors', tenantName: 'x', monthlyRent: 3684, tenantEmail: 'a@b.c' } as any],
      }),
    ]);
    const json = JSON.stringify(buildSnapshot(source, NOW));
    for (const leaked of ['Sai Reddy', '412000', '412001', '3684', '3685', 'a@b.c', 'buyer', 'salePrice', 'monthlyRent', 'tenantEmail']) {
      expect(json).not.toContain(leaked);
    }
  });

  it('groups by the sale for a sold unit and by the lease otherwise, as the tracker UI does', () => {
    const snap = buildSnapshot(
      project([
        unit({ id: 'a', unitNumber: '203', status: 'LEASED', leases: [{ combinedDealRef: 'JB', tenantBrand: 'JB Sree', tenantName: 'JB' }] }),
        unit({
          id: 'b',
          unitNumber: '401',
          status: 'SOLD',
          // The lease is history once the unit is sold; the sale decides.
          leases: [{ combinedDealRef: 'OLD-LEASE', tenantBrand: null, tenantName: 'x' }],
          sales: [
            { status: 'CANCELLED', combinedDealRef: 'DEAD' },
            { status: 'CLOSED', combinedDealRef: ' PRODIGY ' },
          ],
        }),
        unit({ id: 'c', unitNumber: '402', status: 'AVAILABLE' }),
      ]),
      NOW,
    );
    expect(snap.buildings[0].units.map((u) => u.dealRef)).toEqual(['LEASE:JB', 'SALE:PRODIGY', null]);
  });

  it('sends version 2: unit type, availability date, building size and stories', () => {
    const snap = buildSnapshot(
      {
        ...project([]),
        buildings: [
          {
            id: 'b7',
            name: 'Building 7',
            totalSqft: 9800,
            stories: 1,
            units: [
              unit({ id: 'a', unitNumber: '701', status: 'AVAILABLE', unitType: ' RETAIL ', availableSince: new Date('2026-09-16T00:00:00.000Z') }),
            ],
          },
        ],
      },
      NOW,
    );
    expect(snap.version).toBe(2);
    expect(snap.buildings[0]).toMatchObject({ id: 'b7', totalSqft: 9800, stories: 1 });
    expect(snap.buildings[0].units[0]).toMatchObject({
      unitType: 'RETAIL',
      availableSince: '2026-09-16T00:00:00.000Z',
      dealUnitIds: [],
      mergedFromIds: [],
    });
  });

  it('sends asking figures only while a unit is on the market, as plain numbers', () => {
    const decimal = (value: string) => ({ toString: () => value });
    const asking = { askingRent: decimal('24.50'), askingPrice: decimal('650000.00') };
    const snap = buildSnapshot(
      project([
        unit({ id: 'a', unitNumber: '701', status: 'AVAILABLE', ...asking }),
        unit({ id: 'b', unitNumber: '702', status: 'UNDER_CONSTRUCTION', ...asking }),
        unit({ id: 'c', unitNumber: '703', status: 'LEASED', ...asking }),
        unit({ id: 'd', unitNumber: '704', status: 'LEASE_PENDING', ...asking }),
        unit({ id: 'e', unitNumber: '705', status: 'UNDER_CONTRACT', ...asking }),
        unit({ id: 'f', unitNumber: '706', status: 'SOLD', ...asking }),
      ]),
      NOW,
    );
    expect(snap.buildings[0].units.map((u) => [u.unitNumber, u.askingRent, u.askingPrice])).toEqual([
      ['701', 24.5, 650000],
      ['702', 24.5, 650000],
      ['703', null, null],
      ['704', null, null],
      ['705', null, null],
      ['706', null, null],
    ]);
  });

  it('names every unit in a deal, whatever its status — a SOLD unit and its UNDER_CONTRACT partner stay one deal', () => {
    const snap = buildSnapshot(
      project([
        unit({ id: 'u402', unitNumber: '402', status: 'SOLD', sales: [{ status: 'CLOSED', combinedDealRef: 'PRODIGY' }] }),
        unit({ id: 'u404', unitNumber: '404', status: 'UNDER_CONTRACT', sales: [{ status: 'UNDER_CONTRACT', combinedDealRef: 'PRODIGY' }] }),
        unit({ id: 'u405', unitNumber: '405', status: 'AVAILABLE', sales: [{ status: 'CANCELLED', combinedDealRef: 'PRODIGY' }] }),
        unit({ id: 'u203', unitNumber: '203', status: 'LEASED', leases: [{ combinedDealRef: 'JB', tenantBrand: 'JB', tenantName: 'JB' }] }),
        unit({ id: 'u204', unitNumber: '204', status: 'LEASED', leases: [{ combinedDealRef: 'JB', tenantBrand: 'JB', tenantName: 'JB' }] }),
        unit({ id: 'u406', unitNumber: '406', status: 'AVAILABLE' }),
      ]),
      NOW,
    );
    const byNumber = Object.fromEntries(snap.buildings[0].units.map((u) => [u.unitNumber, u]));
    expect(byNumber['402'].dealUnitIds).toEqual(['u402', 'u404']);
    expect(byNumber['404'].dealUnitIds).toEqual(['u402', 'u404']);
    // The website still groups as the tracker UI does: 404's deal ref is unchanged.
    expect([byNumber['402'].dealRef, byNumber['404'].dealRef]).toEqual(['SALE:PRODIGY', null]);
    expect(byNumber['405'].dealUnitIds).toEqual([]);
    expect(byNumber['203'].dealUnitIds).toEqual(['u203', 'u204']);
    expect(byNumber['406'].dealUnitIds).toEqual([]);
  });

  it('sends the ids a combined unit was made from, two combines deep', () => {
    const snap = buildSnapshot(
      project([
        unit({
          id: 'c2',
          unitNumber: '701+702+703',
          status: 'AVAILABLE',
          mergedFrom: [{ id: 'c1', mergedFrom: [{ id: 'u702' }, { id: 'u701' }] }, { id: 'u703', mergedFrom: [] }],
        }),
      ]),
      NOW,
    );
    expect(snap.buildings[0].units[0].mergedFromIds).toEqual(['c1', 'u701', 'u702', 'u703']);
  });

  it('orders units by number, not by string', () => {
    const snap = buildSnapshot(
      project([
        unit({ id: 'a', unitNumber: '1001', status: 'AVAILABLE' }),
        unit({ id: 'b', unitNumber: '201', status: 'AVAILABLE' }),
        unit({ id: 'c', unitNumber: '99', status: 'AVAILABLE' }),
      ]),
      NOW,
    );
    expect(snap.buildings[0].units.map((u) => u.unitNumber)).toEqual(['99', '201', '1001']);
  });
});

describe('snapshotHash', () => {
  it('ignores when the snapshot was built and nothing else', () => {
    const source = project([unit({ id: 'a', unitNumber: '201', status: 'AVAILABLE', sqft: 1200 })]);
    const earlier = buildSnapshot(source, new Date('2026-01-01'));
    const later = buildSnapshot(source, new Date('2026-06-01'));
    expect(snapshotHash(earlier)).toBe(snapshotHash(later));

    const sold = buildSnapshot(project([unit({ id: 'a', unitNumber: '201', status: 'SOLD', sqft: 1200 })]), NOW);
    expect(snapshotHash(sold)).not.toBe(snapshotHash(earlier));
  });
});

describe('sign', () => {
  // The same vector is asserted in PrimeDevelopers-web apps/api/test/tracker-sync.test.ts.
  // If either side changes how it signs, one of the two suites fails.
  it('matches the vector shared with the website', () => {
    expect(sign('test-secret', '1761213600000', '/api/integrations/tracker/snapshot?force=true', '{"version":1}')).toBe(
      'sha256=d802ec60fc1d55f09dc2028a1bfddbf8a9417d69d2d069c843e7b154501f7f1e',
    );
  });
});
