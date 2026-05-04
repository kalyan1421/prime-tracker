import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // ---- Founder Dashboard ----
  async getFounderDashboard() {
    const projects = await this.prisma.project.findMany({
      where: { status: { not: 'CANCELLED' } },
      include: {
        budgetLines: true,
        actuals: true,
        commitments: true,
        sales: true,
        loans: { include: { drawRequests: true } },
        milestones: true,
        buildings: {
          include: {
            units: {
              include: { leases: { where: { status: 'ACTIVE' } } },
            },
          },
        },
      },
    });

    let totalBudget = 0;
    let totalActuals = 0;
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
      const actuals = p.actuals.reduce((s, a) => s + Number(a.amount), 0);
      const committed = p.commitments.reduce((s, c) => s + Number(c.contractAmt), 0);

      totalBudget += budget;
      totalActuals += actuals;
      totalCommitted += committed;

      projectsByPhase[p.phase] = (projectsByPhase[p.phase] || 0) + 1;

      // Sales
      for (const sale of p.sales) {
        if (sale.status === 'CLOSED') closedSalesRevenue += Number(sale.salePrice ?? 0);
        if (sale.status === 'UNDER_CONTRACT') underContractValue += Number(sale.salePrice ?? 0);
      }

      // Loans
      for (const loan of p.loans) {
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

      // Budget alerts
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
  async getConstructionDashboard(role: string) {
    const isPM = role === 'PROJECT_MANAGER';

    const projects = await this.prisma.project.findMany({
      where: { status: 'ACTIVE' },
      include: {
        budgetLines: true,
        actuals: true,
        milestones: true,
        loans: { include: { drawRequests: true } },
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

      for (const loan of p.loans) {
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
        budgetSpentPct,
        rawBudget: { budget, actuals },
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
      totalBudget,
      totalActuals,
      totalLoanAvailable,
      budgetVariance: totalBudget - totalActuals,
      budgetSpentPct,
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
  async getSalesDashboard() {
    const projects = await this.prisma.project.findMany({
      where: { status: { not: 'CANCELLED' } },
      include: {
        sales: true,
        buildings: {
          include: {
            units: {
              include: { leases: { where: { status: 'ACTIVE' } } },
            },
          },
        },
      },
    });

    const leads = await this.prisma.lead.findMany({
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
}
