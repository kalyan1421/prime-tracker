import { ReportsService } from './reports.service';

const mockPrisma: any = {
  project: { findMany: jest.fn() },
  interiorProject: { findMany: jest.fn() },
  salePayment: { findMany: jest.fn() },
};

const mockEncryption = { decryptFields: jest.fn((l: any) => l) };
const mockStatusEvents = { currentVacancyStartByUnit: jest.fn().mockResolvedValue(new Map()) };
// Every existing test calls these methods with no viewer (or an unscoped one), so the
// scope resolves to `undefined` — "no extra filter" — matching pre-scoping behavior.
const mockAccess = { listProjectScope: jest.fn().mockResolvedValue(undefined) };

function makeService() {
  return new ReportsService(mockPrisma as any, mockEncryption as any, mockStatusEvents as any, mockAccess as any);
}

const PROJ_A = { id: 'p1', name: 'Alpha', status: 'ACTIVE', phase: 'CONSTRUCTION' };
const PROJ_B = { id: 'p2', name: 'Beta', status: 'ACTIVE', phase: 'LEASE_UP' };

/** A live interior anchored to a unit under project `projectId`. */
function interior(over: Record<string, any> = {}) {
  const projectId = over.projectId ?? 'p1';
  delete over.projectId;
  return {
    id: 'ip1',
    name: 'Unit 101 fit-out',
    status: 'IN_PROGRESS',
    phase: 'EXECUTION',
    contractType: 'PER_SQFT',
    ratePerSqft: null,
    area: null,
    contractValue: null,
    saleId: null,
    startDate: null,
    targetEnd: null,
    handoverAt: null,
    unit: { id: 'u1', unitNumber: '101', building: { id: 'b1', name: 'Tower A', projectId } },
    building: null,
    pm: null,
    invoices: [],
    scopeItems: [],
    ...over,
  };
}

function stub(projects: any[], interiors: any[], payments: any[] = []) {
  mockPrisma.project.findMany.mockResolvedValue(projects);
  mockPrisma.interiorProject.findMany.mockResolvedValue(interiors);
  mockPrisma.salePayment.findMany.mockResolvedValue(payments);
}

const row = (res: any, projectId: string) => res.projects.find((p: any) => p.projectId === projectId);

describe('ReportsService — interior / TI summary', () => {
  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  describe('commitment derivation', () => {
    it('derives a PER_SQFT commitment from rate x area, ignoring a stale contractValue', async () => {
      stub(
        [PROJ_A],
        [interior({ contractType: 'PER_SQFT', ratePerSqft: 120, area: 1500, contractValue: 999 })],
      );

      const res = await service.getInteriorSummary();
      const ip = row(res, 'p1').interiors[0];

      expect(ip.committed).toBe(180_000); // 120 x 1500, not the stale 999
      expect(ip.commitmentBasis).toBe('PER_SQFT');
    });

    it('honours a flat contractValue for a non-PER_SQFT contract', async () => {
      stub([PROJ_A], [interior({ contractType: 'FIXED', contractValue: 250_000, ratePerSqft: 120, area: 1500 })]);

      const res = await service.getInteriorSummary();
      const ip = row(res, 'p1').interiors[0];

      expect(ip.committed).toBe(250_000);
      expect(ip.commitmentBasis).toBe('CONTRACT_VALUE');
    });

    it('falls back to contractValue when a PER_SQFT contract is missing its area', async () => {
      stub([PROJ_A], [interior({ contractType: 'PER_SQFT', ratePerSqft: 120, area: null, contractValue: 90_000 })]);

      const res = await service.getInteriorSummary();
      const ip = row(res, 'p1').interiors[0];

      expect(ip.committed).toBe(90_000);
      expect(ip.commitmentBasis).toBe('CONTRACT_VALUE');
    });

    it('falls back to the BOQ scope-item total when a COST_PLUS job has no contract value', async () => {
      stub(
        [PROJ_A],
        [
          interior({
            contractType: 'COST_PLUS',
            scopeItems: [{ total: 40_000 }, { total: 12_500 }, { total: null }],
          }),
        ],
      );

      const res = await service.getInteriorSummary();
      const ip = row(res, 'p1').interiors[0];

      expect(ip.committed).toBe(52_500);
      expect(ip.commitmentBasis).toBe('SCOPE_ITEMS');
    });

    it('flags a fit-out with no reviewable commitment instead of inventing one', async () => {
      stub([PROJ_A], [interior({ contractType: 'COST_PLUS' })]);

      const res = await service.getInteriorSummary();

      expect(row(res, 'p1').interiors[0].commitmentBasis).toBe('NONE');
      expect(row(res, 'p1').interiors[0].committed).toBe(0);
      expect(res.kpis.missingCommitmentCount).toBe(1);
    });

    it('commits nothing for a CANCELLED fit-out but still reports what was spent on it', async () => {
      stub(
        [PROJ_A],
        [
          interior({
            status: 'CANCELLED',
            ratePerSqft: 100,
            area: 1000,
            invoices: [{ amount: 30_000, paidAt: new Date(), status: 'PAID' }],
          }),
        ],
      );

      const res = await service.getInteriorSummary();

      expect(res.kpis.committed).toBe(0);
      expect(res.kpis.invoiced).toBe(30_000);
      expect(res.kpis.cancelledSpend).toBe(30_000);
      expect(res.kpis.remaining).toBe(0);
      expect(res.kpis.overrun).toBe(30_000);
      // A cancelled job has no commitment to chase, so it is not a "missing commitment".
      expect(res.kpis.missingCommitmentCount).toBe(0);
    });
  });

  describe('invoiced vs committed vs remaining', () => {
    it('splits invoiced into paid / unpaid and leaves the balance as remaining', async () => {
      stub(
        [PROJ_A],
        [
          interior({
            ratePerSqft: 100,
            area: 1000, // committed 100,000
            invoices: [
              { amount: 40_000, paidAt: new Date(), status: 'PAID' },
              { amount: 25_000, paidAt: null, status: 'APPROVED' },
            ],
          }),
        ],
      );

      const res = await service.getInteriorSummary();
      const p = row(res, 'p1');

      expect(p.committed).toBe(100_000);
      expect(p.invoiced).toBe(65_000);
      expect(p.paid).toBe(40_000);
      expect(p.unpaid).toBe(25_000);
      expect(p.remaining).toBe(35_000);
      expect(p.overrun).toBe(0);
      expect(p.pctInvoiced).toBe(65);
    });

    it('reports over-invoicing as overrun and never as negative remaining', async () => {
      stub(
        [PROJ_A],
        [
          interior({
            contractType: 'FIXED',
            contractValue: 50_000,
            invoices: [{ amount: 72_000, paidAt: null, status: 'PENDING' }],
          }),
        ],
      );

      const res = await service.getInteriorSummary();

      expect(res.kpis.remaining).toBe(0);
      expect(res.kpis.overrun).toBe(22_000);
    });
  });

  describe('per-project aggregation', () => {
    it('groups fit-outs under the project their anchor resolves to', async () => {
      stub(
        [PROJ_A, PROJ_B],
        [
          interior({ id: 'ip1', projectId: 'p1', contractType: 'FIXED', contractValue: 100_000 }),
          interior({ id: 'ip2', projectId: 'p1', contractType: 'FIXED', contractValue: 50_000 }),
          // Building-anchored (no unit) — resolves via building.projectId.
          interior({
            id: 'ip3',
            contractType: 'FIXED',
            contractValue: 20_000,
            unit: null,
            building: { id: 'b9', name: 'Retail Block', projectId: 'p2' },
          }),
        ],
      );

      const res = await service.getInteriorSummary();

      expect(row(res, 'p1').interiorCount).toBe(2);
      expect(row(res, 'p1').committed).toBe(150_000);
      expect(row(res, 'p2').interiorCount).toBe(1);
      expect(row(res, 'p2').committed).toBe(20_000);
      expect(row(res, 'p2').interiors[0].buildingName).toBe('Retail Block');
      // Portfolio roll-up falls out of the per-project rows.
      expect(res.kpis.committed).toBe(170_000);
      expect(res.kpis.interiorCount).toBe(3);
    });

    it('returns a zeroed row for a project with no fit-out rather than throwing', async () => {
      stub([PROJ_A], []);

      const res = await service.getInteriorSummary({ projectId: 'p1' });
      const p = row(res, 'p1');

      expect(p.hasInterior).toBe(false);
      expect(p.interiorCount).toBe(0);
      expect(p.committed).toBe(0);
      expect(p.invoiced).toBe(0);
      expect(p.remaining).toBe(0);
      expect(p.pctInvoiced).toBe(0);
      expect(p.interiors).toEqual([]);
      expect(res.scope.projectId).toBe('p1');
      // No interiors -> no need to go looking for TI installments.
      expect(mockPrisma.salePayment.findMany).not.toHaveBeenCalled();
    });

    it('breaks fit-outs down by phase, portfolio-wide and per project', async () => {
      stub(
        [PROJ_A],
        [
          interior({ id: 'ip1', phase: 'DESIGN', contractType: 'FIXED', contractValue: 10_000 }),
          interior({ id: 'ip2', phase: 'EXECUTION', contractType: 'FIXED', contractValue: 30_000 }),
          interior({ id: 'ip3', phase: 'EXECUTION', contractType: 'FIXED', contractValue: 20_000 }),
        ],
      );

      const res = await service.getInteriorSummary();

      const execution = res.byPhase.find((b: any) => b.phase === 'EXECUTION')!;
      expect(execution.count).toBe(2);
      expect(execution.committed).toBe(50_000);
      expect(res.byPhase.find((b: any) => b.phase === 'DESIGN')!.count).toBe(1);
      // Every phase is present so the UI never has to fill gaps.
      expect(res.byPhase).toHaveLength(7);
      expect(res.byPhase.find((b: any) => b.phase === 'HANDOVER')!.count).toBe(0);
      expect(row(res, 'p1').byPhase.EXECUTION).toBe(2);
    });

    it('reports the buyer-side TI installment separately from the cost-to-build', async () => {
      stub(
        [PROJ_A],
        [interior({ saleId: 's1', contractType: 'FIXED', contractValue: 80_000 })],
        [{ interiorProjectId: 'ip1', amount: 120_000, paidAmount: 45_000, status: 'PARTIALLY_PAID' }],
      );

      const res = await service.getInteriorSummary();

      expect(res.kpis.committed).toBe(80_000); // internal cost
      expect(res.kpis.tiBilledToBuyers).toBe(120_000); // client price on the Sale
      expect(res.kpis.tiCollectedFromBuyers).toBe(45_000);
      expect(res.kpis.tiOutstandingFromBuyers).toBe(75_000);
    });
  });

  describe('archived + soft-deleted exclusion', () => {
    it('filters archived projects down the whole anchor chain, not just the Project row', async () => {
      stub([PROJ_A], []);
      await service.getInteriorSummary();

      const where = mockPrisma.interiorProject.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();

      const [unitBranch, buildingBranch] = where.OR;
      // Unit anchor: unit alive -> building alive -> project alive & not cancelled.
      expect(unitBranch.unit.deletedAt).toBeNull();
      expect(unitBranch.unit.building.deletedAt).toBeNull();
      expect(unitBranch.unit.building.project).toMatchObject({
        deletedAt: null,
        status: { not: 'CANCELLED' },
      });
      // Building anchor: same chain, one level shorter.
      expect(buildingBranch.building.deletedAt).toBeNull();
      expect(buildingBranch.building.project).toMatchObject({
        deletedAt: null,
        status: { not: 'CANCELLED' },
      });
      // And the project list itself excludes archived/cancelled projects.
      expect(mockPrisma.project.findMany.mock.calls[0][0].where).toMatchObject({
        deletedAt: null,
        status: { not: 'CANCELLED' },
      });
    });

    it('pushes the projectId filter into every anchor branch, not just the project list', async () => {
      stub([PROJ_A], []);
      await service.getInteriorSummary({ projectId: 'p1' });

      const where = mockPrisma.interiorProject.findMany.mock.calls[0][0].where;
      expect(where.OR[0].unit.building.project.id).toBe('p1');
      expect(where.OR[1].building.project.id).toBe('p1');
    });

    it('drops a soft-deleted interior — the query excludes it and the totals never see it', async () => {
      // The DB filter is asserted above; here the resolved set simply omits it.
      stub([PROJ_A], [interior({ id: 'ip-live', contractType: 'FIXED', contractValue: 10_000 })]);

      const res = await service.getInteriorSummary();

      expect(res.kpis.interiorCount).toBe(1);
      expect(res.kpis.committed).toBe(10_000);
      expect(mockPrisma.interiorProject.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
    });

    it('drops an interior whose anchor resolves outside the requested project scope', async () => {
      // Defensive path: a row that slipped past the DB filter must not land in a
      // project bucket that was never queried.
      stub([PROJ_A], [interior({ id: 'ip-orphan', projectId: 'p-archived', contractType: 'FIXED', contractValue: 99 })]);

      const res = await service.getInteriorSummary({ projectId: 'p1' });

      expect(res.kpis.interiorCount).toBe(0);
      expect(res.kpis.committed).toBe(0);
      expect(row(res, 'p1').hasInterior).toBe(false);
    });

    it('only counts TI installments on live sales under live projects', async () => {
      stub([PROJ_A], [interior({ contractType: 'FIXED', contractValue: 10_000 })]);
      await service.getInteriorSummary();

      const where = mockPrisma.salePayment.findMany.mock.calls[0][0].where;
      expect(where.sale.deletedAt).toBeNull();
      expect(where.sale.project).toMatchObject({ deletedAt: null, status: { not: 'CANCELLED' } });
      // A void installment belongs to a dead sale and was never owed.
      expect(where.status).toEqual({ not: 'CANCELLED' });
    });
  });
});

describe('ReportsService — portfolio summary keeps TI isolated', () => {
  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('excludes interior actuals from construction actuals and reports them separately', async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Alpha',
        status: 'ACTIVE',
        phase: 'CONSTRUCTION',
        budgetLines: [{ baselineAmt: 500_000, revisedAmt: null }],
        actuals: [
          { amount: 300_000, interiorProjectId: null },
          { amount: 80_000, interiorProjectId: 'ip1' }, // TI — must not hit the budget variance
        ],
        commitments: [],
        sales: [],
        buildings: [],
      },
    ]);

    const res = await service.getPortfolioSummary();

    expect(res.kpis.totalActuals).toBe(300_000);
    expect(res.kpis.totalInteriorActuals).toBe(80_000);
    expect(res.projectComparison[0].actuals).toBe(300_000);
    expect(res.projectComparison[0].interiorActuals).toBe(80_000);
    // Variance is against a budget that never contained TI, so TI must be out of it.
    expect(res.projectComparison[0].variance).toBe(200_000);
    // ROI still spends every dollar: (0 revenue - 380,000) / 380,000.
    expect(res.kpis.overallROI).toBe(-100);
  });
});
