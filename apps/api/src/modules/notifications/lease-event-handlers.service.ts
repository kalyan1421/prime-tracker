import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';
import { NotificationsService } from './notifications.service';

/**
 * Leasing domain events -> notifications.
 *
 * Mirrors DrawEventHandlers: feature services (LeasesService, SalesService) emit typed
 * events and stay completely ignorant of notifications, so all leasing notification
 * policy lives in this one readable file. Removing this service leaves every feature
 * working — it just stops telling anyone.
 *
 *   unit.sold              -> Finance / Sales / Accounting (FYI)
 *   lease.created          -> Sales / Finance (FYI)
 *   lease.activated        -> Finance / Accounting / AR_AP (FYI)
 *   lease.terminated       -> Finance / Sales (ACTION)
 *   lease.rentChanged      -> Finance / Accounting / AR_AP (FYI)
 *   lease.tiDisbursed      -> Finance / Accounting (FYI)
 *   history.deletionRequested -> Leadership by role (ACTION)
 *   history.deletionDecided   -> the requester, by name (ACTION)
 *
 * Leadership (Super Admin / Founder / Executive) is added by the recipient resolver,
 * not listed here. The cron-driven triggers (free rent ending, deposit outstanding,
 * rent overdue) live in ScheduledNotificationsService — they are time-based, not
 * caused by a write.
 *
 * Handler errors are swallowed by EventBus by design: a failed notification must never
 * roll back the lease write that caused it.
 */
@Injectable()
export class LeaseEventHandlers implements OnModuleInit {
  private readonly logger = new Logger(LeaseEventHandlers.name);

  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.bus.on('unit.sold', (e) => this.onUnitSold(e));
    this.bus.on('lease.created', (e) => this.onLeaseCreated(e));
    this.bus.on('lease.activated', (e) => this.onLeaseActivated(e));
    this.bus.on('lease.terminated', (e) => this.onLeaseTerminated(e));
    this.bus.on('lease.rentChanged', (e) => this.onRentChanged(e));
    this.bus.on('lease.tiDisbursed', (e) => this.onTiDisbursed(e));
    this.bus.on('history.deletionRequested', (e) => this.onHistoryDeletionRequested(e));
    this.bus.on('history.deletionDecided', (e) => this.onHistoryDeletionDecided(e));
  }

  /** Project name is for the message body only — never let a missing name block the send. */
  private async projectName(projectId: string) {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId }, select: { name: true },
    });
    return p?.name ?? null;
  }

  /**
   * A lease is polymorphic (unit OR building), and the notification body should say
   * WHICH space it concerns — "Unit 214" is far more useful than a cuid.
   */
  private async leaseContext(leaseId: string) {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: {
        tenantName: true,
        monthlyRent: true,
        leaseStart: true,
        unit: { select: { unitNumber: true } },
        building: { select: { name: true } },
      },
    });
    if (!lease) return null;
    return {
      tenantName: lease.tenantName,
      monthlyRent: Number(lease.monthlyRent),
      leaseStart: lease.leaseStart,
      unitLabel: lease.unit?.unitNumber ?? lease.building?.name ?? null,
    };
  }

  private async onUnitSold(e: { unitId: string; saleId: string; projectId: string }) {
    const [unit, sale, projectName] = await Promise.all([
      this.prisma.unit.findUnique({ where: { id: e.unitId }, select: { unitNumber: true } }),
      this.prisma.sale.findUnique({ where: { id: e.saleId }, select: { buyer: true, salePrice: true } }),
      this.projectName(e.projectId),
    ]);
    await this.notifications.notifyUnitSold({
      projectId: e.projectId,
      projectName,
      unitId: e.unitId,
      unitLabel: unit?.unitNumber ?? 'a unit',
      buyer: sale?.buyer ?? null,
      salePrice: sale?.salePrice != null ? Number(sale.salePrice) : null,
    });
  }

  private async onLeaseCreated(e: { leaseId: string; projectId: string; tenantName: string }) {
    const [ctx, projectName] = await Promise.all([this.leaseContext(e.leaseId), this.projectName(e.projectId)]);
    await this.notifications.notifyLeaseAdded({
      projectId: e.projectId,
      projectName,
      leaseId: e.leaseId,
      tenantName: ctx?.tenantName ?? e.tenantName,
      unitLabel: ctx?.unitLabel ?? null,
      monthlyRent: ctx?.monthlyRent ?? null,
    });
  }

  private async onLeaseActivated(e: { leaseId: string; projectId: string; tenantName: string }) {
    const [ctx, projectName] = await Promise.all([this.leaseContext(e.leaseId), this.projectName(e.projectId)]);
    await this.notifications.notifyLeaseActivated({
      projectId: e.projectId,
      projectName,
      leaseId: e.leaseId,
      tenantName: ctx?.tenantName ?? e.tenantName,
      unitLabel: ctx?.unitLabel ?? null,
      monthlyRent: ctx?.monthlyRent ?? null,
      leaseStart: ctx?.leaseStart ?? null,
    });
  }

  private async onLeaseTerminated(e: { leaseId: string; projectId: string; tenantName: string; reason?: string }) {
    const [ctx, projectName] = await Promise.all([this.leaseContext(e.leaseId), this.projectName(e.projectId)]);
    await this.notifications.notifyLeaseTerminated({
      projectId: e.projectId,
      projectName,
      leaseId: e.leaseId,
      tenantName: ctx?.tenantName ?? e.tenantName,
      unitLabel: ctx?.unitLabel ?? null,
      terminatedOn: new Date(),
      reason: e.reason ?? null,
    });
  }

  private async onRentChanged(e: {
    leaseId: string; projectId: string; from: number; to: number; effectiveAt: Date; source: 'AUTO' | 'MANUAL';
  }) {
    const [ctx, projectName] = await Promise.all([this.leaseContext(e.leaseId), this.projectName(e.projectId)]);
    await this.notifications.notifyLeaseRentChanged({
      projectId: e.projectId,
      projectName,
      leaseId: e.leaseId,
      tenantName: ctx?.tenantName ?? 'a tenant',
      unitLabel: ctx?.unitLabel ?? null,
      previousRent: e.from,
      newRent: e.to,
      effectiveFrom: e.effectiveAt,
    });
  }

  private async onTiDisbursed(e: {
    leaseId: string; projectId: string; amount: number; pending: number;
  }) {
    const [ctx, projectName, obligation] = await Promise.all([
      this.leaseContext(e.leaseId),
      this.projectName(e.projectId),
      this.prisma.leaseObligation.findFirst({
        where: { leaseId: e.leaseId, kind: 'TI_ALLOWANCE' },
        select: { id: true, totalAmount: true, paidAmount: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!obligation) return;
    await this.notifications.notifyTiDisbursed({
      projectId: e.projectId,
      projectName,
      leaseId: e.leaseId,
      obligationId: obligation.id,
      tenantName: ctx?.tenantName ?? 'a tenant',
      unitLabel: ctx?.unitLabel ?? null,
      amount: e.amount,
      totalPaid: Number(obligation.paidAmount),
      totalAgreed: Number(obligation.totalAmount),
    });
  }

  /**
   * R27. Routed by ROLE, deliberately not by project membership — a Founder who is not
   * staffed on the project is still the right person to decide whether history is erased.
   */
  private async onHistoryDeletionRequested(e: {
    requestId: string;
    leaseId: string;
    projectId: string | null;
    tenantName: string;
    reason: string;
    requestedById: string;
  }) {
    const [ctx, requester] = await Promise.all([
      this.leaseContext(e.leaseId),
      this.prisma.user.findUnique({ where: { id: e.requestedById }, select: { name: true } }),
    ]);
    await this.notifications.notifyHistoryDeletionRequested({
      requestId: e.requestId,
      leaseId: e.leaseId,
      projectId: e.projectId,
      tenantName: ctx?.tenantName ?? e.tenantName,
      unitLabel: ctx?.unitLabel ?? null,
      reason: e.reason,
      requestedByName: requester?.name ?? null,
      link: await this.unitLink(e.leaseId),
    });
  }

  private async onHistoryDeletionDecided(e: {
    leaseId: string;
    tenantName: string;
    approved: boolean;
    note?: string;
    requestedById: string;
  }) {
    await this.notifications.notifyHistoryDeletionDecided({
      requestedById: e.requestedById,
      tenantName: e.tenantName,
      approved: e.approved,
      note: e.note ?? null,
      link: await this.unitLink(e.leaseId),
    });
  }

  /**
   * Deep-link to the unit the record hangs off. Returns null rather than a half-built URL
   * when the lease is building-level or already gone — a notification with a dead link is
   * worse than one with none.
   */
  private async unitLink(leaseId: string) {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: { unit: { select: { id: true, building: { select: { projectId: true } } } } },
    });
    const unit = lease?.unit;
    if (!unit?.building?.projectId) return null;
    return `/projects/${unit.building.projectId}/units/${unit.id}`;
  }
}
