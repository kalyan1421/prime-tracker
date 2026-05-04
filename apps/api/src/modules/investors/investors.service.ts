import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CapitalCallStatus } from '@prisma/client';

@Injectable()
export class InvestorsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const investors = await this.prisma.investor.findMany({
      include: {
        positions: { include: { project: { select: { id: true, name: true } } } },
        capitalCalls: true,
        distributions: true,
      },
      orderBy: { name: 'asc' },
    });

    return investors.map((inv) => ({
      ...inv,
      totalCommitted: inv.positions.reduce((s, p) => s + p.committedAmt, 0),
      totalCalled: inv.positions.reduce((s, p) => s + p.calledAmt, 0),
      totalDistributions: inv.distributions.reduce((s, d) => s + d.amount, 0),
      projectCount: inv.positions.length,
    }));
  }

  async findById(id: string) {
    const inv = await this.prisma.investor.findUnique({
      where: { id },
      include: {
        positions: { include: { project: { select: { id: true, name: true } } } },
        capitalCalls: {
          include: { project: { select: { id: true, name: true } } },
          orderBy: { dueDate: 'desc' },
        },
        distributions: {
          include: { project: { select: { id: true, name: true } } },
          orderBy: { distDate: 'desc' },
        },
      },
    });
    if (!inv) throw new NotFoundException('Investor not found');
    return inv;
  }

  async getPortfolioSummary() {
    const investors = await this.findAll();
    const projects = await this.prisma.equityPosition.groupBy({
      by: ['projectId'],
      _sum: { committedAmt: true, calledAmt: true },
    });

    return {
      totalInvestors: investors.length,
      totalCommitted: investors.reduce((s, i) => s + i.totalCommitted, 0),
      totalCalled: investors.reduce((s, i) => s + i.totalCalled, 0),
      totalDistributions: investors.reduce((s, i) => s + i.totalDistributions, 0),
      byProject: projects,
    };
  }

  async create(data: any) {
    return this.prisma.investor.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        entityName: data.entityName,
      },
    });
  }

  async update(id: string, data: any) {
    const inv = await this.prisma.investor.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Investor not found');
    return this.prisma.investor.update({ where: { id }, data });
  }

  async addPosition(investorId: string, data: any) {
    const inv = await this.prisma.investor.findUnique({ where: { id: investorId } });
    if (!inv) throw new NotFoundException('Investor not found');
    return this.prisma.equityPosition.create({
      data: {
        investorId,
        projectId: data.projectId,
        pctOwnership: Number(data.pctOwnership),
        committedAmt: Number(data.committedAmt),
        calledAmt: 0,
      },
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async createCapitalCall(data: any) {
    const call = await this.prisma.capitalCall.create({
      data: {
        investorId: data.investorId,
        projectId: data.projectId,
        amount: Number(data.amount),
        dueDate: new Date(data.dueDate),
        status: CapitalCallStatus.PENDING,
        notes: data.notes,
      },
      include: {
        investor: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });
    return call;
  }

  async markCapitalCallPaid(id: string) {
    const call = await this.prisma.capitalCall.findUnique({ where: { id } });
    if (!call) throw new NotFoundException('Capital call not found');

    const updated = await this.prisma.capitalCall.update({
      where: { id },
      data: { status: CapitalCallStatus.PAID, paidDate: new Date() },
    });

    // Update calledAmt on equity position
    await this.prisma.equityPosition.updateMany({
      where: { investorId: call.investorId, projectId: call.projectId },
      data: { calledAmt: { increment: call.amount } },
    });

    return updated;
  }

  async createDistribution(data: any) {
    return this.prisma.distribution.create({
      data: {
        investorId: data.investorId,
        projectId: data.projectId,
        amount: Number(data.amount),
        distDate: new Date(data.distDate),
        distType: data.distType,
        notes: data.notes,
      },
      include: {
        investor: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });
  }
}
