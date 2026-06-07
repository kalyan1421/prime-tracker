import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class ScheduledNotificationsService {
  private readonly logger = new Logger(ScheduledNotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // Run daily at 8:00 AM Central Time
  @Cron('0 8 * * *', { timeZone: 'America/Chicago' })
  async runDailyChecks() {
    this.logger.log('Running daily notification checks...');
    await Promise.allSettled([
      this.checkOverdueMilestones(),
      this.checkExpiringLeases(),
      this.checkLoanMaturities(),
      this.checkBudgetVariances(),
      this.checkSalePayments(),
      this.checkOverdueSnags(),
    ]);
  }

  /**
   * Interior punch-list items past their due date and not yet resolved. Re-notifies each
   * run until resolved (mirrors the milestone pattern). Public for tests / smoke checks.
   */
  async checkOverdueSnags() {
    const now = new Date();
    const overdue = await this.prisma.snagItem.findMany({
      where: {
        dueDate: { lt: now },
        status: { not: 'RESOLVED' },
        interiorProject: { deletedAt: null },
      },
      include: { interiorProject: { select: { id: true, name: true } } },
    });

    for (const s of overdue) {
      if (!s.dueDate || !s.interiorProject) continue;
      const daysOverdue = Math.ceil((now.getTime() - s.dueDate.getTime()) / 86_400_000);
      try {
        await this.notifications.notifySnagOverdue({
          id: s.id,
          description: s.description,
          interiorProjectId: s.interiorProject.id,
          interiorName: s.interiorProject.name,
          daysOverdue,
        });
      } catch (err) {
        this.logger.warn(`Snag overdue notify failed for ${s.id}: ${err}`);
      }
    }
    this.logger.log(`Checked ${overdue.length} overdue snags`);
    return overdue.length;
  }

  /**
   * Sale-payment installments: flip past-due → OVERDUE and notify; also warn on those
   * due within 7 days. Coalesces effectiveDueDate (milestone-stamped) over dueDate.
   * Public so it can be invoked directly in tests / smoke checks.
   */
  async checkSalePayments() {
    const now = new Date();
    const in7 = new Date(now);
    in7.setDate(in7.getDate() + 7);

    // Include OVERDUE so already-flagged installments keep re-notifying each run until
    // they're paid (mirrors checkOverdueMilestones); otherwise the alert fires only once.
    const candidates = await this.prisma.salePayment.findMany({
      where: { status: { in: ['SCHEDULED', 'DUE', 'PARTIALLY_PAID', 'OVERDUE'] } },
      include: {
        sale: { select: { id: true, buyer: true, projectId: true, project: { select: { name: true } } } },
      },
    });

    const overdue: typeof candidates = [];
    const dueSoon: typeof candidates = [];
    for (const p of candidates) {
      const due = p.effectiveDueDate ?? p.dueDate;
      if (!due) continue;
      if (due < now) overdue.push(p);
      else if (due <= in7) dueSoon.push(p);
    }

    if (overdue.length > 0) {
      await this.prisma.salePayment.updateMany({
        where: { id: { in: overdue.map((p) => p.id) } },
        data: { status: 'OVERDUE' },
      });
    }

    for (const p of overdue) {
      const due = (p.effectiveDueDate ?? p.dueDate)!;
      const daysOverdue = Math.ceil((now.getTime() - due.getTime()) / 86_400_000);
      try {
        await this.notifications.notifyPaymentOverdue({
          saleId: p.saleId,
          label: p.label,
          buyer: p.sale.buyer,
          projectId: p.sale.projectId,
          projectName: p.sale.project?.name,
          daysOverdue,
        });
      } catch (err) {
        this.logger.warn(`Payment overdue notify failed for ${p.id}: ${err}`);
      }
    }

    for (const p of dueSoon) {
      const due = (p.effectiveDueDate ?? p.dueDate)!;
      const daysLeft = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
      try {
        await this.notifications.notifyPaymentDueSoon({
          saleId: p.saleId,
          label: p.label,
          buyer: p.sale.buyer,
          projectId: p.sale.projectId,
          projectName: p.sale.project?.name,
          daysLeft,
        });
      } catch (err) {
        this.logger.warn(`Payment due-soon notify failed for ${p.id}: ${err}`);
      }
    }

    this.logger.log(`Sale payments: ${overdue.length} overdue, ${dueSoon.length} due within 7d`);
    return { overdue: overdue.length, dueSoon: dueSoon.length };
  }

  private async checkOverdueMilestones() {
    const now = new Date();

    // Find milestones past due that haven't been marked OVERDUE or COMPLETED yet
    const toMarkOverdue = await this.prisma.milestone.findMany({
      where: {
        dueDate: { lt: now },
        status: { notIn: ['COMPLETED', 'OVERDUE'] },
      },
    });

    if (toMarkOverdue.length > 0) {
      await this.prisma.milestone.updateMany({
        where: { id: { in: toMarkOverdue.map((m) => m.id) } },
        data: { status: 'OVERDUE' },
      });
      this.logger.log(`Marked ${toMarkOverdue.length} milestones as OVERDUE`);
    }

    // Notify on all currently-overdue milestones (newly marked + existing)
    const overdue = await this.prisma.milestone.findMany({
      where: {
        dueDate: { lt: now },
        status: 'OVERDUE',
      },
    });

    const projectIds = [...new Set(overdue.map((m) => m.projectId))];
    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    });
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    for (const milestone of overdue) {
      const project = projectMap.get(milestone.projectId);
      if (!project) continue;
      try {
        await this.notifications.notifyMilestoneOverdue({
          id: milestone.id,
          title: milestone.title,
          projectId: milestone.projectId,
          project: { name: project.name },
        });
      } catch (err) {
        this.logger.warn(`Milestone overdue notify failed for ${milestone.id}: ${err}`);
      }
    }
    this.logger.log(`Checked ${overdue.length} overdue milestones`);
  }

  private async checkExpiringLeases() {
    const now = new Date();
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    const in7 = new Date(now);
    in7.setDate(in7.getDate() + 7);

    // Leases expiring within 30 days
    const leases30 = await this.prisma.lease.findMany({
      where: {
        leaseEnd: { gte: now, lte: in30 },
        status: 'ACTIVE',
      },
      include: {
        unit: {
          include: {
            building: {
              include: {
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    for (const lease of leases30) {
      // Sprint 1: Lease.unitId / Lease.unit are now nullable to support building-level
      // leases (e.g. Leander Bldg 1). Building-level lease expiry notifications need
      // their own code path — skip those for now and keep unit-level behaviour intact.
      if (!lease.unitId || !lease.unit) continue;
      const daysLeft = Math.ceil((lease.leaseEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      try {
        await this.notifications.notifyLeaseExpiring(
          {
            unitId: lease.unitId,
            tenantName: lease.tenantName,
            leaseEnd: lease.leaseEnd,
            unit: lease.unit,
          },
          daysLeft,
        );
      } catch (err) {
        this.logger.warn(`Lease expiry notify failed for ${lease.id}: ${err}`);
      }
    }
    this.logger.log(`Checked ${leases30.length} expiring leases`);
  }

  private async checkLoanMaturities() {
    const now = new Date();
    const in60 = new Date(now);
    in60.setDate(in60.getDate() + 60);

    const loans = await this.prisma.loan.findMany({
      where: {
        maturityDate: { not: null, gte: now, lte: in60 },
      },
      include: { project: { select: { id: true, name: true } } },
    });

    for (const loan of loans) {
      if (!loan.maturityDate) continue;
      // Sprint 1: Loan.projectId is now nullable to support per-building loans.
      // Building-level loan maturity notifications need their own surface — defer.
      if (!loan.projectId || !loan.project) continue;
      try {
        await this.notifications.notifyLoanMaturity({
          id: loan.id,
          lender: loan.lender,
          maturityDate: loan.maturityDate,
          projectId: loan.projectId,
          project: { name: loan.project.name },
        });
      } catch (err) {
        this.logger.warn(`Loan maturity notify failed for ${loan.id}: ${err}`);
      }
    }
    this.logger.log(`Checked ${loans.length} maturing loans`);
  }

  private async checkBudgetVariances() {
    const projects = await this.prisma.project.findMany({
      where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      select: { id: true, name: true },
    });

    for (const project of projects) {
      try {
        const [budgets, actuals] = await Promise.all([
          this.prisma.budgetLine.aggregate({ where: { projectId: project.id }, _sum: { baselineAmt: true } }),
          // Exclude interior/TI actuals so they don't trip the main-project variance alert.
          this.prisma.actual.aggregate({ where: { projectId: project.id, interiorProjectId: null }, _sum: { amount: true } }),
        ]);

        const totalBudget = budgets._sum.baselineAmt?.toNumber() ?? 0;
        const totalActual = actuals._sum.amount?.toNumber() ?? 0;

        if (totalBudget > 0) {
          const variancePct = ((totalActual - totalBudget) / totalBudget) * 100;
          if (variancePct > 10) {
            await this.notifications.notifyBudgetVariance(project.id, project.name, variancePct);
          }
        }
      } catch (err) {
        this.logger.warn(`Budget variance check failed for project ${project.id}: ${err}`);
      }
    }
    this.logger.log(`Checked budget variances for ${projects.length} projects`);
  }
}
