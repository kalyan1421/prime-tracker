import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  // ---- Executive Summary (Founders) ----
  async getPortfolioSummary() {
    const projects = await this.prisma.project.findMany({
      where: { status: { not: 'CANCELLED' } },
      include: {
        budgetLines: true,
        actuals: true,
        commitments: true,
        sales: true,
        buildings: { include: { units: { include: { leases: { where: { status: 'ACTIVE' } } } } } },
      },
    });

    let totalInvestment = 0;
    let totalActuals = 0;
    let totalCommitted = 0;
    let closedSalesRevenue = 0;
    let annualRentRevenue = 0;

    const projectRows = projects.map((p) => {
      const budget = p.budgetLines.reduce((s, b) => s + Number(b.revisedAmt ?? b.baselineAmt), 0);
      const actuals = p.actuals.reduce((s, a) => s + Number(a.amount), 0);
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
        variance: budget - actuals,
        totalUnits,
        soldUnits,
        leasedUnits,
        availableUnits,
        occupancy: Math.round(occupancy * 10) / 10,
      };
    });

    const totalRevenue = closedSalesRevenue + annualRentRevenue;
    const overallROI = totalActuals > 0 ? ((totalRevenue - totalActuals) / totalActuals) * 100 : 0;

    const chartData = projectRows.map((r) => ({
      name: r.projectName,
      budget: r.budget,
      actuals: r.actuals,
    }));

    return {
      kpis: {
        totalInvestment,
        totalActuals,
        totalCommitted,
        closedSalesRevenue,
        annualRentRevenue,
        totalRevenue,
        overallROI: Math.round(overallROI * 10) / 10,
      },
      projectComparison: projectRows,
      chartData,
    };
  }

  // ---- Sales Report (Sales Team) ----
  async getSalesSummary() {
    const sales = await this.prisma.sale.findMany({
      where: { project: { status: { not: 'CANCELLED' } } },
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
        building: { project: { status: { not: 'CANCELLED' } } },
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
  async getRevenueSummary() {
    const activeLeases = await this.prisma.lease.findMany({
      where: {
        status: 'ACTIVE',
        unit: { building: { project: { status: { not: 'CANCELLED' } } } },
      },
      include: {
        unit: { include: { building: { include: { project: { select: { id: true, name: true } } } } } },
      },
    });

    const totalMonthlyRent = activeLeases.reduce((s, l) => s + Number(l.monthlyRent), 0);
    const totalAnnualRent = totalMonthlyRent * 12;

    // Portfolio occupancy
    const allUnits = await this.prisma.unit.findMany({
      where: { building: { project: { status: { not: 'CANCELLED' } } } },
    });
    const occupiedUnits = allUnits.filter((u) => ['LEASED', 'SOLD', 'OCCUPIED'].includes(u.status));
    const portfolioOccupancy = allUnits.length > 0 ? (occupiedUnits.length / allUnits.length) * 100 : 0;

    // Upcoming lease expirations (next 12 months)
    const now = new Date();
    const inTwelveMonths = new Date();
    inTwelveMonths.setMonth(inTwelveMonths.getMonth() + 12);

    const expiringLeases = activeLeases
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
      where: { status: 'CLOSED', project: { status: { not: 'CANCELLED' } } },
      include: { project: { select: { id: true, name: true } } },
    });

    const revenueMap = new Map<string, { name: string; rentalIncome: number; salesRevenue: number }>();
    for (const lease of activeLeases) {
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
  async getDebtSummary() {
    const loans = await this.prisma.loan.findMany({
      where: { project: { status: { not: 'CANCELLED' } } },
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
  async getUnitSalesReport() {
    const projects = await this.prisma.project.findMany({
      where: { status: { not: 'CANCELLED' } },
      include: {
        buildings: {
          include: { units: true },
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

  private decryptLoan(loan: any) {
    if (loan.encryptedFields) {
      return this.encryption.decryptFields(loan);
    }
    return loan;
  }
}
