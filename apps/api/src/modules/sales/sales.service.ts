import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

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
    // Guard: unitId must belong to the same project
    const unit = await this.prisma.unit.findUnique({
      where: { id: data.unitId as string },
      include: { building: { select: { projectId: true } } },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    if (unit.building.projectId !== data.projectId) {
      throw new BadRequestException('Unit does not belong to this project');
    }
    return this.prisma.sale.create({ data });
  }

  async update(id: string, data: Prisma.SaleUncheckedUpdateInput) {
    const sale = await this.findById(id);

    if (data.status === 'CLOSED' && sale.unitId) {
      // Atomic: update sale + unit status in one transaction
      const [updated] = await this.prisma.$transaction([
        this.prisma.sale.update({ where: { id }, data }),
        this.prisma.unit.update({ where: { id: sale.unitId }, data: { status: 'SOLD' } }),
      ]);
      return updated;
    }
    return this.prisma.sale.update({ where: { id }, data });
  }

  async delete(id: string, userRole: UserRole) {
    const sale = await this.findById(id);
    if (sale.status === 'CLOSED' && !['FOUNDER', 'SUPER_ADMIN'].includes(userRole)) {
      throw new ForbiddenException('Closed sales can only be deleted by Founder or Super Admin');
    }
    return this.prisma.sale.delete({ where: { id } });
  }
}
