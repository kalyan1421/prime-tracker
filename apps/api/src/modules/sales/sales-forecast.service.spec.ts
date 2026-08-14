import { SalesForecastService } from './sales-forecast.service';

const mockPrisma: any = {
  project: { findUnique: jest.fn() },
  orgSettings: { findUnique: jest.fn() },
  sale: { findMany: jest.fn() },
};

function makeService() {
  return new SalesForecastService(mockPrisma as any);
}

/** One deal in each in-flight stage, all £1,000, so weighted === probability × 1000. */
const SALES = [
  { status: 'PROSPECT', salePrice: 1000, closingDate: null },
  { status: 'LOI_SIGNED', salePrice: 1000, closingDate: null },
  { status: 'UNDER_CONTRACT', salePrice: 1000, closingDate: null },
];

/** Defaults: .10 + .35 + .75 = 1.20 × 1000 */
const DEFAULT_WEIGHTED = 1200;

function probOf(res: { byStage: Array<{ stage: string; probability: number }> }, stage: string) {
  return res.byStage.find((s) => s.stage === stage)!.probability;
}

describe('SalesForecastService', () => {
  let service: SalesForecastService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    // Silence the intentional warn logging in the rejection paths.
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    mockPrisma.sale.findMany.mockResolvedValue(SALES);
    mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'org1' });
    mockPrisma.orgSettings.findUnique.mockResolvedValue(null);
  });

  describe('defaults', () => {
    it('uses the defaults when the project has no org', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ orgId: null });
      const res = await service.forProject('p1');
      expect(mockPrisma.orgSettings.findUnique).not.toHaveBeenCalled();
      expect(res.weightedForecast).toBe(DEFAULT_WEIGHTED);
    });

    it('uses the defaults when the project row is missing entirely', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);
      const res = await service.forProject('p1');
      expect(res.weightedForecast).toBe(DEFAULT_WEIGHTED);
    });

    it('uses the defaults when the org has no settings row', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue(null);
      const res = await service.forProject('p1');
      expect(res.weightedForecast).toBe(DEFAULT_WEIGHTED);
    });

    it('uses the defaults when the settings column is null', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({ saleStageProbabilities: null });
      const res = await service.forProject('p1');
      expect(res.weightedForecast).toBe(DEFAULT_WEIGHTED);
    });

    it('resolves project -> org -> settings', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'org-abc' });
      mockPrisma.orgSettings.findUnique.mockResolvedValue({ saleStageProbabilities: {} });
      await service.forProject('p1');
      expect(mockPrisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: 'p1' },
        select: { orgId: true },
      });
      expect(mockPrisma.orgSettings.findUnique).toHaveBeenCalledWith({
        where: { orgId: 'org-abc' },
        select: { saleStageProbabilities: true },
      });
    });
  });

  describe('stored org settings', () => {
    it('applies a full override', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({
        saleStageProbabilities: {
          PROSPECT: 0.2,
          LOI_SIGNED: 0.4,
          UNDER_CONTRACT: 0.8,
          CLOSED: 1.0,
          CANCELLED: 0.0,
        },
      });
      const res = await service.forProject('p1');
      expect(res.weightedForecast).toBeCloseTo(1400, 6); // (.2 + .4 + .8) × 1000
      expect(probOf(res, 'PROSPECT')).toBe(0.2);
      expect(probOf(res, 'UNDER_CONTRACT')).toBe(0.8);
    });

    it('merges a PARTIAL override over the defaults instead of replacing them', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({
        saleStageProbabilities: { UNDER_CONTRACT: 0.9 },
      });
      const res = await service.forProject('p1');
      expect(probOf(res, 'UNDER_CONTRACT')).toBe(0.9);
      expect(probOf(res, 'PROSPECT')).toBe(0.10); // untouched default
      expect(probOf(res, 'LOI_SIGNED')).toBe(0.35); // untouched default
      expect(res.weightedForecast).toBeCloseTo(1350, 6); // (.10 + .35 + .9) × 1000
    });

    it('accepts the boundary values 0 and 1', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({
        saleStageProbabilities: { PROSPECT: 0, UNDER_CONTRACT: 1 },
      });
      const res = await service.forProject('p1');
      expect(probOf(res, 'PROSPECT')).toBe(0);
      expect(probOf(res, 'UNDER_CONTRACT')).toBe(1);
    });
  });

  describe('sanitisation of untrusted JSON', () => {
    it('rejects a non-numeric value back to the default rather than zeroing the stage', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({
        saleStageProbabilities: { UNDER_CONTRACT: 'high' },
      });
      const res = await service.forProject('p1');
      expect(probOf(res, 'UNDER_CONTRACT')).toBe(0.75);
      expect(res.weightedForecast).toBe(DEFAULT_WEIGHTED);
    });

    it('rejects out-of-range values (>1 and <0) back to the defaults', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({
        saleStageProbabilities: { UNDER_CONTRACT: 1.5, PROSPECT: -0.2 },
      });
      const res = await service.forProject('p1');
      expect(probOf(res, 'UNDER_CONTRACT')).toBe(0.75);
      expect(probOf(res, 'PROSPECT')).toBe(0.10);
      expect(res.weightedForecast).toBe(DEFAULT_WEIGHTED);
    });

    it('rejects NaN / Infinity', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({
        saleStageProbabilities: { PROSPECT: NaN, LOI_SIGNED: Infinity },
      });
      const res = await service.forProject('p1');
      expect(probOf(res, 'PROSPECT')).toBe(0.10);
      expect(probOf(res, 'LOI_SIGNED')).toBe(0.35);
    });

    it('ignores keys that are not real sale stages, keeping the valid ones', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({
        saleStageProbabilities: { NOT_A_STAGE: 0.5, UNDER_CONTRACT: 0.9 },
      });
      const res = await service.forProject('p1');
      expect(res.byStage.some((s) => s.stage === 'NOT_A_STAGE')).toBe(false);
      expect(probOf(res, 'UNDER_CONTRACT')).toBe(0.9);
    });

    it('logs a warning when a value is rejected, so a bad setting is discoverable', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({
        saleStageProbabilities: { UNDER_CONTRACT: 'high' },
      });
      await service.forProject('p1');
      expect((service as any).logger.warn).toHaveBeenCalled();
    });

    it('does not throw when the stored value is a scalar or an array', async () => {
      for (const bad of ['nonsense', 42, [0.1, 0.2], true]) {
        mockPrisma.orgSettings.findUnique.mockResolvedValue({ saleStageProbabilities: bad });
        const res = await service.forProject('p1');
        expect(res.weightedForecast).toBe(DEFAULT_WEIGHTED);
      }
    });

    it('does not throw when the settings lookup itself blows up', async () => {
      mockPrisma.orgSettings.findUnique.mockRejectedValue(new Error('db exploded'));
      const res = await service.forProject('p1');
      expect(res.weightedForecast).toBe(DEFAULT_WEIGHTED);
      expect((service as any).logger.warn).toHaveBeenCalled();
    });
  });

  describe('explicit overrides argument', () => {
    it('wins over the stored org settings', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({
        saleStageProbabilities: { UNDER_CONTRACT: 0.9 },
      });
      const res = await service.forProject('p1', { UNDER_CONTRACT: 0.5 });
      expect(probOf(res, 'UNDER_CONTRACT')).toBe(0.5);
    });

    it('short-circuits the settings lookup entirely', async () => {
      await service.forProject('p1', { UNDER_CONTRACT: 0.5 });
      expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.orgSettings.findUnique).not.toHaveBeenCalled();
    });

    it('still merges over the defaults for stages it does not mention', async () => {
      const res = await service.forProject('p1', { UNDER_CONTRACT: 0.5 });
      expect(probOf(res, 'PROSPECT')).toBe(0.10);
      expect(res.weightedForecast).toBeCloseTo(950, 6); // (.10 + .35 + .5) × 1000
    });
  });

  describe('reported probability matches the maths', () => {
    it('byStage[].probability equals weighted / value for every stage', async () => {
      mockPrisma.orgSettings.findUnique.mockResolvedValue({
        saleStageProbabilities: { UNDER_CONTRACT: 0.9, PROSPECT: 0.25 },
      });
      const res = await service.forProject('p1');
      for (const s of res.byStage) {
        expect(s.weighted).toBeCloseTo(s.value * s.probability, 6);
      }
      const inFlight = res.byStage.filter((s) => s.stage !== 'CLOSED' && s.stage !== 'CANCELLED');
      expect(res.weightedForecast).toBeCloseTo(
        inFlight.reduce((sum, s) => sum + s.value * s.probability, 0),
        6,
      );
    });
  });

  describe('aggregation basics', () => {
    it('excludes CLOSED and CANCELLED from the pipeline and reports closedYtd separately', async () => {
      const thisYear = new Date(new Date().getFullYear(), 5, 1);
      mockPrisma.sale.findMany.mockResolvedValue([
        ...SALES,
        { status: 'CLOSED', salePrice: 5000, closingDate: thisYear },
        { status: 'CANCELLED', salePrice: 7000, closingDate: null },
      ]);
      const res = await service.forProject('p1');
      expect(res.totalPipelineValue).toBe(3000);
      expect(res.weightedForecast).toBe(DEFAULT_WEIGHTED);
      expect(res.closedYtd).toBe(5000);
    });
  });
});
