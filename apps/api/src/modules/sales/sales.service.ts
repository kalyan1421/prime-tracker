import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';
import { EventBus } from '../../common/events/event-bus.service';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService, private bus: EventBus) {}

  async findByProject(projectId: string) {
    return this.prisma.sale.findMany({
      where: { projectId },
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
    if (!s) throw new NotFoundException('Sale not found');
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
    return this.prisma.sale.create({
      data: { ...data, lastActivityAt: new Date() },
    });
  }

  async update(id: string, data: Prisma.SaleUncheckedUpdateInput) {
    const sale = await this.findById(id);

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
    if (data.status === 'CLOSED' && sale.status !== 'CLOSED') {
      const commission = await this.computeBrokerCommission(sale, data);
      if (commission != null) dataWithActivity.brokerCommissionAmt = commission;
    }

    let result;
    if (data.status === 'CLOSED' && sale.unitId) {
      // Atomic: update sale + unit status in one transaction
      const [updated] = await this.prisma.$transaction([
        this.prisma.sale.update({ where: { id }, data: dataWithActivity }),
        this.prisma.unit.update({
          where: { id: sale.unitId },
          // Sale closed → unit becomes SOLD; clear time-on-market
          data: { status: 'SOLD', availableSince: null },
        }),
      ]);
      result = updated;
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
        const [updated] = await this.prisma.$transaction([
          this.prisma.sale.update({ where: { id }, data: dataWithActivity }),
          this.prisma.unit.update({
            where: { id: sale.unitId },
            data: { status: 'AVAILABLE', availableSince: new Date() },
          }),
        ]);
        result = updated;
      } else {
        result = await this.prisma.sale.update({ where: { id }, data: dataWithActivity });
      }
    } else {
      result = await this.prisma.sale.update({ where: { id }, data: dataWithActivity });
    }

    if (data.status && data.status !== sale.status) {
      this.bus.emit({
        type: 'sale.statusChanged',
        saleId: id,
        from: sale.status,
        to: data.status as string,
      });
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

    const pctRaw = (data.brokerCommissionPct as any) ?? sale.brokerCommissionPct ?? broker.commissionRate;
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

  async delete(id: string, userRole: UserRole) {
    const sale = await this.findById(id);
    if (sale.status === 'CLOSED' && !['FOUNDER', 'SUPER_ADMIN'].includes(userRole)) {
      throw new ForbiddenException('Closed sales can only be deleted by Founder or Super Admin');
    }
    return this.prisma.sale.delete({ where: { id } });
  }
}
