import { ProjectAccessService } from './project-access.service';
import { DocumentsController } from '../../modules/documents/documents.controller';
import { SalesController } from '../../modules/sales/sales.controller';
import { LeasesController } from '../../modules/leases/leases.controller';
import { ContractsController } from '../../modules/contracts/contracts.controller';
import { LoansController } from '../../modules/loans/loans.controller';
import { BudgetRevisionController } from '../../modules/budgets/budget-revision.controller';
import { MilestonesController } from '../../modules/milestones/milestones.controller';
import { CommentsController } from '../../modules/comments/comments.controller';
import { InteriorController } from '../../modules/interior/interior.controller';
import { ActualsController } from '../../modules/actuals/actuals.controller';
import { CommitmentsController } from '../../modules/commitments/commitments.controller';
import { CashFlowController } from '../../modules/cashflow/cashflow.controller';
import { KpiController } from '../../modules/kpi/kpi.controller';
import { AuditController } from '../../modules/audit/audit.controller';
import { SiteVisitsController } from '../../modules/site-visits/site-visits.controller';
import { ExceptionsController } from '../../modules/exceptions/exceptions.controller';
import { HistoricalDeletionsController } from '../../modules/historical-deletions/historical-deletions.controller';

/**
 * Every list/aggregate endpoint whose projectId is optional, or that is cross-project by
 * design, must narrow a scoped field role to its member projects.
 *
 * ProjectAccessGuard cannot do it: a request that names no project resolves to no
 * project, and the guard passes it. These endpoints used to hand the absent projectId on
 * to Prisma as `projectId: undefined` — no filter — so a PM, Construction, Sales or
 * Marketing user got every project's sales, leases, draws, documents and activity
 * (audit, 24 Oct 2026). Driven through the controllers with a REAL ProjectAccessService,
 * so the test fails if a route stops calling it, not merely if the helper changes.
 */

const prisma: any = { projectMember: { findMany: jest.fn() } };
const access = new ProjectAccessService(prisma);

const PM = { sub: 'pm-1', role: 'PROJECT_MANAGER', roles: ['PROJECT_MANAGER'] };
const FINANCE = { sub: 'fin-1', role: 'FINANCE', roles: ['FINANCE'] };
// Primary role global, a scoped role alongside — scoped, by the shared rule.
const FINANCE_AND_SALES = { sub: 'mix-1', role: 'FINANCE', roles: ['FINANCE', 'SALES'] };
const MEMBER_IDS = ['p1', 'p2'];
const MEMBER = { in: MEMBER_IDS };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.projectMember.findMany.mockResolvedValue(MEMBER_IDS.map((projectId) => ({ projectId })));
});

const fn = (value: unknown = []) => jest.fn().mockResolvedValue(value);

/**
 * One row per endpoint taking an optional ?projectId=. `call` invokes the handler as Nest
 * would; `received` reads back the project condition the service was handed.
 */
type User = typeof PM;
const optionalProjectIdRoutes: Array<{
  route: string;
  call: (user: User, projectId?: string) => Promise<unknown>;
  received: () => unknown;
}> = (() => {
  const docs = { findByProject: fn() };
  const sales = { findByProject: fn(), getPipeline: fn(), findDeal: fn() };
  const forecast = { forProject: fn({}) };
  const leases = { findByProject: fn(), getRentRoll: fn(), resolveDealGroup: fn([]) };
  const contracts = { findByProject: fn(), getProjectSummary: fn({}) };
  const loans = { getMonthlyPayments: fn({}), findByProject: fn(), findDrawsByProject: fn(), findProjectDrawSchedules: fn() };
  const revisions = { listForProject: fn() };
  const milestones = { findByProject: fn() };
  const deps = { listProposals: fn() };
  const interior = { findAll: fn() };
  const actuals = { findByProject: fn() };
  const commitments = { findByProject: fn() };
  const cashflow = { findByProject: fn() };
  const kpi = { getLatest: fn(null), getHistory: fn() };

  const d = new DocumentsController(docs as any, {} as any, {} as any, access);
  const s = new SalesController(sales as any, forecast as any, {} as any, {} as any, {} as any, access);
  const l = new LeasesController(leases as any, {} as any, {} as any, {} as any, {} as any, access);
  const c = new ContractsController(contracts as any, access);
  const lo = new LoansController(loans as any, {} as any, access);
  const br = new BudgetRevisionController(revisions as any, access);
  const m = new MilestonesController(milestones as any, deps as any, {} as any, access);
  const i = new InteriorController(interior as any, {} as any, access);
  const a = new ActualsController(actuals as any, access);
  const co = new CommitmentsController(commitments as any, access);
  const cf = new CashFlowController(cashflow as any, access);
  const k = new KpiController(kpi as any, access);

  const arg = (mock: jest.Mock, i = 0) => () => mock.mock.calls[0][i];
  return [
    { route: 'GET /documents', call: (u, p) => d.find(p as string, undefined as any, undefined, undefined, undefined, undefined, u), received: arg(docs.findByProject) },
    { route: 'GET /sales', call: (u, p) => s.findByProject(p as string, u), received: arg(sales.findByProject) },
    { route: 'GET /sales/pipeline', call: (u, p) => s.getPipeline(p as string, u), received: arg(sales.getPipeline) },
    { route: 'GET /sales/forecast', call: (u, p) => s.getForecast(p as string, u), received: arg(forecast.forProject) },
    { route: 'GET /sales/deal', call: (u, p) => s.findDeal(p as string, 'REF-1', u), received: arg(sales.findDeal) },
    { route: 'GET /leases', call: (u, p) => l.findByProject(p as string, u), received: arg(leases.findByProject) },
    { route: 'GET /leases/rent-roll', call: (u, p) => l.getRentRoll(p as string, u), received: arg(leases.getRentRoll) },
    { route: 'GET /leases/deal', call: (u, p) => l.previewDeal(p as string, 'REF-1', undefined, u), received: arg(leases.resolveDealGroup) },
    { route: 'GET /contracts', call: (u, p) => c.findByProject(p as string, u), received: arg(contracts.findByProject) },
    { route: 'GET /contracts/summary', call: (u, p) => c.getSummary(p as string, u), received: arg(contracts.getProjectSummary) },
    { route: 'GET /loans', call: (u, p) => lo.findAll(u, p), received: arg(loans.findByProject) },
    { route: 'GET /loans/monthly-payments', call: (u, p) => lo.getMonthlyPayments(p as string, u), received: arg(loans.getMonthlyPayments) },
    { route: 'GET /loans/draws', call: (u, p) => lo.findDrawsByProject(p as string, { user: { ...u, permissions: [] } }), received: arg(loans.findDrawsByProject) },
    { route: 'GET /loans/draw-schedules', call: (u, p) => lo.findProjectDrawSchedules(p as string, u), received: arg(loans.findProjectDrawSchedules) },
    { route: 'GET /budgets/revisions', call: (u, p) => br.listForProject(p as string, u), received: arg(revisions.listForProject) },
    { route: 'GET /milestones', call: (u, p) => m.findByProject(p as string, u), received: arg(milestones.findByProject) },
    { route: 'GET /milestones/slip-proposals', call: (u, p) => m.listSlipProposals(u, p), received: () => deps.listProposals.mock.calls[0][0].projectId },
    { route: 'GET /interior', call: (u, p) => i.findAll(undefined, undefined, p, undefined, [], u), received: () => interior.findAll.mock.calls[0][0].projectId },
    { route: 'GET /actuals', call: (u, p) => a.findByProject(p as string, u), received: arg(actuals.findByProject) },
    { route: 'GET /commitments', call: (u, p) => co.findByProject(p as string, u), received: arg(commitments.findByProject) },
    { route: 'GET /cashflow', call: (u, p) => cf.findByProject(p as string, u), received: arg(cashflow.findByProject) },
    { route: 'GET /kpi/latest', call: (u, p) => k.getLatest(p as string, u), received: arg(kpi.getLatest) },
    { route: 'GET /kpi/history', call: (u, p) => k.getHistory(p as string, u), received: arg(kpi.getHistory) },
  ];
})();

describe.each(optionalProjectIdRoutes)('$route', ({ call, received }) => {
  it('narrows a scoped role that names no project to its member projects', async () => {
    await call(PM);
    expect(received()).toEqual(MEMBER);
  });

  it('narrows a multi-role user who holds any scoped role', async () => {
    await call(FINANCE_AND_SALES);
    expect(received()).toEqual(MEMBER);
  });

  it('leaves an unscoped role on the whole portfolio, as before', async () => {
    await call(FINANCE);
    expect(received()).toBeUndefined();
  });

  it('passes an explicit projectId through (membership is the guard\'s 404)', async () => {
    await call(PM, 'p9');
    expect(received()).toBe('p9');
  });
});

describe('cross-project endpoints', () => {
  it('GET /sales/receivables — scoped to member projects', async () => {
    const salePayments = { receivables: fn() };
    const s = new SalesController({} as any, {} as any, salePayments as any, {} as any, {} as any, access);
    await s.receivables(PM);
    expect(salePayments.receivables).toHaveBeenCalledWith(4, MEMBER);
    await s.receivables(FINANCE, '8');
    expect(salePayments.receivables).toHaveBeenLastCalledWith(8, undefined);
  });

  it('GET /comments/recent — scoped to member projects', async () => {
    const service = { findRecent: fn() };
    const c = new CommentsController(service as any, access);
    await c.findRecent(PM);
    expect(service.findRecent).toHaveBeenCalledWith(20, MEMBER);
    await c.findRecent(FINANCE, '5');
    expect(service.findRecent).toHaveBeenLastCalledWith(5, undefined);
  });

  it('GET /interior/portfolio — scoped to member projects', async () => {
    const service = { portfolio: fn() };
    const i = new InteriorController(service as any, {} as any, access);
    await i.portfolio(PM, []);
    expect(service.portfolio).toHaveBeenCalledWith([], MEMBER);
  });

  it('GET /cashflow/forecast with no projectId runs the (scoped) portfolio forecast', async () => {
    const service = { getForecast: fn(), getPortfolioForecast: fn() };
    const cf = new CashFlowController(service as any, access);
    await cf.getForecast(undefined as any, PM, '6');
    expect(service.getForecast).not.toHaveBeenCalled();
    expect(service.getPortfolioForecast).toHaveBeenCalledWith({ userId: 'pm-1', role: 'PROJECT_MANAGER', roles: ['PROJECT_MANAGER'] }, 6);
    await cf.getForecast('p1', PM);
    expect(service.getForecast).toHaveBeenCalledWith('p1', undefined);
  });

  it('GET /audit/activity and /activity/actors — hand the member projects to the feed', async () => {
    const audit = { activityFeed: fn({}), activityActors: fn() };
    const a = new AuditController(audit as any, access);
    await a.activity(PM, ['updateBoard:view'], 1, 30);
    expect(audit.activityFeed.mock.calls[0][1]).toEqual({ permissions: ['updateBoard:view'], projectIds: MEMBER_IDS });
    await a.activityActors(PM, ['updateBoard:view']);
    expect(audit.activityActors).toHaveBeenCalledWith({ permissions: ['updateBoard:view'], projectIds: MEMBER_IDS });
    await a.activity(FINANCE, ['updateBoard:view'], 1, 30);
    expect(audit.activityFeed.mock.calls[1][1].projectIds).toBeUndefined();
  });

  it('GET /site-visits — scoped, keeping the viewer\'s own visits', async () => {
    const service = { findAll: fn(), attention: fn({}) };
    const sv = new SiteVisitsController(service as any, {} as any, access);
    await sv.findAll(PM, 'CONFIRMED');
    expect(service.findAll.mock.calls[0][0]).toMatchObject({
      status: 'CONFIRMED', scope: { projectIds: MEMBER_IDS, userId: 'pm-1' },
    });
    await sv.findAll(FINANCE);
    expect(service.findAll.mock.calls[1][0].scope).toBeUndefined();
  });

  it('GET /exceptions with no projectId — a scoped role gets its member projects, not the portfolio', async () => {
    const exceptions = { forProject: fn(), forProjects: fn(), forPortfolio: fn() };
    const e = new ExceptionsController(exceptions as any, access);
    await e.list(['project:view'], PM);
    expect(exceptions.forProjects).toHaveBeenCalledWith(MEMBER_IDS, ['project:view']);
    expect(exceptions.forPortfolio).not.toHaveBeenCalled();
    await e.list(['project:view'], FINANCE);
    expect(exceptions.forPortfolio).toHaveBeenCalledTimes(1);
    await e.list(['project:view'], PM, 'p1');
    expect(exceptions.forProject).toHaveBeenCalledWith('p1', ['project:view']);
  });

  it('GET /historical-deletions — a scoped role sees only its member projects\' requests', async () => {
    const deletions = { list: fn() };
    const h = new HistoricalDeletionsController(deletions as any, {} as any, {} as any, access);
    await h.list({ ...PM, role: 'SALES', roles: ['SALES'] });
    expect(deletions.list).toHaveBeenCalledWith('PENDING', MEMBER_IDS);
    await h.list(FINANCE, 'APPROVED');
    expect(deletions.list).toHaveBeenLastCalledWith('APPROVED', undefined);
  });
});
