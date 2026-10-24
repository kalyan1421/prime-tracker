import { CashFlowService } from './cashflow.service';
import { ProjectAccessService } from '../../common/access/project-access.service';

const mockEngine = { buildTimeline: jest.fn().mockResolvedValue({ monthly: [], summary: {} }) };
const mockAccess = {
  isScoped: (role: string) => ['PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING'].includes(role),
  accessibleProjectIds: jest.fn().mockResolvedValue(['pm-proj-1']),
};

function makeService() {
  return new CashFlowService({} as any, mockEngine as any, mockAccess as any);
}

describe('CashFlowService — forecast delegation + portfolio scoping', () => {
  let service: CashFlowService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('per-project forecast delegates to the engine with the projectId + horizon', async () => {
    await service.getForecast('p1', 6);
    expect(mockEngine.buildTimeline).toHaveBeenCalledWith({ projectId: 'p1', months: 6 });
  });

  it('portfolio forecast for a non-scoped role spans all projects (projectIds undefined)', async () => {
    await service.getPortfolioForecast({ userId: 'u', role: 'FINANCE' });
    expect(mockEngine.buildTimeline).toHaveBeenCalledWith({ projectIds: undefined, months: undefined });
  });

  it('portfolio forecast for a scoped role is restricted to member projects', async () => {
    await service.getPortfolioForecast({ userId: 'pm', role: 'PROJECT_MANAGER' }, 12);
    expect(mockAccess.accessibleProjectIds).toHaveBeenCalledWith('pm');
    expect(mockEngine.buildTimeline).toHaveBeenCalledWith({ projectIds: ['pm-proj-1'], months: 12 });
  });

  it('obligations re-buckets engine outflows by quarter with outstanding totals + immediate payables', async () => {
    const cat = (over: Record<string, number> = {}) => ({
      loanPayments: 0, subcontractorAP: 0, interiorTI: 0, commissions: 0, misc: 0, ...over,
    });
    mockEngine.buildTimeline.mockResolvedValueOnce({
      monthly: [
        { month: '2026-06', outflowsByCategory: cat({ loanPayments: 2000, subcontractorAP: 65000, interiorTI: 12000, commissions: 8000 }) },
        { month: '2026-07', outflowsByCategory: cat({ loanPayments: 2000 }) },
        { month: '2026-08', outflowsByCategory: cat({ loanPayments: 2000 }) },
        { month: '2026-09', outflowsByCategory: cat({ loanPayments: 2000, misc: 500 }) },
      ],
      summary: {},
    });

    const result = await service.getObligations({ userId: 'u', role: 'FINANCE' }, { projectId: 'p1', granularity: 'quarter' });

    // Calendar quarters: Jun = Q2; Jul+Aug+Sep = Q3
    const q2 = result.periods.find((p: any) => p.key === '2026-Q2')!;
    const q3 = result.periods.find((p: any) => p.key === '2026-Q3')!;
    expect(q2.byCategory.loanPayments).toBe(2000); // Jun only
    expect(q2.byCategory.subcontractorAP).toBe(65000);
    expect(q3.byCategory.loanPayments).toBe(6000); // Jul+Aug+Sep × 2000
    expect(q3.byCategory.misc).toBe(500);
    expect(result.outstandingByCategory.loanPayments).toBe(8000); // 4 months
    expect(result.immediatePayables).toBe(87000); // 65000 + 12000 + 8000 + 2000 (first month)
  });
});

// ANY scoped role scopes the user (isMultiRoleProjectScoped). Both of these read the
// primary role alone, so [FINANCE, PROJECT_MANAGER] saw every project's cash position.
describe('CashFlowService — multi-role scoping (real ProjectAccessService)', () => {
  const access = new ProjectAccessService({
    projectMember: { findMany: jest.fn().mockResolvedValue([{ projectId: 'p1' }]) },
  } as any);
  const service = new CashFlowService({} as any, mockEngine as any, access);
  const MIXED = { userId: 'm', role: 'FINANCE', roles: ['FINANCE', 'PROJECT_MANAGER'] };

  beforeEach(() => mockEngine.buildTimeline.mockClear());

  it('restricts the portfolio forecast to member projects', async () => {
    await service.getPortfolioForecast(MIXED, 12);
    expect(mockEngine.buildTimeline).toHaveBeenCalledWith({ projectIds: ['p1'], months: 12 });
  });

  it('restricts the obligations view to member projects', async () => {
    mockEngine.buildTimeline.mockResolvedValueOnce({ monthly: [], summary: {} });
    await service.getObligations(MIXED, {});
    expect(mockEngine.buildTimeline.mock.calls[0][0].projectIds).toEqual(['p1']);
  });
});
