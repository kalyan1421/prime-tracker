import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { NotificationsService } from './notifications.service';
import { LeaseRentInvoiceService } from '../leases/lease-rent-invoice.service';
import { NOT_ON_SOLD_UNIT } from '../leases/lease-filters';

/**
 * A lease is polymorphic (unitId XOR buildingId), so every leasing check has to fetch
 * the owning project down BOTH paths. One shared include keeps the three checks honest.
 */
const LEASE_PROJECT_INCLUDE = {
  unit: {
    select: {
      unitNumber: true,
      building: { select: { project: { select: { id: true, name: true } } } },
    },
  },
  building: {
    select: {
      name: true,
      project: { select: { id: true, name: true } },
    },
  },
} as const;

/** The shape the lease helpers below read — kept structural so tests can hand-build it. */
interface LeaseWithProject {
  tenantName: string;
  monthlyRent?: unknown;
  unit?: {
    unitNumber?: string | null;
    building?: { project?: { id: string; name: string } | null } | null;
  } | null;
  building?: { name?: string | null; project?: { id: string; name: string } | null } | null;
}

/**
 * D2 — days out at which a still-valid document is flagged, widest first.
 *
 * Why these three, for a permit rather than a lease:
 *   60 — the renewal LEAD TIME. A municipal permit or NOC re-issue is an application, a
 *        fee, an inspection and an agency queue; 60 days is the last point at which
 *        starting is comfortable. Same reasoning as LOAN_MATURITY_60 — anything that
 *        needs a third party to act gets two months.
 *   30 — the renewal should now be IN FLIGHT. Matches LEASE_EXPIRING_30.
 *    7 — last chance to avoid a gap. Matches LEASE_EXPIRING_7.
 *
 * The widest entry also bounds the query, so this list is the single source of truth for
 * "how far ahead do we look".
 */
export const DOCUMENT_EXPIRY_HORIZONS = [60, 30, 7] as const;

@Injectable()
export class ScheduledNotificationsService {
  private readonly logger = new Logger(ScheduledNotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private rentInvoices: LeaseRentInvoiceService,
    private encryption: EncryptionService,
  ) {}

  // Run daily at 8:00 AM Central Time
  @Cron('0 8 * * *', { timeZone: 'America/Chicago' })
  async runDailyChecks() {
    this.logger.log('Running daily notification checks...');

    // Rent invoices must be generated BEFORE checkOverdueRent reads them — awaited,
    // not part of the parallel batch below. Without this the ledger is never populated
    // outside a manual API call, so checkOverdueRent always queries an empty table and
    // RENT_OVERDUE can never fire. Generation is idempotent (unique on
    // leaseId+periodMonth) and append-only, so a daily re-run is safe.
    try {
      const result = await this.rentInvoices.generateDueThrough(new Date());
      this.logger.log(
        `Rent invoices: ${result.invoicesCreated} created across ${result.leasesProcessed} lease(s)`,
      );
    } catch (err) {
      // Never let generation failure block the notification checks below.
      this.logger.error(`Rent invoice generation failed: ${err}`);
    }

    await Promise.allSettled([
      this.checkOverdueMilestones(),
      this.checkExpiringLeases(),
      this.checkLoanMaturities(),
      this.checkBudgetVariances(),
      this.checkSalePayments(),
      this.checkOverdueSnags(),
      this.checkFreeRentEnding(),
      this.checkOutstandingDeposits(),
      this.checkOverdueRent(),
      this.checkHoldovers(),
      this.checkExpiringDocuments(),
    ]);
  }

  /**
   * D2 — documents that expire, and documents that already have.
   *
   * One pass covers both: the query has an UPPER bound (the widest horizon) and no lower
   * bound at all, so already-lapsed documents come back in the same read. That is
   * deliberate — a permit four months lapsed is more worth surfacing than one lapsed a
   * week ago, the same call checkHoldovers makes.
   *
   * The two outcomes are different NotificationTypes, not one escalating type: see
   * notifyDocumentExpired for why (muting the countdown must not mute the lapse).
   *
   * Public so it can be invoked directly in tests / smoke checks.
   */
  async checkExpiringDocuments() {
    const now = new Date();
    const farHorizon = new Date(now);
    farHorizon.setDate(farHorizon.getDate() + Math.max(...DOCUMENT_EXPIRY_HORIZONS));

    const docs = await this.prisma.document.findMany({
      where: {
        // Soft-deleted documents were never real candidates: nobody is renewing a permit
        // that has been removed from the vault.
        deletedAt: null,
        // `not: null` matters as well as the bound — most documents (photos, drawings,
        // brochures) carry no expiry and must stay silent.
        expiresAt: { not: null, lte: farHorizon },
        // A document on an ARCHIVED (soft-deleted) project is not somebody's problem any
        // more, and alerting on it is the same leak that was fixed in units and reports.
        // Each link is nullable, so each needs its own "unset OR alive" clause — a bare
        // `project: { deletedAt: null }` would silently drop every building-, unit- and
        // interior-anchored document, which is most of them.
        AND: [
          { OR: [{ projectId: null }, { project: { deletedAt: null } }] },
          { OR: [{ buildingId: null }, { building: { deletedAt: null, project: { deletedAt: null } } }] },
          {
            OR: [
              { unitId: null },
              { unit: { deletedAt: null, building: { deletedAt: null, project: { deletedAt: null } } } },
            ],
          },
        ],
      },
      select: {
        id: true,
        fileName: true,
        category: true,
        expiresAt: true,
        // Documents are polymorphic like leases — resolve the owning project down whichever
        // link is set so recipient routing can scope it.
        project: { select: { id: true, name: true } },
        building: { select: { project: { select: { id: true, name: true } } } },
        unit: { select: { building: { select: { project: { select: { id: true, name: true } } } } } },
      },
    });

    // Ascending, so `find` returns the TIGHTEST horizon that still contains the document.
    const horizons = [...DOCUMENT_EXPIRY_HORIZONS].sort((a, b) => a - b);

    let expiring = 0;
    let expired = 0;
    for (const doc of docs) {
      if (!doc.expiresAt) continue;
      const project = doc.project ?? doc.building?.project ?? doc.unit?.building?.project ?? null;
      const common = {
        id: doc.id,
        fileName: doc.fileName,
        category: doc.category as string,
        expiresAt: doc.expiresAt,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
      };

      try {
        if (doc.expiresAt < now) {
          // Ceil, like every other "days overdue" in this file — it also means a document
          // that lapsed six hours ago reads "1 day(s) ago" rather than "0 day(s) ago".
          const daysOverdue = Math.ceil((now.getTime() - doc.expiresAt.getTime()) / 86_400_000);
          await this.notifications.notifyDocumentExpired({ ...common, daysOverdue });
          expired++;
          continue;
        }

        const daysLeft = Math.ceil((doc.expiresAt.getTime() - now.getTime()) / 86_400_000);
        const horizonDays = horizons.find((h) => daysLeft <= h);
        // Unreachable while the query is bounded by the widest horizon, but a rounding
        // edge must skip rather than send an alert with no bucket (and so no dedupe key).
        if (horizonDays === undefined) continue;
        await this.notifications.notifyDocumentExpiring({ ...common, daysLeft, horizonDays });
        expiring++;
      } catch (err) {
        this.logger.warn(`Document expiry notify failed for ${doc.id}: ${err}`);
      }
    }

    this.logger.log(`Document expiry: ${expired} expired, ${expiring} expiring within ${Math.max(...DOCUMENT_EXPIRY_HORIZONS)}d`);
    return { expired, expiring };
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
      include: {
        interiorProject: {
          select: {
            id: true,
            name: true,
            // InteriorProject is anchored to a unit XOR a building — walk either path
            // down to the owning project so recipient routing can scope it.
            unit: { select: { building: { select: { projectId: true } } } },
            building: { select: { projectId: true } },
          },
        },
      },
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
          projectId:
            s.interiorProject.unit?.building?.projectId ?? s.interiorProject.building?.projectId ?? null,
        });
      } catch (err) {
        this.logger.warn(`Snag overdue notify failed for ${s.id}: ${err}`);
      }
    }
    this.logger.log(`Checked ${overdue.length} overdue snags`);
    return overdue.length;
  }

  // ─────── Leasing-depth checks ───────

  /**
   * Free rent ending within 30 days — the first PAYING month is approaching, which is
   * the moment Finance has to start expecting cash and AR has to start chasing it.
   *
   * A lease's abatement is stored as one isFreeRent LeaseRentPeriod per free month, so
   * "free rent ends" means the LAST free period's endDate. We therefore take the latest
   * free period landing in the window and drop any lease that still has a free period
   * running beyond it (endDate later than the window, or null = runs to lease end).
   */
  async checkFreeRentEnding() {
    const now = new Date();
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);

    const inWindow = await this.prisma.leaseRentPeriod.findMany({
      where: {
        isFreeRent: true,
        endDate: { gte: now, lte: in30 },
        lease: { deletedAt: null, status: 'ACTIVE', ...NOT_ON_SOLD_UNIT },
      },
      include: { lease: { include: LEASE_PROJECT_INCLUDE } },
    });

    let notified = 0;
    if (inWindow.length > 0) {
      const leaseIds = [...new Set(inWindow.map((p) => p.leaseId))];
      // Any free-rent month still running past the window means this is not yet the
      // last one — the tenant is not about to start paying.
      const laterFree = await this.prisma.leaseRentPeriod.findMany({
        where: {
          leaseId: { in: leaseIds },
          isFreeRent: true,
          OR: [{ endDate: null }, { endDate: { gt: in30 } }],
        },
        select: { leaseId: true },
      });
      const stillAbated = new Set(laterFree.map((r) => r.leaseId));

      // Keep only the latest free period per lease.
      const lastPerLease = new Map<string, (typeof inWindow)[number]>();
      for (const period of inWindow) {
        if (stillAbated.has(period.leaseId)) continue;
        const current = lastPerLease.get(period.leaseId);
        if (!current || (period.endDate as Date) > (current.endDate as Date)) {
          lastPerLease.set(period.leaseId, period);
        }
      }

      for (const period of lastPerLease.values()) {
        const project = this.projectOf(period.lease);
        if (!project) continue;
        const end = period.endDate as Date;
        const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
        try {
          await this.notifications.notifyFreeRentEnding({
            projectId: project.id,
            projectName: project.name,
            leaseId: period.leaseId,
            tenantName: period.lease.tenantName,
            unitLabel: this.unitLabelOf(period.lease),
            freeRentEnd: end,
            daysLeft,
            firstPayingRent: this.num(period.lease.monthlyRent),
          });
          notified++;
        } catch (err) {
          this.logger.warn(`Free-rent-ending notify failed for lease ${period.leaseId}: ${err}`);
        }
      }
    }

    this.logger.log(`Free rent ending within 30d: ${notified} lease(s) notified`);
    return notified;
  }

  /**
   * Security deposits past their due date and not yet settled. SETTLED/WAIVED are the
   * two terminal states; PENDING and PARTIAL both still owe money, so both alert.
   * Re-notifies each run until the money lands.
   */
  async checkOutstandingDeposits() {
    const now = new Date();

    const outstanding = await this.prisma.leaseObligation.findMany({
      where: {
        kind: 'SECURITY_DEPOSIT',
        dueDate: { lt: now },
        status: { notIn: ['SETTLED', 'WAIVED'] },
        lease: { deletedAt: null, ...NOT_ON_SOLD_UNIT },
      },
      include: { lease: { include: LEASE_PROJECT_INCLUDE } },
    });

    let notified = 0;
    for (const obligation of outstanding) {
      const project = this.projectOf(obligation.lease);
      if (!project || !obligation.dueDate) continue;
      const daysOverdue = Math.ceil((now.getTime() - obligation.dueDate.getTime()) / 86_400_000);
      const pending = this.num(obligation.totalAmount) - this.num(obligation.paidAmount);
      try {
        await this.notifications.notifyDepositOutstanding({
          projectId: project.id,
          projectName: project.name,
          leaseId: obligation.leaseId,
          obligationId: obligation.id,
          tenantName: obligation.lease.tenantName,
          unitLabel: this.unitLabelOf(obligation.lease),
          outstanding: Number(pending.toFixed(2)),
          daysOverdue,
        });
        notified++;
      } catch (err) {
        this.logger.warn(`Deposit outstanding notify failed for ${obligation.id}: ${err}`);
      }
    }

    this.logger.log(`Outstanding deposits past due: ${notified} notified of ${outstanding.length}`);
    return notified;
  }

  /**
   * Monthly rent invoices past their due date and not fully collected. FREE / PAID /
   * WAIVED invoices are terminal and never alert; DUE and PARTIAL both still owe.
   */
  async checkOverdueRent() {
    const now = new Date();

    const overdue = await this.prisma.leaseRentInvoice.findMany({
      where: {
        dueDate: { lt: now },
        status: { in: ['DUE', 'PARTIAL'] },
        lease: { deletedAt: null, ...NOT_ON_SOLD_UNIT },
      },
      include: { lease: { include: LEASE_PROJECT_INCLUDE } },
    });

    let notified = 0;
    for (const invoice of overdue) {
      const project = this.projectOf(invoice.lease);
      if (!project) continue;
      const daysOverdue = Math.ceil((now.getTime() - invoice.dueDate.getTime()) / 86_400_000);
      const pending = this.num(invoice.amountDue) - this.num(invoice.amountPaid);
      try {
        await this.notifications.notifyRentOverdue({
          projectId: project.id,
          projectName: project.name,
          leaseId: invoice.leaseId,
          invoiceId: invoice.id,
          tenantName: invoice.lease.tenantName,
          unitLabel: this.unitLabelOf(invoice.lease),
          periodMonth: invoice.periodMonth,
          amountOutstanding: Number(pending.toFixed(2)),
          daysOverdue,
        });
        notified++;
      } catch (err) {
        this.logger.warn(`Rent overdue notify failed for invoice ${invoice.id}: ${err}`);
      }
    }

    this.logger.log(`Overdue rent invoices: ${notified} notified of ${overdue.length}`);
    return notified;
  }

  // ─────── Lease helpers ───────

  /**
   * Leases are polymorphic (unit XOR building) — resolve the owning project down
   * whichever side is set. An orphaned lease returns null and is skipped.
   */
  private projectOf(lease: LeaseWithProject | null | undefined): { id: string; name: string } | null {
    return lease?.unit?.building?.project ?? lease?.building?.project ?? null;
  }

  private unitLabelOf(lease: LeaseWithProject | null | undefined): string | null {
    return lease?.unit?.unitNumber ?? lease?.building?.name ?? null;
  }

  /** Prisma Decimals stringify, so route every arithmetic use through Number(). */
  private num(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
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

  /**
   * Tenants occupying past their contracted end with no move-out recorded.
   *
   * Distinct from checkExpiringLeases, which warns BEFORE the end. This fires after it,
   * and it is the condition under which holdover rent is being billed — so leadership
   * should know it is happening, not discover it in a rent roll.
   *
   * Deliberately not bounded by a lookback window: a lease four months into holdover is
   * MORE worth surfacing than one a week in, not less.
   */
  private async checkHoldovers() {
    const today = new Date();
    const leases = await this.prisma.lease.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        // No move-out recorded — the moment endTenancy runs, this stops matching.
        terminationDate: null,
        leaseEnd: { lt: today },
        // A sold unit is not in holdover; the tenancy ended with the sale (H3).
        ...NOT_ON_SOLD_UNIT,
      },
      select: {
        id: true,
        tenantName: true,
        leaseEnd: true,
        // Selected purely so the alert can tell the truth about billing: null means the
        // invoicer generates NO holdover rent for these months (it is the default), and
        // the notification body branches on it. This query deliberately does NOT filter
        // on it — a holdover nobody priced is the one most worth surfacing.
        holdoverRatePct: true,
        unit: { select: { building: { select: { project: { select: { id: true, name: true } } } } } },
        building: { select: { project: { select: { id: true, name: true } } } },
      },
    });

    for (const l of leases) {
      const project = l.unit?.building?.project ?? l.building?.project;
      if (!project) continue;
      const daysOver = Math.floor((today.getTime() - l.leaseEnd.getTime()) / 86_400_000);
      await this.notifications.notifyLeaseHoldover({
        id: l.id,
        tenantName: l.tenantName,
        leaseEnd: l.leaseEnd,
        daysOver,
        projectId: project.id,
        projectName: project.name,
        // Prisma Decimal → number; null stays null (the "not billed" branch).
        holdoverRatePct: l.holdoverRatePct == null ? null : Number(l.holdoverRatePct),
      });
    }
    if (leases.length) this.logger.log(`Holdover: ${leases.length} lease(s) past their term`);
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
        deletedAt: null,
        // No point chasing a renewal on a unit Prime has sold.
        ...NOT_ON_SOLD_UNIT,
      },
      // Leases are polymorphic (unit XOR building) — fetch the project down BOTH paths so
      // whole-building leases can be notified on too.
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
        building: {
          select: { project: { select: { id: true, name: true } } },
        },
      },
    });

    for (const lease of leases30) {
      // Resolve the project from whichever side of the polymorphic link is set. Only an
      // orphaned lease (neither unit nor building) is skipped.
      const project = lease.unit?.building?.project ?? lease.building?.project;
      if (!project) continue;
      const daysLeft = Math.ceil((lease.leaseEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      try {
        await this.notifications.notifyLeaseExpiring(
          {
            // notifyLeaseExpiring predates polymorphic leases: it takes a non-null unitId
            // and reads the project off `unit.building.project`. Both are only used to
            // resolve the project/link, so a building-level lease passes its buildingId
            // and a synthesised `unit` wrapper around the resolved project.
            unitId: lease.unitId ?? lease.buildingId!,
            tenantName: lease.tenantName,
            leaseEnd: lease.leaseEnd,
            unit: { building: { project } },
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
        // Soft-deleted loans were still generating maturity alerts.
        deletedAt: null,
      },
      include: { project: { select: { id: true, name: true } } },
    });

    // lender is encrypted; the notification body embeds it, so decrypt before sending
    // or every "loan maturing" alert names an undefined lender.
    for (const loan of this.encryption.decryptLoans(loans)) {
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
