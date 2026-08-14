import { DashboardService } from './dashboard.service';

const mockPrisma: any = {
  project: { findMany: jest.fn() },
  lead: { findMany: jest.fn().mockResolvedValue([]) },
  lease: { aggregate: jest.fn().mockResolvedValue({ _sum: { monthlyRent: 0 } }) },
};

// wrap() is a straight pass-through here: these suites assert the computed shape, not
// the caching, and a real cache would serve project A's numbers to project B's test.
const mockCache = {
  wrap: jest.fn((_key: string, _ttl: number, fn: () => any) => fn()),
  invalidateTag: jest.fn(),
};

const mockAccess = {
  isScoped: (role: string) => ['PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING'].includes(role),
  accessibleProjectIds: jest.fn().mockResolvedValue([]),
};

// Pass-through EncryptionService double — mocked Prisma rows already carry plaintext.
const mockEncryption = {
  decryptLoan: (l: any) => l,
  decryptLoans: (l: any[]) => l ?? [],
};

function makeService() {
  return new DashboardService(
    mockPrisma as any,
    mockCache as any,
    mockAccess as any,
    mockEncryption as any,
  );
}

/**
 * A project whose construction spend is comfortably inside its budget but whose
 * fit-out invoices, if counted, blow straight through it: 400k construction against a
 * 1M budget (40%), plus 700k of TI → 1.1M (110%) unfiltered.
 */
const PROJECT_WITH_FITOUT = {
  id: 'p1',
  name: 'Shops at Panther Creek',
  status: 'ACTIVE',
  phase: 'CONSTRUCTION',
  budgetLines: [{ category: 'HARD_COSTS', baselineAmt: 1_000_000, revisedAmt: null }],
  actuals: [
    { amount: 400_000, category: 'HARD_COSTS', interiorProjectId: null },
    { amount: 700_000, category: 'HARD_COSTS', interiorProjectId: 'ip-1' },
  ],
  commitments: [],
  sales: [],
  loans: [],
  milestones: [],
  buildings: [],
};

describe('DashboardService — interior/TI spend stays out of construction spend', () => {
  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCache.wrap.mockImplementation((_k: string, _t: number, fn: () => any) => fn());
    service = makeService();
  });

  describe('founder dashboard', () => {
    beforeEach(() => {
      mockPrisma.project.findMany.mockResolvedValue([PROJECT_WITH_FITOUT]);
    });

    it('counts construction actuals only and reports TI as its own figure', async () => {
      const d: any = await service.getFounderDashboard();

      expect(d.totalActuals).toBe(400_000);
      expect(d.totalInteriorActuals).toBe(700_000);
      // Variance is against a budget with no TI line in it.
      expect(d.budgetVariance).toBe(600_000);
    });

    it('raises no over-budget alert for a project that is only "over" because of fit-out', async () => {
      const d: any = await service.getFounderDashboard();

      // Unfiltered this was 110% spent → a CRITICAL "Over budget" alert on a project
      // that has spent 40% of its construction budget.
      expect(d.alerts.filter((a: any) => a.id.startsWith('budget-'))).toHaveLength(0);
    });

    it('still alerts when construction spend alone breaches the budget', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        {
          ...PROJECT_WITH_FITOUT,
          actuals: [
            { amount: 1_200_000, category: 'HARD_COSTS', interiorProjectId: null },
            { amount: 700_000, category: 'HARD_COSTS', interiorProjectId: 'ip-1' },
          ],
        },
      ]);

      const d: any = await service.getFounderDashboard();

      expect(d.alerts.some((a: any) => a.id === 'budget-over-p1' && a.severity === 'CRITICAL')).toBe(true);
      // The percentage in the message is construction-only: 120%, not 190%.
      expect(d.alerts.find((a: any) => a.id === 'budget-over-p1').message).toContain('120%');
    });
  });

  describe('finance dashboard', () => {
    beforeEach(() => {
      mockPrisma.project.findMany.mockResolvedValue([PROJECT_WITH_FITOUT]);
    });

    it('splits construction and interior spend at both portfolio and project level', async () => {
      const d: any = await service.getFinanceDashboard();

      expect(d.totalActuals).toBe(400_000);
      expect(d.totalInteriorActuals).toBe(700_000);
      expect(d.budgetVariance).toBe(600_000);
      expect(d.budgetUtilPct).toBe(40);

      const [p] = d.projectSummaries;
      expect(p.actuals).toBe(400_000);
      expect(p.interiorActuals).toBe(700_000);
      expect(p.variance).toBe(600_000);
      // The per-project progress bar: 0.4, not 1.1.
      expect(p.budgetSpentPct).toBeCloseTo(0.4);
    });

    it('keeps TI out of the budget-vs-actuals category chart', async () => {
      const d: any = await service.getFinanceDashboard();

      const row = d.budgetCategoryChart.find((c: any) => c.category === 'HARD COSTS');
      // The bar sits next to a BudgetLine bar; TI has no BudgetLine category behind it.
      expect(row).toMatchObject({ budget: 1_000_000, actuals: 400_000 });
    });
  });

  describe('construction dashboard', () => {
    it('filters TI at the query and exposes no interior figure', async () => {
      mockPrisma.project.findMany.mockResolvedValue([PROJECT_WITH_FITOUT]);

      const d: any = await service.getConstructionDashboard('FOUNDER');

      // Every financial figure on this surface is shell-specific (BudgetLines, draws),
      // so TI is dropped rather than reported alongside.
      const call = mockPrisma.project.findMany.mock.calls[0][0];
      expect(call.include.actuals).toEqual({ where: { interiorProjectId: null } });
      expect(d).not.toHaveProperty('totalInteriorActuals');
      expect(d.projectSummaries[0]).not.toHaveProperty('interiorActuals');
    });

    it('hides financials entirely from the CONSTRUCTION role', async () => {
      mockPrisma.project.findMany.mockResolvedValue([PROJECT_WITH_FITOUT]);

      const d: any = await service.getConstructionDashboard('CONSTRUCTION', 'u-1');

      expect(d).not.toHaveProperty('totalActuals');
      expect(d.projectSummaries[0]).not.toHaveProperty('budgetSpentPct');
    });
  });
});
