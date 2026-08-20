import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { ProjectAccessService } from '../../common/access/project-access.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Prisma } from '@prisma/client';

// Roles on the construction dashboard that may see budget/spend/loan figures.
// Construction is fully blind to financials (no budget:view); PM + leadership keep them.
const CONSTRUCTION_FINANCIAL_ROLES = ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER'];

// 60 seconds gives users a short staleness window without coupling every
// CRUD service to the dashboard cache. Event handlers (DrawEventHandlers)
// invalidate explicitly on the high-impact writes (drawRequest.funded etc.).
// For everything else (project edits, lease changes), a 60s wait is acceptable
// and avoids the architectural cost of wiring invalidate() into 6 services.
const DASHBOARD_TTL = 60;
const DASHBOARD_TAG = 'dashboard';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private access: ProjectAccessService,
    private encryption: EncryptionService,
  ) {}

  /**
   * For a scoped viewer, the set of project ids they may see; otherwise undefined
   * (no restriction). Returned as a Prisma id-filter fragment for findMany where-clauses.
   */
  private async memberScope(role: string, userId?: string): Promise<Prisma.ProjectWhereInput> {
    if (!userId || !this.access.isScoped(role)) return {};
    const ids = await this.access.accessibleProjectIds(userId);
    return { id: { in: ids } };
  }

  /**
   * Call from any write path that affects dashboard aggregates
   * (project/unit/budget/actual/loan changes). Invalidates all 4 dashboards atomically.
   */
  invalidate() {
    this.cache.invalidateTag(DASHBOARD_TAG);
  }

  // ---- Founder Dashboard (cached) ----
  async getFounderDashboard() {
    return this.cache.wrap(
      'dashboard:founder',
      DASHBOARD_TTL,
      () => this.computeFounderDashboard(),
      { tags: [DASHBOARD_TAG] },
    );
  }

  private async computeFounderDashboard() {
    const projects = await this.prisma.project.findMany({
      where: { status: { not: 'CANCELLED' }, deletedAt: null },
      include: {
        budgetLines: { where: { deletedAt: null } },
        // Actuals are partitioned below, not filtered here. Interior sub-contractor
        // invoices are mirrored into Actual with an interiorProjectId, and the TI budget
        // is isolated with no BudgetLine behind it — folding them into `totalActuals`
        // inflated spend and showed every project with a fit-out as over budget against
        // a budget that never contained TI. Founders own the whole spend, though, so TI
        // is reported as its own `totalInteriorActuals` line rather than dropped.
        actuals: true,
        commitments: true,
        sales: { where: { deletedAt: null } },
        loans: { where: { deletedAt: null }, include: { drawRequests: true } },
        milestones: true,
        buildings: {
          where: { deletedAt: null },
          include: {
            units: {
              where: { deletedAt: null },
              include: { leases: { where: { status: 'ACTIVE', deletedAt: null } } },
            },
          },
        },
      },
    });

    let totalBudget = 0;
    let totalActuals = 0;
    let totalInteriorActuals = 0;
    let totalCommitted = 0;
    let totalMonthlyLeaseIncome = 0;
    let totalMonthlyMortgage = 0;
    let closedSalesRevenue = 0;
    let underContractValue = 0;
    let totalLoanPrincipal = 0;
    let totalLoanMonthlyPayment = 0;

    const unitsByStatus: Record<string, number> = {};
    const projectsByPhase: Record<string, number> = {};
    const allMilestones: any[] = [];
    const alerts: any[] = [];

    for (const p of projects) {
      const budget = p.budgetLines.reduce((s, b) => s + Number(b.revisedAmt ?? b.baselineAmt), 0);
      const actuals = p.actuals
        .filter((a) => a.interiorProjectId === null)
        .reduce((s, a) => s + Number(a.amount), 0);
      const interiorActuals = p.actuals
        .filter((a) => a.interiorProjectId !== null)
        .reduce((s, a) => s + Number(a.amount), 0);
      const committed = p.commitments.reduce((s, c) => s + Number(c.contractAmt), 0);

      totalBudget += budget;
      totalActuals += actuals;
      totalInteriorActuals += interiorActuals;
      totalCommitted += committed;

      projectsByPhase[p.phase] = (projectsByPhase[p.phase] || 0) + 1;

      // Sales
      for (const sale of p.sales) {
        if (sale.status === 'CLOSED') closedSalesRevenue += Number(sale.salePrice ?? 0);
        if (sale.status === 'UNDER_CONTRACT') underContractValue += Number(sale.salePrice ?? 0);
      }

      // Loans — principalAmt lives in the encrypted blob, so rehydrate before summing;
      // reading the column directly now yields null and silently totals 0.
      for (const loan of this.encryption.decryptLoans(p.loans)) {
        totalLoanPrincipal += Number(loan.principalAmt ?? 0);
        totalLoanMonthlyPayment += Number(loan.monthlyPayment ?? 0);
        totalMonthlyMortgage += Number(loan.monthlyPayment ?? 0);
      }

      // Units / leases
      const units = p.buildings.flatMap((b) => b.units);
      for (const unit of units) {
        unitsByStatus[unit.status] = (unitsByStatus[unit.status] || 0) + 1;
        for (const lease of unit.leases) {
          totalMonthlyLeaseIncome += Number(lease.monthlyRent ?? 0);
        }
      }

      // Milestones
      for (const m of p.milestones) {
        allMilestones.push({ ...m, projectName: p.name, projectId: p.id });
        if (m.status === 'OVERDUE') {
          alerts.push({
            id: `milestone-${m.id}`,
            severity: 'HIGH',
            message: `Overdue milestone: ${m.title} (${p.name})`,
            projectId: p.id,
            createdAt: m.dueDate,
          });
        }
      }

      // Budget alerts — construction spend against the construction budget. TI is
      // deliberately absent from both sides; an over-budget alert fired by fit-out
      // invoices points at a BudgetLine that does not exist.
      if (budget > 0) {
        const spentPct = actuals / budget;
        if (spentPct > 1.0) {
          alerts.push({
            id: `budget-over-${p.id}`,
            severity: 'CRITICAL',
            message: `Over budget: ${p.name} (${(spentPct * 100).toFixed(0)}% spent)`,
            projectId: p.id,
            createdAt: new Date().toISOString(),
          });
        } else if (spentPct > 0.9) {
          alerts.push({
            id: `budget-warn-${p.id}`,
            severity: 'MEDIUM',
            message: `Near budget limit: ${p.name} (${(spentPct * 100).toFixed(0)}% spent)`,
            projectId: p.id,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    const netMonthlyIncome = totalMonthlyLeaseIncome - totalMonthlyMortgage;
    const budgetVariance = totalBudget - totalActuals;

    // Unsold units by project → building (for Founder financial report)
    const unsoldByProjectBuilding = projects
      .map((p) => {
        const buildings = p.buildings
          .map((b) => {
            const availableUnits = b.units.filter((u) => u.status === 'AVAILABLE');
            const contractUnits = b.units.filter((u) => u.status === 'UNDER_CONTRACT');
            const availableValue = availableUnits.reduce((s, u) => s + Number(u.askingPrice ?? 0), 0);
            const contractValue = contractUnits.reduce((s, u) => s + Number(u.askingPrice ?? 0), 0);
            return {
              buildingId: b.id,
              buildingName: b.name,
              availableCount: availableUnits.length,
              availableValue,
              underContractCount: contractUnits.length,
              underContractValue: contractValue,
            };
          })
          .filter((b) => b.availableCount > 0 || b.underContractCount > 0);

        return {
          projectId: p.id,
          projectName: p.name,
          buildings,
          totalAvailableCount: buildings.reduce((s, b) => s + b.availableCount, 0),
          totalAvailableValue: buildings.reduce((s, b) => s + b.availableValue, 0),
          totalUnderContractValue: buildings.reduce((s, b) => s + b.underContractValue, 0),
        };
      })
      .filter((p) => p.buildings.length > 0);

    const projectedUnsoldValue = unsoldByProjectBuilding.reduce((s, p) => s + p.totalAvailableValue, 0);

    const recentMilestones = allMilestones
      .filter((m) => ['OVERDUE', 'IN_PROGRESS'].includes(m.status))
      .sort((a, b) => {
        if (a.status === 'OVERDUE' && b.status !== 'OVERDUE') return -1;
        if (b.status === 'OVERDUE' && a.status !== 'OVERDUE') return 1;
        return new Date(a.dueDate ?? 0).getTime() - new Date(b.dueDate ?? 0).getTime();
      })
      .slice(0, 8);

    return {
      totalProjects: projects.length,
      activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
      totalBudget,
      totalActuals,
      /** Isolated fit-out spend — a separate line, never part of totalActuals/budgetVariance. */
      totalInteriorActuals,
      totalCommitted,
      budgetVariance,
      totalMonthlyLeaseIncome,
      totalMonthlyMortgage,
      netMonthlyIncome,
      closedSalesRevenue,
      underContractValue,
      projectedUnsoldValue,
      loanBook: {
        totalPrincipal: totalLoanPrincipal,
        totalMonthlyPayment: totalLoanMonthlyPayment,
      },
      unitsByStatus,
      projectsByPhase,
      recentMilestones,
      unsoldByProjectBuilding,
      alerts: alerts.sort((a, b) => {
        const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
      }),
    };
  }

  // ---- Construction Dashboard ----
  async getConstructionDashboard(role: string, userId?: string) {
    // Scoped roles (PM/Construction) see only their projects, so the result is
    // per-user — bypass the role-keyed shared cache for them.
    if (this.access.isScoped(role)) {
      return this.computeConstructionDashboard(role, userId);
    }
    return this.cache.wrap(
      `dashboard:construction:${role}`,
      DASHBOARD_TTL,
      () => this.computeConstructionDashboard(role),
      { tags: [DASHBOARD_TAG] },
    );
  }

  private async computeConstructionDashboard(role: string, userId?: string) {
    const isPM = role === 'PROJECT_MANAGER';
    const canViewFinancials = CONSTRUCTION_FINANCIAL_ROLES.includes(role);

    const projects = await this.prisma.project.findMany({
      where: { status: 'ACTIVE', deletedAt: null, ...(await this.memberScope(role, userId)) },
      include: {
        budgetLines: { where: { deletedAt: null } },
        // Construction actuals ONLY — interior sub-contractor invoices are mirrored into
        // Actual with an interiorProjectId, and the TI budget is isolated with no
        // BudgetLine behind it. Including them inflated spend and showed every project
        // with a fit-out as over budget. Matches actuals/budgets/kpi, which already filter.
        //
        // Unlike the Founder and Finance dashboards, TI is filtered away here rather than
        // reported alongside: every financial figure on this surface is shell-specific
        // (budget consumption against BudgetLines, draw availability against the
        // construction loan) and fit-out has neither a BudgetLine nor a draw. Its primary
        // audience (CONSTRUCTION) sees no financials at all, and the interior module
        // carries its own commitment/invoiced/remaining view. A TI number here would be
        // one nobody on this screen can act on. Full picture: ReportsService.getInteriorSummary().
        actuals: { where: { interiorProjectId: null } },
        milestones: true,
        loans: { where: { deletedAt: null }, include: { drawRequests: true } },
      },
    });

    let totalBudget = 0;
    let totalActuals = 0;
    let totalLoanAvailable = 0;
    let overdueMilestoneCount = 0;
    let inProgressMilestoneCount = 0;
    let pendingDrawCount = 0;
    let approvedDrawCount = 0;
    let totalPendingDrawAmt = 0;

    const projectSummaries = projects.map((p) => {
      const budget = p.budgetLines.reduce((s, b) => s + Number(b.revisedAmt ?? b.baselineAmt), 0);
      const actuals = p.actuals.reduce((s, a) => s + Number(a.amount), 0);

      totalBudget += budget;
      totalActuals += actuals;

      const overdue = p.milestones.filter((m) => m.status === 'OVERDUE').length;
      const inProgress = p.milestones.filter((m) => m.status === 'IN_PROGRESS').length;
      const completed = p.milestones.filter((m) => m.status === 'COMPLETED').length;

      overdueMilestoneCount += overdue;
      inProgressMilestoneCount += inProgress;

      for (const loan of this.encryption.decryptLoans(p.loans)) {
        totalLoanAvailable += Number(loan.principalAmt ?? 0);
        for (const dr of loan.drawRequests) {
          if (dr.status === 'SUBMITTED' || dr.status === 'DRAFT') {
            pendingDrawCount++;
            totalPendingDrawAmt += Number(dr.amount ?? 0);
          } else if (dr.status === 'APPROVED') {
            approvedDrawCount++;
          }
        }
      }

      const budgetSpentPct = budget > 0 ? actuals / budget : 0;

      return {
        id: p.id,
        name: p.name,
        phase: p.phase,
        // Budget/spend hidden from roles without budget:view (Construction).
        ...(canViewFinancials ? { budgetSpentPct, rawBudget: { budget, actuals } } : {}),
        milestoneCounts: {
          overdue,
          inProgress,
          completed,
          total: p.milestones.length,
        },
      };
    });

    const budgetSpentPct = totalBudget > 0 ? totalActuals / totalBudget : 0;

    // Recent milestones (overdue first)
    const allMilestones: any[] = [];
    for (const p of projects) {
      for (const m of p.milestones) {
        if (['OVERDUE', 'IN_PROGRESS'].includes(m.status)) {
          allMilestones.push({ ...m, projectName: p.name, projectId: p.id });
        }
      }
    }
    const recentMilestones = allMilestones
      .sort((a, b) => {
        if (a.status === 'OVERDUE' && b.status !== 'OVERDUE') return -1;
        if (b.status === 'OVERDUE' && a.status !== 'OVERDUE') return 1;
        return new Date(a.dueDate ?? 0).getTime() - new Date(b.dueDate ?? 0).getTime();
      })
      .slice(0, 10);

    return {
      activeProjectCount: projects.length,
      overdueMilestoneCount,
      inProgressMilestoneCount,
      // Financial totals omitted for roles without budget:view (Construction).
      ...(canViewFinancials
        ? {
            totalBudget,
            totalActuals,
            totalLoanAvailable,
            budgetVariance: totalBudget - totalActuals,
            budgetSpentPct,
          }
        : {}),
      projectSummaries,
      recentMilestones,
      drawRequestStats: {
        pendingCount: pendingDrawCount,
        approvedCount: approvedDrawCount,
        totalPendingAmt: isPM ? totalPendingDrawAmt : null,
      },
    };
  }

  // ---- Sales Dashboard ----
  async getSalesDashboard(role?: string, userId?: string) {
    // SALES/MARKETING are scoped → per-user project set, bypass the shared cache.
    if (role && this.access.isScoped(role)) {
      return this.computeSalesDashboard(role, userId);
    }
    return this.cache.wrap(
      'dashboard:sales',
      DASHBOARD_TTL,
      () => this.computeSalesDashboard(),
      { tags: [DASHBOARD_TAG] },
    );
  }

  private async computeSalesDashboard(role?: string, userId?: string) {
    const projects = await this.prisma.project.findMany({
      where: { status: { not: 'CANCELLED' }, deletedAt: null, ...(await this.memberScope(role ?? '', userId)) },
      include: {
        sales: { where: { deletedAt: null } },
        buildings: {
          where: { deletedAt: null },
          include: {
            units: {
              where: { deletedAt: null },
              include: { leases: { where: { status: 'ACTIVE', deletedAt: null } } },
            },
          },
        },
      },
    });

    // Scoped the same way `projects` above is (via memberScope) — this used to have no
    // `where` at all, so a SALES/MARKETING user's dashboard showed lead activity from
    // every project system-wide instead of just their own. Mirrors LeadsService.findAll.
    const leadScopeIds = await this.access.listProjectScope(
      userId && role ? { userId, role } : undefined,
    );
    const leads = await this.prisma.lead.findMany({
      where: leadScopeIds ? { projectId: { in: leadScopeIds } } : undefined,
      include: { project: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    // Unit inventory
    let available = 0;
    let underContract = 0;
    let leased = 0;
    let sold = 0;
    let totalAskingValue = 0;
    let monthlyLeaseIncome = 0;
    let projectedUnsoldValue = 0;
    let underContractValue = 0;

    const pipelineByStatus: Record<string, number> = {};
    let pipelineTotalValue = 0;
    let closedSalesRevenue = 0;

    const unitsByProject: any[] = [];

    for (const p of projects) {
      const units = p.buildings.flatMap((b) => b.units);
      const projAvail = units.filter((u) => u.status === 'AVAILABLE').length;
      const projUnderContract = units.filter((u) => u.status === 'UNDER_CONTRACT').length;
      const projLeased = units.filter((u) => u.status === 'LEASED').length;
      const projSold = units.filter((u) => u.status === 'SOLD').length;

      available += projAvail;
      underContract += projUnderContract;
      leased += projLeased;
      sold += projSold;

      for (const unit of units) {
        const askingPrice = Number(unit.askingPrice ?? 0);
        totalAskingValue += askingPrice;
        if (unit.status === 'AVAILABLE') projectedUnsoldValue += askingPrice;
        if (unit.status === 'UNDER_CONTRACT') underContractValue += askingPrice;
        for (const lease of unit.leases) {
          monthlyLeaseIncome += Number(lease.monthlyRent ?? 0);
        }
      }

      for (const sale of p.sales) {
        if (sale.status !== 'CANCELLED') {
          pipelineByStatus[sale.status] = (pipelineByStatus[sale.status] || 0) + 1;
          pipelineTotalValue += Number(sale.salePrice ?? 0);
        }
        if (sale.status === 'CLOSED') {
          closedSalesRevenue += Number(sale.salePrice ?? 0);
        }
      }

      unitsByProject.push({
        projectId: p.id,
        projectName: p.name,
        available: projAvail,
        underContract: projUnderContract,
        leased: projLeased,
        sold: projSold,
      });
    }

    // Lead stats
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const byStatus: Record<string, number> = {};
    let thisMonthConverted = 0;

    for (const lead of leads) {
      byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
      if (lead.status === 'CONVERTED' && lead.updatedAt >= startOfMonth) {
        thisMonthConverted++;
      }
    }

    const activeLeads = leads.filter((l) => !['CONVERTED', 'LOST', 'DEAD'].includes(l.status)).length;

    // Recent sales + leads activity
    const allSales = projects.flatMap((p) =>
      p.sales.map((s) => ({
        id: s.id,
        type: 'sale',
        status: s.status,
        projectName: p.name,
        updatedAt: s.updatedAt,
        value: s.salePrice,
      })),
    );

    const allLeadsActivity = leads.slice(0, 10).map((l) => ({
      id: l.id,
      type: 'lead',
      status: l.status,
      projectName: l.project?.name,
      updatedAt: l.updatedAt,
      name: l.name,
    }));

    const recentSalesActivity = [...allSales, ...allLeadsActivity]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10);

    return {
      unitInventory: { available, underContract, leased, sold, totalAskingValue },
      pipelineByStatus,
      pipelineTotalValue,
      closedSalesRevenue,
      projectedUnsoldValue,
      underContractValue,
      leadStats: { total: leads.length, active: activeLeads, byStatus, thisMonthConverted },
      monthlyLeaseIncome,
      recentSalesActivity,
      unitsByProject,
    };
  }

  // ---- Finance Dashboard ----
  async getFinanceDashboard() {
    return this.cache.wrap(
      'dashboard:finance',
      DASHBOARD_TTL,
      () => this.computeFinanceDashboard(),
      { tags: [DASHBOARD_TAG] },
    );
  }

  private async computeFinanceDashboard() {
    const projects = await this.prisma.project.findMany({
      where: { status: { not: 'CANCELLED' }, deletedAt: null },
      include: {
        budgetLines: { where: { deletedAt: null } },
        // Partitioned below rather than filtered here. TI invoices are mirrored into
        // Actual with an interiorProjectId against a budget that has no BudgetLine, so
        // they must stay out of `actuals`/`variance`/`budgetSpentPct` — but Finance is
        // exactly the audience that has to see fit-out spend, so it comes back as its own
        // `interiorActuals` / `totalInteriorActuals` figure instead of being dropped.
        actuals: true,
        loans: { where: { deletedAt: null }, include: { drawRequests: true } },
        commitments: true,
      },
    });

    let totalBudget = 0;
    let totalActuals = 0;
    let totalInteriorActuals = 0;
    let totalLoanPrincipal = 0;
    let totalMonthlyPayment = 0;
    let totalPendingDraws = 0;
    let totalPendingDrawAmt = 0;

    const budgetByCategory: Record<string, number> = {};
    const actualsByCategory: Record<string, number> = {};

    const projectSummaries = projects.map((p) => {
      const budget = p.budgetLines.reduce((s, b) => s + Number(b.revisedAmt ?? b.baselineAmt), 0);
      const constructionActuals = p.actuals.filter((a) => a.interiorProjectId === null);
      const actuals = constructionActuals.reduce((s, a) => s + Number(a.amount), 0);
      const interiorActuals = p.actuals
        .filter((a) => a.interiorProjectId !== null)
        .reduce((s, a) => s + Number(a.amount), 0);
      const variance = budget - actuals;
      const variancePct = budget > 0 ? (variance / budget) * 100 : 0;
      const committed = p.commitments.reduce((s, c) => s + Number(c.contractAmt), 0);

      totalBudget += budget;
      totalActuals += actuals;
      totalInteriorActuals += interiorActuals;

      for (const bl of p.budgetLines) {
        const cat = bl.category;
        budgetByCategory[cat] = (budgetByCategory[cat] || 0) + Number(bl.revisedAmt ?? bl.baselineAmt);
      }
      // Construction rows only: budgetCategoryChart puts these bars next to budget bars,
      // and no BudgetLine category has TI behind it.
      for (const a of constructionActuals) {
        const cat = a.category;
        actualsByCategory[cat] = (actualsByCategory[cat] || 0) + Number(a.amount);
      }

      let loanPrincipal = 0;
      let monthlyPayment = 0;
      let pendingDraws = 0;
      let pendingDrawAmt = 0;
      const loansNearMaturity: any[] = [];

      for (const loan of this.encryption.decryptLoans(p.loans)) {
        loanPrincipal += Number(loan.principalAmt);
        monthlyPayment += Number(loan.monthlyPayment ?? 0);
        totalLoanPrincipal += Number(loan.principalAmt);
        totalMonthlyPayment += Number(loan.monthlyPayment ?? 0);

        const pending = loan.drawRequests.filter((d) => d.status === 'SUBMITTED');
        const pendingAmount = pending.reduce((s, d) => s + Number(d.amount), 0);
        pendingDraws += pending.length;
        pendingDrawAmt += pendingAmount;
        totalPendingDraws += pending.length;
        totalPendingDrawAmt += pendingAmount;

        if (loan.maturityDate) {
          const daysToMaturity = Math.ceil(
            (new Date(loan.maturityDate).getTime() - Date.now()) / 86400000,
          );
          if (daysToMaturity <= 90) {
            loansNearMaturity.push({
              id: loan.id,
              lender: loan.lender,
              type: loan.loanType,
              principal: Number(loan.principalAmt),
              maturityDate: loan.maturityDate,
              daysToMaturity,
            });
          }
        }
      }

      return {
        id: p.id,
        name: p.name,
        status: p.status,
        phase: p.phase,
        budget,
        actuals,
        /** Isolated fit-out spend — shown alongside, never added into actuals/variance. */
        interiorActuals,
        variance,
        variancePct,
        committed,
        budgetSpentPct: budget > 0 ? actuals / budget : 0,
        loanPrincipal,
        monthlyPayment,
        pendingDraws,
        pendingDrawAmt,
        loansNearMaturity,
      };
    });

    const budgetVariance = totalBudget - totalActuals;
    const budgetUtilPct = totalBudget > 0 ? (totalActuals / totalBudget) * 100 : 0;

    const budgetCategoryChart = Object.entries(budgetByCategory).map(([category, budget]) => ({
      category: category.replace(/_/g, ' '),
      budget,
      actuals: actualsByCategory[category] || 0,
    }));

    const loansNearMaturity = projectSummaries
      .flatMap((p) => p.loansNearMaturity.map((l) => ({ ...l, projectName: p.name, projectId: p.id })))
      .sort((a, b) => a.daysToMaturity - b.daysToMaturity);

    return {
      totalBudget,
      totalActuals,
      /** Isolated fit-out spend across the portfolio — a separate line, not part of totalActuals. */
      totalInteriorActuals,
      budgetVariance,
      budgetUtilPct,
      totalLoanPrincipal,
      totalMonthlyPayment,
      totalPendingDraws,
      totalPendingDrawAmt,
      projectSummaries: projectSummaries.sort((a, b) => Math.abs(a.variancePct) - Math.abs(b.variancePct)).reverse(),
      budgetCategoryChart,
      loansNearMaturity,
    };
  }
}
