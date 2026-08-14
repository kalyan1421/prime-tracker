import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';
import { EventBus } from '../../common/events/event-bus.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';
import { LeasesService } from '../leases/leases.service';
import { startOfUtcDay } from '../leases/lease-rent-period.service';

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
    private statusEvents: UnitStatusEventService,
    private leases: LeasesService,
  ) {}

  /**
   * A closing date is the real-world moment a unit changed hands, so the occupancy
   * event should carry it rather than the wall-clock time someone typed it in. Falls
   * back to now when the date is absent or unparseable.
   */
  private toDateOrNow(value: unknown): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string') {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  }

  async findByProject(projectId: string) {
    return this.prisma.sale.findMany({
      where: { projectId, deletedAt: null },
      include: { unit: { include: { building: { select: { name: true } } } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getPipeline(projectId: string) {
    const sales = await this.findByProject(projectId);
    const byStatus: Record<string, any[]> = {};
    for (const s of sales) {
      (byStatus[s.status] ??= []).push(s);
    }

    // Sales velocity: avg days from creation to close for CLOSED sales
    const closed = sales.filter((s) => s.status === 'CLOSED' && s.closingDate);
    const avgDaysToClose = closed.length > 0
      ? Math.round(
          closed.reduce((sum, s) => {
            const days = (new Date(s.closingDate!).getTime() - new Date(s.createdAt).getTime())
              / (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / closed.length,
        )
      : null;

    const totalPipelineValue = sales
      .filter((s) => !['CLOSED', 'CANCELLED'].includes(s.status))
      .reduce((sum, s) => sum + Number(s.salePrice || 0), 0);

    const closedRevenue = closed.reduce((sum, s) => sum + Number(s.salePrice || 0), 0);

    return { byStatus, avgDaysToClose, totalPipelineValue, closedRevenue };
  }

  async findById(id: string) {
    const s = await this.prisma.sale.findUnique({ where: { id }, include: { unit: true } });
    if (!s || s.deletedAt) throw new NotFoundException('Sale not found');
    return s;
  }

  async create(data: Prisma.SaleUncheckedCreateInput) {
    // Sprint 1: Sales can attach to either a Unit (typical) or a Building (e.g.
    // Leander Bldg 1 sold as one asset). Exactly one of (unitId, buildingId)
    // must be set, and the chosen asset must live under data.projectId.
    const unitId = data.unitId as string | undefined;
    const buildingId = data.buildingId as string | undefined;
    if (!unitId && !buildingId) {
      throw new BadRequestException('Sale must reference either a unit or a building');
    }
    if (unitId && buildingId) {
      throw new BadRequestException('Sale cannot reference both a unit and a building');
    }
    if (unitId) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: unitId },
        include: { building: { select: { projectId: true } } },
      });
      if (!unit) throw new NotFoundException('Unit not found');
      if (unit.building.projectId !== data.projectId) {
        throw new BadRequestException('Unit does not belong to this project');
      }
    } else if (buildingId) {
      const building = await this.prisma.building.findUnique({
        where: { id: buildingId },
        select: { projectId: true },
      });
      if (!building) throw new NotFoundException('Building not found');
      if (building.projectId !== data.projectId) {
        throw new BadRequestException('Building does not belong to this project');
      }
    }
    // class-validator's @IsDateString() accepts a bare "YYYY-MM-DD" date, but Prisma's
    // DateTime columns need a full ISO-8601 datetime — pass Date objects so Prisma
    // serializes them correctly instead of erroring "premature end of input".
    for (const field of ['loiDate', 'contractDate', 'closingDate'] as const) {
      if (typeof data[field] === 'string') (data as any)[field] = new Date(data[field] as unknown as string);
    }
    // A sale can be CREATED already CLOSED — the units flow does exactly that when a
    // user flips a unit to SOLD and fills in the deal. update() gates that transition
    // on founder discount sign-off and stamps broker commission; create() must apply
    // the same rules, or "create as CLOSED" becomes a way around both.
    const createdClosed = data.status === 'CLOSED';
    if (createdClosed) {
      await this.assertDiscountApproved({
        projectId: data.projectId as string,
        unitId: (data.unitId as string | undefined) ?? null,
        salePrice: (data.salePrice as Prisma.Decimal | undefined) ?? null,
        discountApprovedAt: (data.discountApprovedAt as Date | undefined) ?? null,
      });
      const commission = await this.computeBrokerCommission(
        {
          brokerId: (data.brokerId as string | undefined) ?? null,
          salePrice: data.salePrice,
          brokerCommissionPct: data.brokerCommissionPct,
        },
        data as Prisma.SaleUncheckedUpdateInput,
      );
      if (commission != null) (data as any).brokerCommissionAmt = commission;
    }

    const created = await this.prisma.sale.create({
      data: { ...data, lastActivityAt: new Date() },
    });

    // Emit for the same reason: a sale born CLOSED is still a sale that closed, and
    // Finance/Accounting learn about it through these events.
    if (createdClosed) {
      this.bus.emit({ type: 'sale.statusChanged', saleId: created.id, from: 'NEW', to: 'CLOSED' });
      if (created.unitId && created.projectId) {
        this.bus.emit({
          type: 'unit.sold',
          unitId: created.unitId,
          saleId: created.id,
          projectId: created.projectId,
        });
      }
    }
    return created;
  }

  async update(
    id: string,
    data: Prisma.SaleUncheckedUpdateInput,
    /** Stamped onto any occupancy event this update causes. */
    updatedById?: string,
  ) {
    const sale = await this.findById(id);
    for (const field of ['loiDate', 'contractDate', 'closingDate'] as const) {
      if (typeof data[field] === 'string') (data as any)[field] = new Date(data[field] as unknown as string);
    }

    // Slice 6: lostReason is captured on cancel — defaulted to OTHER if the caller
    // omits it so legacy clients don't break. The forced-picker UX lives in the
    // frontend; backend stays lenient to preserve API compatibility.
    const dataWithReason: Prisma.SaleUncheckedUpdateInput = { ...data };
    if (data.status === 'CANCELLED' && sale.status !== 'CANCELLED' && !data.lostReason) {
      dataWithReason.lostReason = 'OTHER';
    }

    // Always bump lastActivityAt on any update — drives the activity-drought cron.
    const dataWithActivity = { ...dataWithReason, lastActivityAt: new Date() };

    // Emit status-change so handlers can react (notifications, analytics)
    if (data.status && data.status !== sale.status) {
      // emit AFTER successful write — see below
    }

    const cancelling = data.status === 'CANCELLED' && sale.status !== 'CANCELLED';

    // Discount-approval gate: committing a sale (UNDER_CONTRACT/CLOSED) with an over-threshold
    // discount requires Founder/Co-Founder sign-off first. Single approval (client decision).
    const committing =
      (data.status === 'UNDER_CONTRACT' || data.status === 'CLOSED') && data.status !== sale.status;
    if (committing) {
      await this.assertDiscountApproved(sale);
    }

    // Broker commission is earned when the sale CLOSES — compute + stamp the amount.
    // Also recompute when an ALREADY-CLOSED sale's broker/commission%/price is edited
    // afterward (e.g. correcting the record from the unit page) — otherwise the
    // stamped commission goes stale the moment any of its inputs changes post-close.
    const closingNow = data.status === 'CLOSED' && sale.status !== 'CLOSED';
    const editingClosedCommissionInputs =
      sale.status === 'CLOSED' &&
      (data.brokerId !== undefined || data.brokerCommissionPct !== undefined || data.salePrice !== undefined);
    if (closingNow || editingClosedCommissionInputs) {
      if (data.brokerId === null) {
        // Broker explicitly cleared. computeBrokerCommission's `data.brokerId ?? sale.brokerId`
        // can't tell "cleared" apart from "omitted" — both fall through to the old value —
        // so handle the clear here rather than asking it to compute against a broker
        // that was just removed.
        dataWithActivity.brokerCommissionAmt = null;
      } else {
        const commission = await this.computeBrokerCommission(sale, data);
        if (commission != null) {
          dataWithActivity.brokerCommissionAmt = commission;
        } else if (editingClosedCommissionInputs) {
          // Nothing computable — the broker carries neither a rate nor a flat fee, or
          // there's no price. An already-closed sale may still hold an amount stamped
          // from the previous broker/rate, so leaving it untouched would keep a figure
          // the current inputs no longer support. On the closingNow path there is
          // nothing stale to clear, and a close with no computable commission must
          // stay unstamped.
          dataWithActivity.brokerCommissionAmt = null;
        }
      }
    }

    let result;
    // Did THIS request actually perform the status transition? Only the optimistic-locked
    // CLOSE path can lose (a concurrent CLOSE beat us to the write); every other path
    // writes unconditionally and therefore always applies. Events must be gated on this,
    // not on the pre-transaction snapshot — otherwise two concurrent CLOSEs both read
    // status=UNDER_CONTRACT and both emit, double-notifying every recipient.
    let applied = true;
    // Set inside the transaction, emitted after it commits — a notification must not go
    // out for a tenancy that rolled back with its sale. Plural because a unit can hold
    // more than one tenancy in occupation (see the findMany below).
    let endedLeases: { id: string; tenantName: string }[] = [];
    if (data.status === 'CLOSED' && sale.unitId) {
      const unitId = sale.unitId;
      // Atomic + optimistic-locked: only the NOT_CLOSED→CLOSED transition stamps the broker
      // commission and flips the unit. Guarding the write on `status != CLOSED` means a
      // concurrent CLOSE finds 0 rows and skips re-stamping brokerCommissionAmt.
      const outcome = await this.prisma.$transaction(async (tx) => {
        const guard = await tx.sale.updateMany({
          where: { id, status: { not: 'CLOSED' } },
          data: dataWithActivity,
        });
        if (guard.count === 0) {
          // Lost the race — already CLOSED elsewhere. Return current row, no side effects.
          return { sale: await tx.sale.findUniqueOrThrow({ where: { id } }), applied: false };
        }
        // Read the prior status inside the transaction so the occupancy event records
        // what the unit actually moved FROM. Reading it outside would race the very
        // concurrent close the optimistic lock above exists to defend against.
        const before = await tx.unit.findUniqueOrThrow({
          where: { id: unitId },
          select: { status: true },
        });
        await tx.unit.update({
          where: { id: unitId },
          // Sale closed → unit becomes SOLD; clear time-on-market
          data: { status: 'SOLD', availableSince: null },
        });
        // Only the request that won the lock reaches here, so the event is written
        // exactly once — same guarantee the `applied` flag gives the emitted events.
        await this.statusEvents.recordIfChanged(
          {
            unitId,
            fromStatus: before.status,
            toStatus: 'SOLD',
            source: 'SALE_CLOSED',
            saleId: id,
            effectiveAt: this.toDateOrNow(dataWithActivity.closingDate ?? sale.closingDate),
            recordedById: updatedById,
          },
          tx,
        );

        // A sale ENDS every tenancy the unit is carrying (H3). Until this existed, closing
        // a sale flipped the unit to SOLD and left the lease ACTIVE — only the billing
        // cron's sold-unit filter stopped the departed tenant being invoiced, and the unit
        // read SOLD with a tenancy still running.
        //
        // In the SAME transaction on purpose: sold-with-a-live-lease is exactly the
        // inconsistency both halves exist to prevent, so it must not be reachable by one
        // half succeeding. If a tenancy cannot be ended — rent collected past the
        // closing date — the CLOSE fails too, which is the honest outcome: that is a real
        // conflict a person has to resolve, not something to close around.
        //
        // Assumes the SITTING TENANT BOUGHT, which is the client-confirmed v1 rule. A
        // third-party sale of a tenanted unit would need the lease to survive the sale.
        //
        // findMany, not findFirst: a unit can legitimately hold MORE THAN ONE
        // non-terminated lease right now. assertNoOverlappingLease permits a lease
        // starting the day another ends, and the unit state machine allows
        // LEASED → LEASE_PENDING precisely so a successor can be signed while the sitting
        // tenant is still in occupation. Ending only the newest row left the older,
        // still-occupying tenancy ACTIVE on a unit now reading SOLD.
        const closingDate = this.toDateOrNow(dataWithActivity.closingDate ?? sale.closingDate);
        const live = await tx.lease.findMany({
          where: {
            unitId,
            deletedAt: null,
            terminationDate: null,
            status: { notIn: ['EXPIRED', 'TERMINATED'] },
          },
          orderBy: { leaseStart: 'asc' },
          select: { id: true, tenantName: true, leaseStart: true },
        });

        // Only tenancies IN OCCUPATION on the closing date are ended by the sale (spec
        // R4). A lease drafted to start later has nothing to end — endTenancyWithin
        // rejects a termination dated before the lease start, so reaching for it would
        // surface as a baffling "move-out date cannot be before the lease start date".
        //
        // Those future leases are deliberately left ALONE here, and the close is never
        // blocked by one (R4). That is not the end of the story: a lease drafted for a
        // unit Prime no longer owns is a commitment nobody can honour, and R4 requires the
        // user be told it exists and asked what to do with it. That question belongs in
        // the close dialog, which is a later phase — not silently answered by this method.
        const closingDay = startOfUtcDay(closingDate);
        const occupying = live.filter((l) => startOfUtcDay(l.leaseStart) <= closingDay);

        // ALL of them end with the sale, oldest leaseStart first so the outcome does not
        // depend on row order.
        endedLeases = occupying.map((l) => ({ id: l.id, tenantName: l.tenantName }));
        for (const lease of occupying) {
          await this.leases.endTenancyWithin(
            tx,
            lease.id,
            {
              terminationDate: closingDate,
              terminationReason: 'TENANT_BOUGHT',
              terminationNote: 'Ended automatically when the sale of this unit closed.',
            },
            updatedById,
          );
        }

        return { sale: await tx.sale.findUniqueOrThrow({ where: { id } }), applied: true };
      });
      result = outcome.sale;
      applied = outcome.applied;
    } else if (cancelling && sale.unitId) {
      // Cancelling a sale must RELEASE the unit it was holding, or the unit stays stuck
      // in UNDER_CONTRACT forever (backend-issue #1). Only flip a unit that was *reserved*
      // by this sale — never override a SOLD/LEASED/OCCUPIED unit. Restart time-on-market.
      // (Refund/penalty handling is a separate, client-defined flow — discovery item D18.)
      const unit = await this.prisma.unit.findUnique({
        where: { id: sale.unitId },
        select: { status: true },
      });
      const reserved = unit && ['UNDER_CONTRACT', 'LEASE_PENDING'].includes(unit.status);
      if (reserved) {
        // Interactive transaction rather than the array form this used to use: the
        // occupancy event needs the unit's prior status, and array-form operations
        // cannot read a value produced inside the same transaction.
        const unitId = sale.unitId;
        result = await this.prisma.$transaction(async (tx) => {
          const updated = await tx.sale.update({ where: { id }, data: dataWithActivity });
          const before = await tx.unit.findUniqueOrThrow({
            where: { id: unitId },
            select: { status: true },
          });
          await tx.unit.update({
            where: { id: unitId },
            data: { status: 'AVAILABLE', availableSince: new Date() },
          });
          await this.statusEvents.recordIfChanged(
            {
              unitId,
              fromStatus: before.status,
              toStatus: 'AVAILABLE',
              source: 'SALE_CANCELLED',
              saleId: id,
              reason: 'Sale cancelled — reserved unit released back to market',
              recordedById: updatedById,
            },
            tx,
          );
          return updated;
        });
      } else {
        result = await this.prisma.sale.update({ where: { id }, data: dataWithActivity });
      }
    } else {
      result = await this.prisma.sale.update({ where: { id }, data: dataWithActivity });
    }

    // A tenancy ended by a sale must notify on exactly the same footing as one ended by
    // hand through LeasesService.endTenancy (spec R5) — otherwise the alert depends on
    // which door was used, and the sale door is the silent one. endTenancyWithin emits
    // nothing by design (the caller's transaction may still roll back), so the emit is
    // this method's job, here: after the commit, and only for a close that actually
    // applied. Same event shape as endTenancy's, and projectId comes from the sale for
    // the same reason unit.sold's does — the lease is on the sale's own unit.
    if (applied && sale.projectId) {
      for (const lease of endedLeases) {
        this.bus.emit({
          type: 'lease.terminated',
          leaseId: lease.id,
          projectId: sale.projectId,
          tenantName: lease.tenantName,
          reason: 'TENANT_BOUGHT',
        });
      }
    }

    // `applied` (not the stale pre-read snapshot) is what makes these events fire exactly
    // once: the request that lost the optimistic lock changed nothing, so announcing a
    // transition it didn't make would double-notify — and its `from` is stale besides.
    if (applied && data.status && data.status !== sale.status) {
      this.bus.emit({
        type: 'sale.statusChanged',
        saleId: id,
        from: sale.status,
        to: data.status as string,
      });
      // A unit flipping to SOLD is the event Finance/Sales/Accounting actually care
      // about — distinct from a sale merely changing stage. Only emitted for
      // unit-level sales; a building-level sale has no unit to flip.
      if (data.status === 'CLOSED' && sale.status !== 'CLOSED' && sale.unitId && sale.projectId) {
        this.bus.emit({
          type: 'unit.sold',
          unitId: sale.unitId,
          saleId: id,
          projectId: sale.projectId,
        });
      }
    }
    return result;
  }

  /** Founder/Co-Founder records sign-off on an over-threshold discount. */
  async approveDiscount(id: string, userId: string) {
    await this.findById(id); // 404 if missing
    return this.prisma.sale.update({
      where: { id },
      data: { discountApprovedById: userId, discountApprovedAt: new Date() },
    });
  }

  /** Throws if the sale carries an over-threshold, un-approved discount vs the unit's asking price. */
  private async assertDiscountApproved(sale: {
    projectId: string;
    unitId: string | null;
    salePrice: Prisma.Decimal | null;
    discountApprovedAt: Date | null;
  }) {
    if (sale.discountApprovedAt) return; // already signed off
    if (!sale.unitId || sale.salePrice == null) return; // can't compute (building-level / no price)

    const unit = await this.prisma.unit.findUnique({
      where: { id: sale.unitId },
      select: { askingPrice: true },
    });
    const asking = unit?.askingPrice != null ? Number(unit.askingPrice) : null;
    const salePrice = Number(sale.salePrice);
    if (!asking || asking <= 0 || salePrice >= asking) return; // no discount

    const discountPct = ((asking - salePrice) / asking) * 100;
    const threshold = await this.resolveDiscountThreshold(sale.projectId);
    if (discountPct > threshold) {
      throw new ForbiddenException(
        `This sale's ${discountPct.toFixed(1)}% discount exceeds the ${threshold}% threshold and requires ` +
          `Founder/Co-Founder approval before it can be committed.`,
      );
    }
  }

  /**
   * Commission earned by the attributed broker when the sale closes.
   * Precedence: per-sale % override → broker default % (× salePrice) → broker flat fee.
   * Returns undefined when there's no broker or nothing to compute.
   */
  private async computeBrokerCommission(
    sale: { brokerId: string | null; salePrice: any; brokerCommissionPct: any },
    data: Prisma.SaleUncheckedUpdateInput,
  ): Promise<number | undefined> {
    const brokerId = (data.brokerId as string | undefined) ?? sale.brokerId ?? undefined;
    if (!brokerId) return undefined;
    const broker = await this.prisma.broker.findUnique({
      where: { id: brokerId },
      select: { commissionRate: true, commissionFlat: true },
    });
    if (!broker) return undefined;

    // An explicit null means the per-sale override was CLEARED, which is not the same as
    // omitting it (undefined), where the sale's existing override still stands. Without
    // this the `??` chain falls straight through to the value just deleted, recomputing
    // the amount from an override the row no longer has. Cleared → drop to the next rung
    // of the documented precedence: per-sale override → broker rate → flat fee.
    const pctCleared = data.brokerCommissionPct === null;
    const pctRaw = pctCleared
      ? broker.commissionRate
      : (data.brokerCommissionPct as any) ?? sale.brokerCommissionPct ?? broker.commissionRate;
    const priceRaw = (data.salePrice as any) ?? sale.salePrice;
    const salePrice = priceRaw != null ? Number(priceRaw) : null;

    if (pctRaw != null && salePrice != null) return (salePrice * Number(pctRaw)) / 100;
    if (broker.commissionFlat != null) return Number(broker.commissionFlat);
    return undefined;
  }

  private async resolveDiscountThreshold(projectId: string): Promise<number> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (project?.orgId) {
      const settings = await this.prisma.orgSettings.findUnique({
        where: { orgId: project.orgId },
        select: { discountApprovalThresholdPct: true },
      });
      if (settings?.discountApprovalThresholdPct != null) {
        return Number(settings.discountApprovalThresholdPct);
      }
    }
    return 5; // default until the org configures a threshold
  }

  // Soft-delete — preserves the row (and the unit's history) instead of destroying it.
  async delete(id: string, userRole: UserRole) {
    const sale = await this.findById(id);
    if (sale.status === 'CLOSED' && !['FOUNDER', 'SUPER_ADMIN'].includes(userRole)) {
      throw new ForbiddenException('Closed sales can only be deleted by Founder or Super Admin');
    }
    return this.prisma.sale.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
