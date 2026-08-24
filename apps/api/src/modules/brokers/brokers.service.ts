import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommissionInstallmentService } from '../../common/utils/commission-installment.service';

/**
 * Broker / referral tracking — internal-only (brokers have no login). Brokers bring
 * leads; commission is earned when an attributed sale closes (the SalesService stamps
 * Sale.brokerCommissionAmt on close). This service owns broker CRUD + the performance report.
 */
@Injectable()
export class BrokersService {
  constructor(
    private prisma: PrismaService,
    private commissionInstallments: CommissionInstallmentService,
  ) {}

  findAll(includeInactive = false) {
    return this.prisma.broker.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
      include: { _count: { select: { leads: true, sales: true } } },
    });
  }

  async findById(id: string) {
    const broker = await this.prisma.broker.findFirst({
      where: { id, deletedAt: null },
      include: {
        leads: {
          select: { id: true, name: true, status: true, projectId: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        sales: {
          select: { id: true, buyer: true, salePrice: true, status: true, brokerCommissionAmt: true, closingDate: true },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!broker) throw new NotFoundException('Broker not found');
    return broker;
  }

  async create(input: {
    name: string;
    company?: string;
    email?: string;
    phone?: string;
    commissionRate?: number;
    commissionFlat?: number;
    notes?: string;
  }) {
    if (!input.name?.trim()) throw new BadRequestException('Broker name is required');
    return this.prisma.broker.create({
      data: {
        name: input.name.trim(),
        company: input.company,
        email: input.email,
        phone: input.phone,
        commissionRate: input.commissionRate ?? null,
        commissionFlat: input.commissionFlat ?? null,
        notes: input.notes,
      },
    });
  }

  async update(
    id: string,
    input: {
      name?: string;
      company?: string;
      email?: string;
      phone?: string;
      commissionRate?: number;
      commissionFlat?: number;
      notes?: string;
      isActive?: boolean;
    },
  ) {
    await this.findById(id);
    return this.prisma.broker.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        company: input.company,
        email: input.email,
        phone: input.phone,
        commissionRate: input.commissionRate,
        commissionFlat: input.commissionFlat,
        notes: input.notes,
        isActive: input.isActive,
      },
    });
  }

  async remove(id: string) {
    await this.findById(id);
    // Soft-delete; leads/sales keep their brokerId for historical reporting.
    return this.prisma.broker.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Per-broker performance: leads brought, closed sales, closed value, commission earned,
   * and lead→close conversion. Powers the broker report screen.
   */
  async report() {
    // Four grouped queries — aggregate per broker, then join in memory.
    const [
      brokers, leadGroups, saleGroups, paidGroups, pipelineGroups,
      leaseGroups, leasePaidGroups,
    ] = await Promise.all([
      this.prisma.broker.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      this.prisma.lead.groupBy({
        by: ['brokerId'],
        where: { brokerId: { not: null } },
        _count: true,
      }),
      this.prisma.sale.groupBy({
        by: ['brokerId'],
        where: { brokerId: { not: null }, status: 'CLOSED', deletedAt: null },
        _count: true,
        _sum: { salePrice: true, brokerCommissionAmt: true },
      }),
      // Paid: R7 — summed from actual installments marked paid, not an all-or-nothing
      // flag on the sale. A commission paid in two parts with only the first settled now
      // shows exactly that first amount as paid, not the whole figure or nothing.
      this.prisma.commissionInstallment.groupBy({
        by: ['brokerId'],
        where: {
          saleId: { not: null },
          paidAt: { not: null },
          sale: { status: 'CLOSED', deletedAt: null },
        },
        _sum: { amount: true },
      }),
      // Pipeline: UNDER_CONTRACT and LOI_SIGNED sales
      this.prisma.sale.groupBy({
        by: ['brokerId'],
        where: {
          brokerId: { not: null },
          status: { in: ['UNDER_CONTRACT', 'LOI_SIGNED'] },
          deletedAt: null,
        },
        _sum: { salePrice: true },
      }),
      // Leasing commission (R23). Kept as its OWN pair of columns rather than added
      // into the sale totals: a sale commission is a one-off on a disposal and a
      // leasing fee is earned on a tenancy, so a broker's "commission earned" summed
      // across both would not reconcile to either side's ledger. Both are shown, plus
      // a total, and the caller can use whichever it needs.
      //
      // Filtered on "a commission was stamped", NOT on status: 'ACTIVE'. ACTIVE is a
      // state a lease LEAVES — endTenancy flips it to EXPIRED when the term runs out —
      // so an ACTIVE filter made an unpaid $18k fee silently drop out of both the earned
      // and the owed columns the day the tenancy ended, and the report then showed Prime
      // owing the broker nothing on a debt that was still real. The sale-side queries
      // above filter on CLOSED, a TERMINAL state, which is why they never had this bug.
      //
      // brokerCommissionAmt is stamped once, at activation (LeasesService.computeBroker-
      // Commission on the activatingNow path), so "amount is not null" means "this lease
      // went live and earned a fee" — it excludes DRAFT leases that never activated and
      // keeps EXPIRED/TERMINATED ones where the money was genuinely earned.
      this.prisma.lease.groupBy({
        by: ['brokerId'],
        where: { brokerId: { not: null }, brokerCommissionAmt: { not: null }, deletedAt: null },
        _count: true,
        _sum: { brokerCommissionAmt: true, monthlyRent: true },
      }),
      // Leasing paid side of R7 — same installment-sum reasoning as the sale side above.
      this.prisma.commissionInstallment.groupBy({
        by: ['brokerId'],
        where: {
          leaseId: { not: null },
          paidAt: { not: null },
          lease: { deletedAt: null },
        },
        _sum: { amount: true },
      }),
    ]);

    const leadsByBroker = new Map(leadGroups.map((g) => [g.brokerId, g._count]));
    const salesByBroker = new Map(saleGroups.map((g) => [g.brokerId, g]));
    const paidByBroker = new Map(paidGroups.map((g) => [g.brokerId, Number(g._sum.amount ?? 0)]));
    const pipelineByBroker = new Map(pipelineGroups.map((g) => [g.brokerId, Number(g._sum.salePrice ?? 0)]));
    const leasesByBroker = new Map(leaseGroups.map((g) => [g.brokerId, g]));
    const leasePaidByBroker = new Map(
      leasePaidGroups.map((g) => [g.brokerId, Number(g._sum.amount ?? 0)]),
    );

    return brokers.map((b) => {
      const leads = leadsByBroker.get(b.id) ?? 0;
      const closed = salesByBroker.get(b.id);
      const closedSales = closed?._count ?? 0;
      const commissionEarned = Number(closed?._sum.brokerCommissionAmt ?? 0);
      const commissionPaid = paidByBroker.get(b.id) ?? 0;
      const leased = leasesByBroker.get(b.id);
      const leasesSigned = leased?._count ?? 0;
      const leaseCommissionEarned = Number(leased?._sum.brokerCommissionAmt ?? 0);
      const leaseCommissionPaid = leasePaidByBroker.get(b.id) ?? 0;
      const pipelineValue = pipelineByBroker.get(b.id) ?? 0;
      const rate = b.commissionRate != null ? Number(b.commissionRate) : null;
      return {
        brokerId: b.id,
        name: b.name,
        company: b.company,
        commissionRate: rate,
        commissionFlat: b.commissionFlat != null ? Number(b.commissionFlat) : null,
        leads,
        closedSales,
        closedValue: Number(closed?._sum.salePrice ?? 0),
        commissionEarned,
        conversionPct: leads > 0 ? Math.round((closedSales / leads) * 100) : 0,
        commissionPaid,
        commissionOwed: commissionEarned - commissionPaid,
        // ---- Leasing side (R23) ----
        // Lifetime, not current: both of these now count every lease the broker signed
        // that reached activation, including ones whose term has since ended. That is
        // what "signed" means, and it is the only basis on which the commission columns
        // beside them reconcile.
        leasesSigned,
        // Renamed from `leasedMonthlyRent` — that name read as "rent currently being
        // collected on this broker's leases", which is no longer what it holds. This is
        // the contracted monthly rent summed across every lease they signed.
        signedMonthlyRent: Number(leased?._sum.monthlyRent ?? 0),
        leaseCommissionEarned,
        leaseCommissionPaid,
        leaseCommissionOwed: leaseCommissionEarned - leaseCommissionPaid,
        // Convenience totals across both sides, so a caller wanting "what do we owe
        // this broker in all" does not have to know the split exists.
        totalCommissionEarned: commissionEarned + leaseCommissionEarned,
        totalCommissionOwed:
          (commissionEarned - commissionPaid) + (leaseCommissionEarned - leaseCommissionPaid),
        pipelineValue,
        pipelineCommissionEst: rate != null ? Math.round(pipelineValue * rate / 100 * 100) / 100 : null,
      };
    });
  }

  /**
   * Per-broker sale drilldown — up to 100 sales attributed to the given broker,
   * with unit/building context. Used by the broker detail view.
   */
  async getSalesByBroker(brokerId: string) {
    const broker = await this.prisma.broker.findFirst({ where: { id: brokerId, deletedAt: null } });
    if (!broker) throw new NotFoundException('Broker not found');

    return this.prisma.sale.findMany({
      where: { brokerId, deletedAt: null },
      select: {
        id: true,
        buyer: true,
        salePrice: true,
        status: true,
        brokerCommissionAmt: true,
        brokerCommissionPct: true,
        brokerCommissionPaidAt: true,
        closingDate: true,
        projectId: true,
        unit: {
          select: {
            unitNumber: true,
            building: { select: { name: true } },
          },
        },
        // R7 — per-installment breakdown, so a drilldown can show "1 of 2 paid" instead
        // of the single paid/unpaid flag above (kept for backward compatibility only).
        commissionInstallments: {
          select: { id: true, sequence: true, amount: true, paidAt: true, notes: true },
          orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Settle a sale's broker commission in full: pays off every outstanding installment
   * (R7) and, for backward compatibility with anything still reading the flat field,
   * also stamps brokerCommissionPaidAt. Throws if the sale is not found or has no
   * broker attached.
   */
  async markCommissionPaid(saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, deletedAt: null },
      select: { id: true, brokerId: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    if (!sale.brokerId) throw new NotFoundException('Sale has no broker assigned');

    await this.commissionInstallments.settleAll({ saleId });
    return this.prisma.sale.update({
      where: { id: saleId },
      data: { brokerCommissionPaidAt: new Date() },
      select: {
        id: true,
        brokerId: true,
        brokerCommissionAmt: true,
        brokerCommissionPaidAt: true,
        commissionInstallments: {
          select: { id: true, sequence: true, amount: true, paidAt: true },
          orderBy: [{ sequence: 'asc' }],
        },
      },
    });
  }

  /**
   * Per-broker LEASE drilldown — the leasing counterpart to getSalesByBroker.
   * Same shape and same cap, so the broker detail view can render the two side by side.
   */
  async getLeasesByBroker(brokerId: string) {
    const broker = await this.prisma.broker.findFirst({ where: { id: brokerId, deletedAt: null } });
    if (!broker) throw new NotFoundException('Broker not found');

    return this.prisma.lease.findMany({
      where: { brokerId, deletedAt: null },
      select: {
        id: true,
        tenantName: true,
        tenantBrand: true,
        status: true,
        monthlyRent: true,
        termMonths: true,
        leaseStart: true,
        leaseEnd: true,
        brokerCommissionAmt: true,
        brokerCommissionPct: true,
        brokerCommissionBasis: true,
        brokerCommissionPaidAt: true,
        unit: {
          select: {
            unitNumber: true,
            building: { select: { name: true, projectId: true } },
          },
        },
        // R7 — see the matching note on getSalesByBroker.
        commissionInstallments: {
          select: { id: true, sequence: true, amount: true, paidAt: true, notes: true },
          orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Settle a leasing commission in full — the leasing counterpart to markCommissionPaid.
   * Separate from the sale version because the two live on different tables; sharing one
   * endpoint would mean guessing which id was passed, and a wrong guess silently marks
   * the wrong deal as settled.
   */
  async markLeaseCommissionPaid(leaseId: string) {
    const lease = await this.prisma.lease.findFirst({
      where: { id: leaseId, deletedAt: null },
      select: { id: true, brokerId: true },
    });
    if (!lease) throw new NotFoundException('Lease not found');
    if (!lease.brokerId) throw new NotFoundException('Lease has no broker assigned');

    await this.commissionInstallments.settleAll({ leaseId });
    return this.prisma.lease.update({
      where: { id: leaseId },
      data: { brokerCommissionPaidAt: new Date() },
      select: {
        id: true,
        brokerId: true,
        brokerCommissionAmt: true,
        brokerCommissionPaidAt: true,
        commissionInstallments: {
          select: { id: true, sequence: true, amount: true, paidAt: true },
          orderBy: [{ sequence: 'asc' }],
        },
      },
    });
  }

  // ─────── Commission installments (R7) ───────

  /** List installments for a sale or lease. Exactly one of the two ids is provided. */
  getCommissionInstallments(target: { saleId?: string; leaseId?: string }) {
    return this.commissionInstallments.list(target);
  }

  /** Add a new installment (e.g. a "2nd payment") to a sale or lease's commission. */
  async addCommissionInstallment(
    target: { saleId?: string; leaseId?: string },
    input: { amount: number; paidAt?: Date | null; notes?: string },
  ) {
    const brokerId = target.saleId
      ? (await this.prisma.sale.findFirst({ where: { id: target.saleId }, select: { brokerId: true } }))?.brokerId
      : (await this.prisma.lease.findFirst({ where: { id: target.leaseId }, select: { brokerId: true } }))?.brokerId;
    if (!brokerId) throw new BadRequestException('This deal has no broker assigned');
    return this.commissionInstallments.add(target, { ...input, brokerId });
  }

  markCommissionInstallmentPaid(id: string, paidAt?: Date) {
    return this.commissionInstallments.markPaid(id, paidAt);
  }

  removeCommissionInstallment(id: string) {
    return this.commissionInstallments.remove(id);
  }
}
