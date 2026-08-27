import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';
import { ProjectAccessService } from '../../common/access/project-access.service';

/** Same shape LeadsService/DashboardService thread through for project scoping. */
type Viewer = { userId: string; role: string; roles?: string[] } | undefined;

/** Fixed display order for the fit-out phase breakdown (mirrors the InteriorPhase enum). */
const INTERIOR_PHASES = [
  'DESIGN',
  'CLIENT_APPROVAL',
  'CITY_APPROVAL',
  'PROCUREMENT',
  'EXECUTION',
  'SNAGGING',
  'HANDOVER',
] as const;

/** Where an interior project's committed value came from — so Finance can judge the number. */
type CommitmentBasis = 'PER_SQFT' | 'CONTRACT_VALUE' | 'SCOPE_ITEMS' | 'NONE';

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private statusEvents: UnitStatusEventService,
    private access: ProjectAccessService,
  ) {}

  // ---- Executive Summary (Founders) ----
  //
  // Interior/TI spend is recorded as an `Actual` tagged with `interiorProjectId` (see
  // InteriorService.addInvoice). Every other financial surface — actuals.service,
  // budgets.service, kpi.service, variance-alert.cron — filters those rows out with
  // `interiorProjectId: null`, because the TI budget is isolated inside the interior
  // module and is NOT represented by any BudgetLine. This report did not filter, so
  // TI invoices were counted as construction actuals: `totalActuals` was inflated and
  // every project with a fit-out read as over budget against a budget that never
  // contained TI in the first place.
  //
  // Actuals are now partitioned: `actuals` is construction-only (matching the rest of
  // the app) and TI is surfaced as its own `interiorActuals` figure, never folded in.
  // The ROI denominator stays construction + TI, so the headline ROI is unchanged.
  // The full fit-out picture (commitment, invoiced, remaining) lives in
  // getInteriorSummary() below.
  async getPortfolioSummary(viewer?: Viewer) {
    // Scoped field roles (PM/Construction/Sales/Marketing) only see their member
    // projects — mirrors LeadsService/UnitsService, `undefined` for unrestricted roles.
    const scopeIds = await this.access.listProjectScope(viewer);
    const projects = await this.prisma.project.findMany({
      where: {
        status: { not: 'CANCELLED' }, deletedAt: null,
        ...(scopeIds ? { id: { in: scopeIds } } : {}),
      },
      include: {
        budgetLines: { where: { deletedAt: null } },
        actuals: true,
        commitments: true,
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

    let totalInvestment = 0;
    let totalActuals = 0;
    let totalInteriorActuals = 0;
    let totalCommitted = 0;
    let closedSalesRevenue = 0;
    let annualRentRevenue = 0;

    const projectRows = projects.map((p) => {
      const budget = p.budgetLines.reduce((s, b) => s + Number(b.revisedAmt ?? b.baselineAmt), 0);
      const actuals = p.actuals
        .filter((a) => a.interiorProjectId === null)
        .reduce((s, a) => s + Number(a.amount), 0);
      const interiorActuals = p.actuals
        .filter((a) => a.interiorProjectId !== null)
        .reduce((s, a) => s + Number(a.amount), 0);
      const committed = p.commitments.reduce((s, c) => s + Number(c.contractAmt), 0);
      const closedSales = p.sales.filter((s) => s.status === 'CLOSED');
      const salesRev = closedSales.reduce((s, sale) => s + Number(sale.salePrice ?? 0), 0);

      const units = p.buildings.flatMap((b) => b.units);
      const totalUnits = units.length;
      const soldUnits = units.filter((u) => u.status === 'SOLD').length;
      const leasedUnits = units.filter((u) => u.status === 'LEASED').length;
      const availableUnits = units.filter((u) => u.status === 'AVAILABLE').length;
      const activeLeases = units.flatMap((u) => u.leases);
      const monthlyRent = activeLeases.reduce((s, l) => s + Number(l.monthlyRent), 0);
      const occupancy = totalUnits > 0 ? ((soldUnits + leasedUnits) / totalUnits) * 100 : 0;

      totalInvestment += budget;
      totalActuals += actuals;
      totalInteriorActuals += interiorActuals;
      totalCommitted += committed;
      closedSalesRevenue += salesRev;
      annualRentRevenue += monthlyRent * 12;

      return {
        projectId: p.id,
        projectName: p.name,
        status: p.status,
        phase: p.phase,
        budget,
        actuals,
        /** Isolated TI spend — shown alongside, never added into `actuals` or `variance`. */
        interiorActuals,
        variance: budget - actuals,
        totalUnits,
        soldUnits,
        leasedUnits,
        availableUnits,
        occupancy: Math.round(occupancy * 10) / 10,
      };
    });

    const totalRevenue = closedSalesRevenue + annualRentRevenue;
    // ROI is measured against Total Investment (the budget figure), not Total Actuals —
    // they're two different denominators shown as separate KPI cards on the same screen,
    // and computing ROI against actuals while labeling the card "vs investment" produced
    // a number that didn't match what a reader would assume it was computed against. Null
    // (not 0) when there's no investment recorded at all, matching the "—" convention
    // already used for campaigns.service.ts's CPL/CPA.
    const overallROI =
      totalInvestment > 0 ? ((totalRevenue - totalInvestment) / totalInvestment) * 100 : null;

    const chartData = projectRows.map((r) => ({
      name: r.projectName,
      budget: r.budget,
      actuals: r.actuals,
    }));

    return {
      kpis: {
        totalInvestment,
        totalActuals,
        /** Isolated TI spend across the portfolio — a separate line, not part of totalActuals. */
        totalInteriorActuals,
        totalCommitted,
        closedSalesRevenue,
        annualRentRevenue,
        totalRevenue,
        overallROI: overallROI === null ? null : Math.round(overallROI * 10) / 10,
      },
      projectComparison: projectRows,
      chartData,
    };
  }

  // ---- Sales Report (Sales Team) ----
  async getSalesSummary(viewer?: Viewer) {
    // `project.deletedAt: null` everywhere in this file: archiving a project soft-deletes
    // the PROJECT row only — its buildings, units, sales and leases keep deletedAt = null.
    // Filtering on the child's own flag therefore leaves an archived project's rows in
    // every cross-project rollup. getPortfolioSummary already filtered the whole chain;
    // the reports below did not.
    //
    // Scoped field roles (Sales/Marketing) only see their member projects — this report
    // used to aggregate across the whole portfolio regardless of who asked, unlike
    // LeadsService/UnitsService which always scoped. Mirrors that pattern now.
    const scopeIds = await this.access.listProjectScope(viewer);
    const sales = await this.prisma.sale.findMany({
      where: {
        deletedAt: null,
        project: { status: { not: 'CANCELLED' }, deletedAt: null },
        ...(scopeIds ? { projectId: { in: scopeIds } } : {}),
      },
      include: {
        unit: { include: { building: { select: { name: true } } } },
        project: { select: { id: true, name: true } },
      },
    });

    const activeSales = sales.filter((s) => s.status !== 'CANCELLED');
    const closedSales = activeSales.filter((s) => s.status === 'CLOSED');
    const totalPipeline = activeSales.reduce((s, sale) => s + Number(sale.salePrice ?? 0), 0);
    const closedValue = closedSales.reduce((s, sale) => s + Number(sale.salePrice ?? 0), 0);
    const conversionRate = activeSales.length > 0 ? (closedSales.length / activeSales.length) * 100 : 0;

    // Average days to close (from LOI or contract date to closing)
    const closedWithDates = closedSales.filter((s) => s.closingDate && (s.loiDate || s.contractDate));
    const avgDaysToClose = closedWithDates.length > 0
      ? closedWithDates.reduce((sum, s) => {
          const startDate = s.loiDate || s.contractDate!;
          const days = Math.abs(new Date(s.closingDate!).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24);
          return sum + days;
        }, 0) / closedWithDates.length
      : 0;

    // Deals by stage
    const stages = ['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT', 'CLOSED'];
    const dealsByStage = stages.map((stage) => {
      const stageDeals = activeSales.filter((s) => s.status === stage);
      return {
        stage: stage.replace(/_/g, ' '),
        count: stageDeals.length,
        value: stageDeals.reduce((s, sale) => s + Number(sale.salePrice ?? 0), 0),
      };
    });

    // Sales by project
    const projectMap = new Map<string, { name: string; value: number; count: number }>();
    for (const sale of activeSales) {
      const key = sale.project.id;
      const existing = projectMap.get(key) || { name: sale.project.name, value: 0, count: 0 };
      existing.value += Number(sale.salePrice ?? 0);
      existing.count += 1;
      projectMap.set(key, existing);
    }
    const salesByProject = Array.from(projectMap.values());

    // Available units across all projects
    const availableUnits = await this.prisma.unit.findMany({
      where: {
        status: 'AVAILABLE',
        deletedAt: null,
        building: {
          deletedAt: null,
          project: {
            status: { not: 'CANCELLED' }, deletedAt: null,
            ...(scopeIds ? { id: { in: scopeIds } } : {}),
          },
        },
      },
      include: { building: { include: { project: { select: { name: true } } } } },
    });

    const availableUnitsList = availableUnits.map((u) => ({
      id: u.id,
      unitNumber: u.unitNumber,
      unitType: u.unitType,
      sqft: u.sqft,
      askingPrice: u.askingPrice ? Number(u.askingPrice) : null,
      askingRent: u.askingRent ? Number(u.askingRent) : null,
      buildingName: u.building.name,
      projectName: u.building.project.name,
    }));

    return {
      kpis: {
        totalPipeline,
        closedValue,
        conversionRate: Math.round(conversionRate * 10) / 10,
        avgDaysToClose: Math.round(avgDaysToClose),
      },
      dealsByStage,
      salesByProject,
      availableUnits: availableUnitsList,
    };
  }

  // ---- Revenue & Leasing (Founders + Sales) ----
  async getRevenueSummary(viewer?: Viewer) {
    // Scoped field roles only see their member projects — see getSalesSummary's note.
    const scopeIds = await this.access.listProjectScope(viewer);
    const activeLeases = await this.prisma.lease.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        unit: {
          deletedAt: null,
          building: {
            deletedAt: null,
            project: {
              status: { not: 'CANCELLED' }, deletedAt: null,
              ...(scopeIds ? { id: { in: scopeIds } } : {}),
            },
          },
        },
      },
      include: {
        unit: { include: { building: { include: { project: { select: { id: true, name: true } } } } } },
      },
    });

    const totalMonthlyRent = activeLeases.reduce((s, l) => s + Number(l.monthlyRent), 0);
    const totalAnnualRent = totalMonthlyRent * 12;

    // Portfolio occupancy
    const allUnits = await this.prisma.unit.findMany({
      where: {
        deletedAt: null,
        building: {
          deletedAt: null,
          project: {
            status: { not: 'CANCELLED' }, deletedAt: null,
            ...(scopeIds ? { id: { in: scopeIds } } : {}),
          },
        },
      },
    });
    const occupiedUnits = allUnits.filter((u) => ['LEASED', 'SOLD', 'OCCUPIED'].includes(u.status));
    const portfolioOccupancy = allUnits.length > 0 ? (occupiedUnits.length / allUnits.length) * 100 : 0;

    // Upcoming lease expirations (next 12 months)
    const now = new Date();
    const inTwelveMonths = new Date();
    inTwelveMonths.setMonth(inTwelveMonths.getMonth() + 12);

    // Sprint 1: leases can now attach to a Building (no Unit). Filter to unit-leases
    // for the per-unit expiring view + per-unit revenue rollup. Building-level lease
    // surfaces are a separate report (deferred to Sprint 2+).
    const unitLeases = activeLeases.filter((l): l is typeof l & { unit: NonNullable<typeof l.unit> } => l.unit !== null);

    const expiringLeases = unitLeases
      .filter((l) => new Date(l.leaseEnd) >= now && new Date(l.leaseEnd) <= inTwelveMonths)
      .map((l) => {
        const daysUntilExpiry = Math.ceil((new Date(l.leaseEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
          id: l.id,
          tenantName: l.tenantName,
          unitNumber: l.unit.unitNumber,
          buildingName: l.unit.building.name,
          projectName: l.unit.building.project.name,
          monthlyRent: Number(l.monthlyRent),
          leaseEnd: l.leaseEnd,
          daysUntilExpiry,
          urgency: daysUntilExpiry <= 30 ? 'CRITICAL' : daysUntilExpiry <= 90 ? 'HIGH' : daysUntilExpiry <= 180 ? 'MEDIUM' : 'LOW',
        };
      })
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

    // Revenue by project (rental + sales)
    const closedSales = await this.prisma.sale.findMany({
      where: {
        status: 'CLOSED',
        deletedAt: null,
        project: { status: { not: 'CANCELLED' }, deletedAt: null },
        ...(scopeIds ? { projectId: { in: scopeIds } } : {}),
      },
      include: { project: { select: { id: true, name: true } } },
    });

    const revenueMap = new Map<string, { name: string; rentalIncome: number; salesRevenue: number }>();
    for (const lease of unitLeases) {
      const pid = lease.unit.building.project.id;
      const existing = revenueMap.get(pid) || { name: lease.unit.building.project.name, rentalIncome: 0, salesRevenue: 0 };
      existing.rentalIncome += Number(lease.monthlyRent) * 12;
      revenueMap.set(pid, existing);
    }
    for (const sale of closedSales) {
      const pid = sale.project.id;
      const existing = revenueMap.get(pid) || { name: sale.project.name, rentalIncome: 0, salesRevenue: 0 };
      existing.salesRevenue += Number(sale.salePrice ?? 0);
      revenueMap.set(pid, existing);
    }
    const revenueByProject = Array.from(revenueMap.values());

    return {
      kpis: {
        totalMonthlyRent,
        totalAnnualRent,
        activeLeaseCount: activeLeases.length,
        portfolioOccupancy: Math.round(portfolioOccupancy * 10) / 10,
      },
      expiringLeases,
      revenueByProject,
    };
  }

  // ---- Debt & Financing (Founders) ----
  async getDebtSummary(viewer?: Viewer) {
    // Scoped field roles only see their member projects — see getSalesSummary's note.
    const scopeIds = await this.access.listProjectScope(viewer);
    const loans = await this.prisma.loan.findMany({
      where: {
        deletedAt: null,
        project: { status: { not: 'CANCELLED' }, deletedAt: null },
        ...(scopeIds ? { projectId: { in: scopeIds } } : {}),
      },
      include: {
        project: { select: { id: true, name: true } },
        drawRequests: { orderBy: { drawNumber: 'asc' } },
      },
    });

    const decryptedLoans = loans.map((l) => this.decryptLoan(l));

    const totalPrincipal = decryptedLoans.reduce((s, l) => s + Number(l.principalAmt ?? 0), 0);
    const totalBalance = decryptedLoans.reduce((s, l) => s + Number(l.currentBalance ?? l.principalAmt ?? 0), 0);
    const totalMonthlyPayment = decryptedLoans.reduce((s, l) => s + Number(l.monthlyPayment ?? 0), 0);

    // Weighted average interest rate
    const weightedRateSum = decryptedLoans.reduce((s, l) => {
      const principal = Number(l.principalAmt ?? 0);
      const rate = Number(l.interestRate ?? 0);
      return s + principal * rate;
    }, 0);
    const weightedAvgRate = totalPrincipal > 0 ? weightedRateSum / totalPrincipal : 0;

    // Loans list (formatted for display)
    const loansList = decryptedLoans.map((l) => ({
      id: l.id,
      projectName: l.project.name,
      loanType: l.loanType,
      lender: l.lender,
      principalAmt: Number(l.principalAmt ?? 0),
      currentBalance: Number(l.currentBalance ?? l.principalAmt ?? 0),
      interestRate: Number(l.interestRate ?? 0),
      monthlyPayment: Number(l.monthlyPayment ?? 0),
      maturityDate: l.maturityDate,
      termMonths: l.termMonths,
    }));

    // Upcoming maturities
    const now = new Date();
    const maturities = loansList
      .filter((l) => l.maturityDate)
      .map((l) => {
        const daysUntilMaturity = Math.ceil((new Date(l.maturityDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return { ...l, daysUntilMaturity };
      })
      .sort((a, b) => a.daysUntilMaturity - b.daysUntilMaturity);

    // Summary by loan type
    const typeMap = new Map<string, { type: string; count: number; totalPrincipal: number; totalBalance: number }>();
    for (const loan of loansList) {
      const existing = typeMap.get(loan.loanType) || { type: loan.loanType, count: 0, totalPrincipal: 0, totalBalance: 0 };
      existing.count += 1;
      existing.totalPrincipal += loan.principalAmt;
      existing.totalBalance += loan.currentBalance;
      typeMap.set(loan.loanType, existing);
    }
    const byLoanType = Array.from(typeMap.values());

    return {
      kpis: {
        totalPrincipal,
        totalBalance,
        weightedAvgRate: Math.round(weightedAvgRate * 100) / 100,
        totalMonthlyPayment,
      },
      loans: loansList,
      maturities,
      byLoanType,
    };
  }

  // ---- Unit Sales Value (Founders + Sales) ----
  async getUnitSalesReport(viewer?: Viewer) {
    // Scoped field roles only see their member projects — see getSalesSummary's note.
    const scopeIds = await this.access.listProjectScope(viewer);
    const projects = await this.prisma.project.findMany({
      where: {
        status: { not: 'CANCELLED' }, deletedAt: null,
        ...(scopeIds ? { id: { in: scopeIds } } : {}),
      },
      include: {
        buildings: {
          where: { deletedAt: null },
          include: { units: { where: { deletedAt: null } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    let totalPortfolioValue = 0;
    let totalSoldValue = 0;
    let totalUnsoldValue = 0;
    let totalUnderContractValue = 0;
    let totalUnits = 0;
    let totalSoldCount = 0;
    let totalUnsoldCount = 0;
    let totalUnderContractCount = 0;

    const projectRows = projects
      .map((p) => {
        let projTotal = 0, projSold = 0, projUnsold = 0, projContract = 0;
        let projTotalCt = 0, projSoldCt = 0, projUnsoldCt = 0, projContractCt = 0;

        const buildings = p.buildings
          .map((b) => {
            let bTotal = 0, bSold = 0, bUnsold = 0, bContract = 0;
            let bTotalCt = 0, bSoldCt = 0, bUnsoldCt = 0, bContractCt = 0;

            for (const unit of b.units) {
              const price = Number(unit.askingPrice ?? 0);
              bTotal += price;
              bTotalCt += 1;
              if (unit.status === 'SOLD') { bSold += price; bSoldCt += 1; }
              else if (unit.status === 'AVAILABLE') { bUnsold += price; bUnsoldCt += 1; }
              else if (unit.status === 'UNDER_CONTRACT') { bContract += price; bContractCt += 1; }
            }

            projTotal += bTotal; projSold += bSold; projUnsold += bUnsold; projContract += bContract;
            projTotalCt += bTotalCt; projSoldCt += bSoldCt; projUnsoldCt += bUnsoldCt; projContractCt += bContractCt;

            return {
              buildingId: b.id,
              buildingName: b.name,
              totalValue: bTotal,
              soldValue: bSold,
              unsoldValue: bUnsold,
              underContractValue: bContract,
              totalUnits: bTotalCt,
              soldCount: bSoldCt,
              unsoldCount: bUnsoldCt,
              underContractCount: bContractCt,
              pctSold: bTotalCt > 0 ? Math.round((bSoldCt / bTotalCt) * 100) : 0,
            };
          })
          .filter((b) => b.totalUnits > 0);

        totalPortfolioValue += projTotal;
        totalSoldValue += projSold;
        totalUnsoldValue += projUnsold;
        totalUnderContractValue += projContract;
        totalUnits += projTotalCt;
        totalSoldCount += projSoldCt;
        totalUnsoldCount += projUnsoldCt;
        totalUnderContractCount += projContractCt;

        return {
          projectId: p.id,
          projectName: p.name,
          status: p.status,
          phase: p.phase,
          totalValue: projTotal,
          soldValue: projSold,
          unsoldValue: projUnsold,
          underContractValue: projContract,
          totalUnits: projTotalCt,
          soldCount: projSoldCt,
          unsoldCount: projUnsoldCt,
          underContractCount: projContractCt,
          pctSold: projTotalCt > 0 ? Math.round((projSoldCt / projTotalCt) * 100) : 0,
          buildings,
        };
      })
      .filter((p) => p.totalUnits > 0);

    const chartData = projectRows.map((p) => ({
      name: p.projectName.length > 14 ? p.projectName.slice(0, 14) + '…' : p.projectName,
      Sold: p.soldValue,
      'Under Contract': p.underContractValue,
      Available: p.unsoldValue,
    }));

    return {
      kpis: {
        totalPortfolioValue,
        totalSoldValue,
        totalUnsoldValue,
        totalUnderContractValue,
        totalUnits,
        totalSoldCount,
        totalUnsoldCount,
        totalUnderContractCount,
        pctSold: totalUnits > 0 ? Math.round((totalSoldCount / totalUnits) * 100) : 0,
      },
      projects: projectRows,
      chartData,
    };
  }

  // ---- Vacancy Report (Sales / Founder) ----
  //
  // Lists every AVAILABLE unit ranked by time-on-market (oldest first). Surfaces
  // the "stale inventory" problem the May 5 walkthrough called out — units sitting
  // > 90 days are flagged warning, > 180 days critical. Filters: optional projectId,
  // optional minDays floor to only show stale rows.
  async getVacancyReport(params: { projectId?: string; minDays?: number; viewer?: Viewer } = {}) {
    // The building filter is unconditional. It used to be applied ONLY when a projectId
    // was passed, so the unfiltered (all-projects) view — the one the page opens on —
    // listed every AVAILABLE unit under archived projects and deleted buildings as
    // stale inventory, which is exactly the inventory nobody is trying to lease.
    const where: any = {
      status: 'AVAILABLE',
      deletedAt: null,
      building: { deletedAt: null, project: { deletedAt: null } },
    };
    if (params.projectId) {
      // An explicit projectId is already membership-checked by ProjectAccessGuard.
      where.building.projectId = params.projectId;
    } else {
      // No explicit project — scoped field roles only see their member projects,
      // same as the "all projects" list on LeadsService/UnitsService.
      const scopeIds = await this.access.listProjectScope(params.viewer);
      if (scopeIds) where.building.projectId = { in: scopeIds };
    }

    const units = await this.prisma.unit.findMany({
      where,
      include: {
        building: {
          select: { id: true, name: true, project: { select: { id: true, name: true } } },
        },
      },
    });

    const now = Date.now();
    const minDays = params.minDays ?? 0;

    // Days-on-market comes from the occupancy log, not from `availableSince`.
    //
    // `availableSince` is nulled whenever a unit leaves AVAILABLE and, measured on
    // live data 2026-08-12, was populated on 2 of 499 units while 208 were AVAILABLE.
    // The old `availableSince ?? createdAt` fallback below was therefore reporting the
    // unit's AGE as its time on market for ~206 units — a unit created two years ago
    // and re-let last month read as 730 days stale.
    //
    // Units with no event at all still fall back, but the H0 bootstrap gave every
    // existing unit a row, so that path should only ever be hit by a unit created
    // outside the service layer.
    const vacancyStarts = await this.statusEvents.currentVacancyStartByUnit(units.map((u) => u.id));

    const rows = units
      .map((u) => {
        const logged = vacancyStarts.get(u.id);
        const since = (logged ?? u.availableSince ?? u.createdAt) as Date;
        const days = Math.max(0, Math.floor((now - new Date(since).getTime()) / 86_400_000));
        return {
          unitId: u.id,
          unitNumber: u.unitNumber,
          unitType: u.unitType,
          sqft: u.sqft,
          askingRent: u.askingRent ? Number(u.askingRent) : null,
          askingPrice: u.askingPrice ? Number(u.askingPrice) : null,
          buildingId: u.building.id,
          buildingName: u.building.name,
          projectId: u.building.project.id,
          projectName: u.building.project.name,
          // The date the row's daysOnMarket is actually measured from, so the column
          // and the number can never disagree.
          availableSince: since,
          /** False when we fell back — lets the UI mark the figure as approximate. */
          vacancyFromLog: !!logged,
          daysOnMarket: days,
          severity: days >= 180 ? 'critical' : days >= 90 ? 'warning' : 'info',
        };
      })
      .filter((r) => r.daysOnMarket >= minDays)
      .sort((a, b) => b.daysOnMarket - a.daysOnMarket);

    // Aggregates for the page header
    const totals = rows.reduce(
      (acc, r) => ({
        units: acc.units + 1,
        critical: acc.critical + (r.severity === 'critical' ? 1 : 0),
        warning: acc.warning + (r.severity === 'warning' ? 1 : 0),
        askingValue: acc.askingValue + (r.askingPrice ?? 0),
      }),
      { units: 0, critical: 0, warning: 0, askingValue: 0 },
    );

    return {
      totals,
      rows,
    };
  }

  // ---- Interior / Tenant-Improvement (TI) Summary (Finance) ----
  //
  // Client ask 2026-08-14: "check everything project wise" — the isolated TI budget was
  // reviewable nowhere. This is that review surface: per project, what is COMMITTED to
  // fit-out, what sub-contractors have INVOICED against it, what is still to come, and
  // where each fit-out sits in its phase.
  //
  // TI stays isolated on purpose. Nothing here is added into the main budget/actuals
  // totals — getPortfolioSummary reports construction and TI as two separate figures.
  //
  // Archived-project exclusion: an InteriorProject has no projectId. It anchors to a
  // unit or a building (service-enforced "exactly one of"), and archiving a project sets
  // deletedAt on the Project row ONLY — it does not cascade to buildings, units, sales
  // or interiors. So the whole chain has to be filtered explicitly, the same way
  // getVacancyReport/getRevenueSummary were fixed.
  async getInteriorSummary(params: { projectId?: string; viewer?: Viewer } = {}) {
    // An explicit projectId is already membership-checked by ProjectAccessGuard; without
    // one, scoped field roles only see their member projects — same as getVacancyReport.
    const scopeIds = params.projectId ? undefined : await this.access.listProjectScope(params.viewer);
    const liveProject = {
      deletedAt: null,
      status: { not: 'CANCELLED' as const },
      ...(params.projectId ? { id: params.projectId } : scopeIds ? { id: { in: scopeIds } } : {}),
    };

    const [projects, interiors] = await Promise.all([
      this.prisma.project.findMany({
        where: liveProject,
        select: { id: true, name: true, status: true, phase: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.interiorProject.findMany({
        where: {
          deletedAt: null,
          // One live branch per anchor. Soft-deleted units/buildings and archived
          // projects drop the interior out entirely.
          OR: [
            { unit: { deletedAt: null, building: { deletedAt: null, project: liveProject } } },
            { building: { deletedAt: null, project: liveProject } },
          ],
        },
        include: {
          unit: {
            select: {
              id: true,
              unitNumber: true,
              building: { select: { id: true, name: true, projectId: true } },
            },
          },
          building: { select: { id: true, name: true, projectId: true } },
          pm: { select: { id: true, name: true } },
          invoices: { select: { amount: true, paidAt: true, status: true } },
          scopeItems: { select: { total: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const projectIds = new Set(projects.map((p) => p.id));

    // Buyer-side TI installments. A soft-deleted sale (or one under an archived project)
    // must not contribute, so the sale chain is filtered too. CANCELLED installments are
    // void — the sale died, the money was never owed.
    const interiorIds = interiors.map((i) => i.id);
    const tiPayments = interiorIds.length
      ? await this.prisma.salePayment.findMany({
          where: {
            interiorProjectId: { in: interiorIds },
            status: { not: 'CANCELLED' },
            sale: { deletedAt: null, project: liveProject },
          },
          select: { interiorProjectId: true, amount: true, paidAmount: true, status: true },
        })
      : [];

    const tiByInterior = new Map<string, { billed: number; collected: number; status: string }>();
    for (const p of tiPayments) {
      if (!p.interiorProjectId) continue;
      const existing = tiByInterior.get(p.interiorProjectId) ?? { billed: 0, collected: 0, status: p.status };
      existing.billed += Number(p.amount);
      existing.collected += Number(p.paidAmount);
      tiByInterior.set(p.interiorProjectId, existing);
    }

    const rowsByProject = new Map<string, any[]>();

    for (const ip of interiors) {
      const projectId = ip.building?.projectId ?? ip.unit?.building?.projectId;
      // Defensive: an interior whose anchor resolves outside the requested scope.
      if (!projectId || !projectIds.has(projectId)) continue;

      const { committed, basis } = this.deriveInteriorCommitment(ip);

      const invoiced = ip.invoices.reduce((s, inv) => s + Number(inv.amount), 0);
      const paid = ip.invoices
        .filter((inv) => inv.paidAt !== null || inv.status === 'PAID')
        .reduce((s, inv) => s + Number(inv.amount), 0);

      // remaining / overrun are both non-negative so they roll up cleanly:
      // committed - invoiced === remaining - overrun.
      const remaining = Math.max(0, committed - invoiced);
      const overrun = Math.max(0, invoiced - committed);

      const ti = tiByInterior.get(ip.id);

      const row = {
        interiorProjectId: ip.id,
        name: ip.name,
        status: ip.status,
        phase: ip.phase,
        contractType: ip.contractType,
        ratePerSqft: ip.ratePerSqft === null ? null : Number(ip.ratePerSqft),
        area: ip.area === null ? null : Number(ip.area),
        contractValue: ip.contractValue === null ? null : Number(ip.contractValue),
        /** Internal cost-to-build commitment. Zero once CANCELLED — nothing is owed. */
        committed,
        /** Which input produced `committed`; 'NONE' means Finance has nothing to review. */
        commitmentBasis: basis,
        invoiceCount: ip.invoices.length,
        invoiced,
        paid,
        unpaid: invoiced - paid,
        remaining,
        overrun,
        unitId: ip.unit?.id ?? null,
        unitNumber: ip.unit?.unitNumber ?? null,
        buildingId: ip.building?.id ?? ip.unit?.building.id ?? null,
        buildingName: ip.building?.name ?? ip.unit?.building.name ?? null,
        pmId: ip.pm?.id ?? null,
        pmName: ip.pm?.name ?? null,
        saleId: ip.saleId,
        /** The buyer-facing TI installment on the Sale — the client price, not the cost. */
        tiBilledToBuyer: ti?.billed ?? 0,
        tiCollectedFromBuyer: ti?.collected ?? 0,
        startDate: ip.startDate,
        targetEnd: ip.targetEnd,
        handoverAt: ip.handoverAt,
      };

      const list = rowsByProject.get(projectId);
      if (list) list.push(row);
      else rowsByProject.set(projectId, [row]);
    }

    // Every in-scope project gets a row — a project with no fit-out returns a zeroed row
    // with hasInterior=false rather than being dropped, so Finance can see the gaps.
    const projectRows = projects.map((p) => {
      const rows = rowsByProject.get(p.id) ?? [];
      const agg = this.aggregateInteriorRows(rows);
      return {
        projectId: p.id,
        projectName: p.name,
        status: p.status,
        phase: p.phase,
        hasInterior: rows.length > 0,
        ...agg,
        interiors: rows,
      };
    });

    const allRows = projectRows.flatMap((p) => p.interiors);
    const totals = this.aggregateInteriorRows(allRows);

    const byPhase = INTERIOR_PHASES.map((phase) => {
      const inPhase = allRows.filter((r) => r.phase === phase);
      return {
        phase,
        count: inPhase.length,
        committed: inPhase.reduce((s, r) => s + r.committed, 0),
        invoiced: inPhase.reduce((s, r) => s + r.invoiced, 0),
        remaining: inPhase.reduce((s, r) => s + r.remaining, 0),
      };
    });

    const chartData = projectRows
      .filter((p) => p.hasInterior)
      .map((p) => ({
        name: p.projectName.length > 14 ? p.projectName.slice(0, 14) + '…' : p.projectName,
        Committed: p.committed,
        Invoiced: p.invoiced,
        Remaining: p.remaining,
      }));

    return {
      scope: { projectId: params.projectId ?? null },
      kpis: totals,
      byPhase,
      projects: projectRows,
      chartData,
    };
  }

  /**
   * Fit-out commitment, derived per contract type rather than trusting one column.
   *
   * `contractValue` is only auto-populated for PER_SQFT at create time, an explicit
   * value can override it on update, and COST_PLUS engagements often have neither —
   * so PER_SQFT recomputes rate x area, everything else falls back to the flat
   * contractValue, and a BOQ sum is the last resort.
   *
   * A CANCELLED fit-out commits nothing; whatever was already invoiced against it
   * surfaces as `overrun` and `cancelledSpend`, not as a live commitment.
   */
  private deriveInteriorCommitment(ip: {
    status: string;
    contractType: string;
    ratePerSqft: unknown;
    area: unknown;
    contractValue: unknown;
    scopeItems: Array<{ total: unknown }>;
  }): { committed: number; basis: CommitmentBasis } {
    if (ip.status === 'CANCELLED') return { committed: 0, basis: 'NONE' };

    const rate = ip.ratePerSqft === null || ip.ratePerSqft === undefined ? null : Number(ip.ratePerSqft);
    const area = ip.area === null || ip.area === undefined ? null : Number(ip.area);
    if (ip.contractType === 'PER_SQFT' && rate !== null && area !== null) {
      return { committed: rate * area, basis: 'PER_SQFT' };
    }

    const flat = ip.contractValue === null || ip.contractValue === undefined ? null : Number(ip.contractValue);
    if (flat !== null) return { committed: flat, basis: 'CONTRACT_VALUE' };

    const scopeLines = ip.scopeItems.filter((s) => s.total !== null && s.total !== undefined);
    if (scopeLines.length) {
      return { committed: scopeLines.reduce((s, l) => s + Number(l.total), 0), basis: 'SCOPE_ITEMS' };
    }

    return { committed: 0, basis: 'NONE' };
  }

  /** Roll a set of interior rows up into the shape used for both a project and the portfolio. */
  private aggregateInteriorRows(
    rows: Array<{
      status: string;
      phase: string;
      committed: number;
      invoiced: number;
      paid: number;
      remaining: number;
      overrun: number;
      commitmentBasis: CommitmentBasis;
      tiBilledToBuyer: number;
      tiCollectedFromBuyer: number;
    }>,
  ) {
    const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);

    const committed = sum((r) => r.committed);
    const invoiced = sum((r) => r.invoiced);
    const paid = sum((r) => r.paid);
    const tiBilledToBuyers = sum((r) => r.tiBilledToBuyer);
    const tiCollectedFromBuyers = sum((r) => r.tiCollectedFromBuyer);

    const byPhase = Object.fromEntries(
      INTERIOR_PHASES.map((phase) => [phase, rows.filter((r) => r.phase === phase).length]),
    ) as Record<(typeof INTERIOR_PHASES)[number], number>;

    return {
      interiorCount: rows.length,
      activeCount: rows.filter((r) => r.status === 'IN_PROGRESS').length,
      notStartedCount: rows.filter((r) => r.status === 'NOT_STARTED').length,
      onHoldCount: rows.filter((r) => r.status === 'ON_HOLD').length,
      completedCount: rows.filter((r) => r.status === 'COMPLETED').length,
      cancelledCount: rows.filter((r) => r.status === 'CANCELLED').length,
      committed,
      invoiced,
      paid,
      unpaid: invoiced - paid,
      remaining: sum((r) => r.remaining),
      overrun: sum((r) => r.overrun),
      /** Sub-contractor spend booked against fit-outs that were later cancelled. */
      cancelledSpend: rows.filter((r) => r.status === 'CANCELLED').reduce((s, r) => s + r.invoiced, 0),
      pctInvoiced: committed > 0 ? Math.round((invoiced / committed) * 1000) / 10 : 0,
      /** Fit-outs with no reviewable commitment at all — Finance has to chase these. */
      missingCommitmentCount: rows.filter((r) => r.commitmentBasis === 'NONE' && r.status !== 'CANCELLED').length,
      tiBilledToBuyers,
      tiCollectedFromBuyers,
      tiOutstandingFromBuyers: tiBilledToBuyers - tiCollectedFromBuyers,
      byPhase,
    };
  }

  private decryptLoan(loan: any) {
    if (loan.encryptedFields) {
      return this.encryption.decryptFields(loan);
    }
    return loan;
  }
}
