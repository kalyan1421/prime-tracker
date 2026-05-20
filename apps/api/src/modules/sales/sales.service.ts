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

  async delete(id: string, userRole: UserRole) {
    const sale = await this.findById(id);
    if (sale.status === 'CLOSED' && !['FOUNDER', 'SUPER_ADMIN'].includes(userRole)) {
      throw new ForbiddenException('Closed sales can only be deleted by Founder or Super Admin');
    }
    return this.prisma.sale.delete({ where: { id } });
  }
}
