import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type {
  DocCategory,
  InteriorContractType,
  InteriorPhase,
  InteriorStatus,
  Prisma,
  ProjectPhase,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';
import { canTransition, getPhaseGate } from './interior-state-machine';

/**
 * Building phases that mean the shell is complete enough for fit-out execution.
 * The soft parallel gate (INTERIOR_MODULE_DESIGN §0.2) blocks PROCUREMENT/EXECUTION
 * until the anchor building has reached one of these.
 */
const SHELL_COMPLETE_PHASES: ProjectPhase[] = ['LEASE_UP', 'STABILIZED', 'SOLD_REFI'];

interface CreateInteriorInput {
  unitId?: string;
  buildingId?: string;
  saleId?: string;
  leaseId?: string;
  name: string;
  pmId?: string;
  contractType?: InteriorContractType;
  ratePerSqft?: number;
  area?: number;
  contractValue?: number;
  packageTemplateId?: string;
  startDate?: string;
  targetEnd?: string;
}

type UpdateInteriorInput = Partial<Omit<CreateInteriorInput, 'unitId' | 'buildingId' | 'packageTemplateId'>> & {
  status?: InteriorStatus;
};

@Injectable()
export class InteriorService {
  constructor(private prisma: PrismaService, private bus: EventBus) {}

  // ─────── Reads ───────

  findAll(filter: { unitId?: string; buildingId?: string; status?: InteriorStatus }) {
    return this.prisma.interiorProject.findMany({
      where: {
        deletedAt: null,
        unitId: filter.unitId,
        buildingId: filter.buildingId,
        status: filter.status,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        unit: { select: { id: true, unitNumber: true, buildingId: true } },
        building: { select: { id: true, name: true } },
        pm: { select: { id: true, name: true } },
        _count: { select: { snags: true, invoices: true, scopeItems: true } },
      },
    });
  }

  async findById(id: string) {
    const project = await this.prisma.interiorProject.findFirst({
      where: { id, deletedAt: null },
      include: {
        unit: { select: { id: true, unitNumber: true, buildingId: true, sqft: true } },
        building: { select: { id: true, name: true, phase: true } },
        sale: { select: { id: true, buyer: true } },
        pm: { select: { id: true, name: true, email: true } },
        scopeItems: { orderBy: { createdAt: 'asc' } },
        invoices: {
          orderBy: { createdAt: 'desc' },
          include: { vendor: { select: { id: true, name: true } } },
        },
        snags: {
          orderBy: { createdAt: 'desc' },
          include: { assignee: { select: { id: true, name: true } } },
        },
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, fileName: true, category: true, createdAt: true },
        },
      },
    });
    if (!project) throw new NotFoundException('Interior project not found');
    return project;
  }

  /**
   * Cross-project portfolio: phase, contract value, spend (sum of invoices), and
   * days-to-handover. Powers the InteriorPortfolioPage.
   */
  async portfolio() {
    const projects = await this.prisma.interiorProject.findMany({
      where: { deletedAt: null, status: { not: 'CANCELLED' } },
      orderBy: { targetEnd: 'asc' },
      include: {
        unit: { select: { id: true, unitNumber: true } },
        building: { select: { id: true, name: true } },
        pm: { select: { id: true, name: true } },
        invoices: { select: { amount: true } },
      },
    });
    const now = Date.now();
    return projects.map((p) => {
      const spend = p.invoices.reduce((sum, inv) => sum + Number(inv.amount), 0);
      const daysToHandover = p.targetEnd
        ? Math.ceil((p.targetEnd.getTime() - now) / 86_400_000)
        : null;
      const { invoices, ...rest } = p;
      return {
        ...rest,
        contractValue: p.contractValue ? Number(p.contractValue) : null,
        spend,
        daysToHandover,
      };
    });
  }

  // ─────── Create / Update / Delete ───────

  async create(input: CreateInteriorInput) {
    this.assertExactlyOneAnchor(input.unitId, input.buildingId);
    if (!input.name?.trim()) throw new BadRequestException('name is required');
    this.assertNonNegativeMoney(input.ratePerSqft, input.area, input.contractValue);

    // Enforce one active interior project per unit/building at a time.
    const existingAnchorField = input.unitId ? { unitId: input.unitId } : { buildingId: input.buildingId };
    const existing = await this.prisma.interiorProject.findFirst({
      where: { ...existingAnchorField, deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      select: { id: true, name: true },
    });
    if (existing) {
      throw new ConflictException(
        `An active interior project "${existing.name}" already exists for this ${input.unitId ? 'unit' : 'building'}. Complete or cancel it before starting a new one.`,
      );
    }

    // If a package template is chosen, default the rate from it and seed its BOQ lines.
    let templateItems: Array<{
      description: string; category: string | null;
      quantity: Prisma.Decimal | null; unit: string | null; unitPrice: Prisma.Decimal | null;
    }> = [];
    let ratePerSqft = input.ratePerSqft;
    if (input.packageTemplateId) {
      const tpl = await this.prisma.interiorPackageTemplate.findFirst({
        where: { id: input.packageTemplateId, deletedAt: null },
        include: { items: { orderBy: { sequence: 'asc' } } },
      });
      if (!tpl) throw new BadRequestException('Package template not found');
      templateItems = tpl.items;
      if (ratePerSqft == null && tpl.defaultRatePerSqft != null) ratePerSqft = Number(tpl.defaultRatePerSqft);
    }

    const contractType = input.contractType ?? 'PER_SQFT';
    const contractValue = this.computeContractValue(contractType, ratePerSqft, input.area, input.contractValue);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.interiorProject.create({
        data: {
          unitId: input.unitId ?? null,
          buildingId: input.buildingId ?? null,
          saleId: input.saleId ?? null,
          leaseId: input.leaseId ?? null,
          name: input.name.trim(),
          pmId: input.pmId ?? null,
          contractType,
          ratePerSqft: ratePerSqft ?? null,
          area: input.area ?? null,
          contractValue,
          packageTemplateId: input.packageTemplateId ?? null,
          startDate: input.startDate ? new Date(input.startDate) : null,
          targetEnd: input.targetEnd ? new Date(input.targetEnd) : null,
        },
      });
      if (templateItems.length) {
        await tx.interiorScopeItem.createMany({
          data: templateItems.map((it) => ({
            interiorProjectId: project.id,
            description: it.description,
            category: it.category,
            quantity: it.quantity,
            unit: it.unit,
            unitPrice: it.unitPrice,
            total: it.quantity != null && it.unitPrice != null ? Number(it.quantity) * Number(it.unitPrice) : null,
          })),
        });
      }
      return project;
    });
  }

  // ─────── Package templates (the "2-3 generic options"; otherwise custom) ───────

  listPackageTemplates() {
    return this.prisma.interiorPackageTemplate.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { items: { orderBy: { sequence: 'asc' } }, _count: { select: { interiorProjects: true } } },
    });
  }

  async createPackageTemplate(input: {
    name: string; description?: string; defaultRatePerSqft?: number;
    items?: Array<{ description: string; category?: string; quantity?: number; unit?: string; unitPrice?: number }>;
  }) {
    if (!input.name?.trim()) throw new BadRequestException('name is required');
    // A negative defaultRatePerSqft would otherwise flow unchecked into create()'s rate
    // default (which runs before the template is fetched), so validate it here.
    if (input.defaultRatePerSqft != null && input.defaultRatePerSqft < 0) {
      throw new BadRequestException('defaultRatePerSqft cannot be negative');
    }
    for (const it of input.items ?? []) {
      if (it.quantity != null && it.quantity < 0) throw new BadRequestException('item quantity cannot be negative');
      if (it.unitPrice != null && it.unitPrice < 0) throw new BadRequestException('item unitPrice cannot be negative');
    }
    return this.prisma.interiorPackageTemplate.create({
      data: {
        name: input.name.trim(),
        description: input.description ?? null,
        defaultRatePerSqft: input.defaultRatePerSqft ?? null,
        items: input.items?.length
          ? {
              create: input.items.map((it, i) => ({
                description: it.description,
                category: it.category ?? null,
                quantity: it.quantity ?? null,
                unit: it.unit ?? null,
                unitPrice: it.unitPrice ?? null,
                sequence: i,
              })),
            }
          : undefined,
      },
      include: { items: { orderBy: { sequence: 'asc' } } },
    });
  }

  async updatePackageTemplate(id: string, input: {
    name?: string; description?: string; defaultRatePerSqft?: number | null;
  }) {
    const tpl = await this.prisma.interiorPackageTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!tpl) throw new NotFoundException('Package template not found');
    if (input.defaultRatePerSqft != null && input.defaultRatePerSqft < 0) {
      throw new BadRequestException('defaultRatePerSqft cannot be negative');
    }
    return this.prisma.interiorPackageTemplate.update({
      where: { id },
      data: {
        name: input.name?.trim() ?? undefined,
        description: input.description !== undefined ? (input.description.trim() || null) : undefined,
        defaultRatePerSqft: input.defaultRatePerSqft !== undefined ? input.defaultRatePerSqft : undefined,
      },
      include: { items: { orderBy: { sequence: 'asc' } }, _count: { select: { interiorProjects: true } } },
    });
  }

  async removePackageTemplate(id: string) {
    const tpl = await this.prisma.interiorPackageTemplate.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: {
            interiorProjects: {
              where: { deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
            },
          },
        },
      },
    });
    if (!tpl) throw new NotFoundException('Package template not found');
    const activeCount = tpl._count.interiorProjects;
    if (activeCount > 0) {
      throw new ConflictException(
        `Cannot delete this package — ${activeCount} active interior project${activeCount !== 1 ? 's' : ''} still use it. Complete or cancel those fit-outs first.`,
      );
    }
    return this.prisma.interiorPackageTemplate.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async update(id: string, input: UpdateInteriorInput) {
    const project = await this.findById(id);
    this.assertNonNegativeMoney(input.ratePerSqft, input.area, input.contractValue);
    // COMPLETED is reached only by advancing to HANDOVER, never set directly here.
    if (input.status === 'COMPLETED') {
      throw new BadRequestException('Advance to the HANDOVER phase to complete an interior project');
    }
    const contractType = input.contractType ?? project.contractType;
    const ratePerSqft = input.ratePerSqft ?? (project.ratePerSqft ? Number(project.ratePerSqft) : undefined);
    const area = input.area ?? (project.area ? Number(project.area) : undefined);
    const contractValue =
      input.contractValue ??
      (input.ratePerSqft !== undefined || input.area !== undefined
        ? this.computeContractValue(contractType, ratePerSqft, area)
        : undefined);

    const data: Prisma.InteriorProjectUpdateInput = {
      name: input.name?.trim(),
      status: input.status,
      contractType: input.contractType,
      ratePerSqft: input.ratePerSqft,
      area: input.area,
      contractValue,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      targetEnd: input.targetEnd ? new Date(input.targetEnd) : undefined,
    };
    if (input.pmId !== undefined) {
      data.pm = input.pmId ? { connect: { id: input.pmId } } : { disconnect: true };
    }
    const updated = await this.prisma.interiorProject.update({ where: { id }, data });
    // Cancelling via update() must also revert any unpaid TI installment made due by a
    // (now-undone) handover — mirror remove(), otherwise a cancelled fit-out leaves money "due".
    if (input.status === 'CANCELLED' && project.status !== 'CANCELLED') {
      this.bus.emit({ type: 'interior.cancelled', interiorProjectId: id });
    }
    return updated;
  }

  async remove(id: string) {
    await this.findById(id);
    const removed = await this.prisma.interiorProject.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CANCELLED' },
    });
    // Let the sale-payment schedule revert any unpaid TI installment that was made
    // due by a (now-undone) handover, so a cancelled fit-out doesn't leave money "due".
    this.bus.emit({ type: 'interior.cancelled', interiorProjectId: id });
    return removed;
  }

  // ─────── Phase transitions (the core workflow) ───────

  /**
   * Advance the interior project to `target` phase. Enforces:
   *   1. Linear phase order (interior-state-machine.canTransition).
   *   2. Soft parallel gate — PROCUREMENT/EXECUTION require shell complete.
   *   3. Document gates — CITY_APPROVAL doc before EXECUTION; HANDOVER_CERTIFICATE before HANDOVER.
   */
  async advancePhase(
    id: string,
    target: InteriorPhase,
    _userId: string,
    signoff?: { handoverSignedBy?: string; handoverNotes?: string },
  ) {
    const project = await this.findById(id);

    if (!canTransition(project.phase, target)) {
      throw new BadRequestException(
        `Cannot advance from ${project.phase} to ${target} — phases are linear and forward-only`,
      );
    }

    const gate = getPhaseGate(target);

    if (gate.requiresShellComplete && !(await this.isShellComplete(project))) {
      throw new ConflictException(
        `Cannot enter ${target}: the unit/building shell is not complete yet (no parallel fit-out before shell completion)`,
      );
    }

    if (gate.requiredDocCategory && !(await this.hasDocument(id, gate.requiredDocCategory))) {
      throw new ConflictException(
        `Cannot enter ${target}: a ${gate.requiredDocCategory} document must be on file first`,
      );
    }

    const enteringHandover = target === 'HANDOVER';
    const updated = await this.prisma.interiorProject.update({
      where: { id },
      data: {
        phase: target,
        status: enteringHandover ? 'COMPLETED' : 'IN_PROGRESS',
        handoverAt: enteringHandover ? new Date() : undefined,
        handoverSignedBy: enteringHandover ? signoff?.handoverSignedBy?.trim() || null : undefined,
        handoverNotes: enteringHandover ? signoff?.handoverNotes?.trim() || null : undefined,
      },
    });

    this.bus.emit({
      type: 'interior.phaseChanged',
      interiorProjectId: id,
      from: project.phase,
      to: target,
    });
    if (enteringHandover) {
      this.bus.emit({
        type: 'interior.handedOver',
        interiorProjectId: id,
        unitId: project.unitId ?? undefined,
        at: updated.handoverAt ?? new Date(),
      });
    }
    return updated;
  }

  async approveClient(id: string) {
    await this.findById(id);
    return this.prisma.interiorProject.update({
      where: { id },
      data: { clientApprovedAt: new Date() },
    });
  }

  async approveCity(id: string) {
    await this.findById(id);
    return this.prisma.interiorProject.update({
      where: { id },
      data: { cityApprovedAt: new Date() },
    });
  }

  // ─────── Scope (BOQ) items ───────

  async addScopeItem(
    interiorProjectId: string,
    input: { description: string; category?: string; quantity?: number; unit?: string; unitPrice?: number },
  ) {
    await this.findById(interiorProjectId);
    const { description, category, quantity, unit, unitPrice } = input;
    const total = quantity != null && unitPrice != null ? quantity * unitPrice : undefined;
    return this.prisma.interiorScopeItem.create({
      data: { interiorProjectId, description, category, quantity, unit, unitPrice, total },
    });
  }

  async removeScopeItem(itemId: string) {
    const item = await this.prisma.interiorScopeItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Scope item not found');
    return this.prisma.interiorScopeItem.delete({ where: { id: itemId } });
  }

  // ─────── Sub-contractor invoices (creates a paired Actual so spend feeds cashflow/TI) ───────

  /**
   * Log a sub-contractor invoice AND mirror it into an `Actual` in one transaction, so
   * interior spend flows into the budget/cashflow machinery. The Actual is linked back via
   * `InteriorInvoice.actualId`; TI is reported as a top-level category by joining actuals
   * through interior_invoices (never mixed into construction actuals).
   */
  async addInvoice(
    interiorProjectId: string,
    input: { vendorId: string; amount: number; invoiceNo?: string; invoiceDate?: string },
  ) {
    if (!(input.amount > 0)) throw new BadRequestException('Invoice amount must be positive');
    const ip = await this.prisma.interiorProject.findFirst({
      where: { id: interiorProjectId, deletedAt: null },
      select: {
        id: true,
        building: { select: { projectId: true } },
        unit: { select: { building: { select: { projectId: true } } } },
      },
    });
    if (!ip) throw new NotFoundException('Interior project not found');
    const projectId = ip.building?.projectId ?? ip.unit?.building?.projectId;
    if (!projectId) throw new BadRequestException('Cannot resolve the project for this interior invoice');

    // Idempotency: don't double-record (and double-count as a TI Actual) the same invoice no.
    if (input.invoiceNo) {
      const dup = await this.prisma.interiorInvoice.findFirst({
        where: { interiorProjectId, invoiceNo: input.invoiceNo },
        select: { id: true },
      });
      if (dup) {
        throw new ConflictException(`Invoice ${input.invoiceNo} is already recorded for this interior project`);
      }
    }

    const txnDate = input.invoiceDate ? new Date(input.invoiceDate) : new Date();
    return this.prisma.$transaction(async (tx) => {
      const actual = await tx.actual.create({
        data: {
          projectId,
          // Tag as interior/TI spend so the main project's budget/variance/KPI views exclude it.
          interiorProjectId,
          category: 'OTHER',
          description: `Interior (TI) invoice${input.invoiceNo ? ' ' + input.invoiceNo : ''}`,
          amount: input.amount,
          txnDate,
        },
      });
      return tx.interiorInvoice.create({
        data: {
          interiorProjectId,
          vendorId: input.vendorId,
          amount: input.amount,
          invoiceNo: input.invoiceNo,
          invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : null,
          actualId: actual.id,
        },
      });
    });
  }

  // ─────── Snags (punch list) ───────

  async addSnag(
    interiorProjectId: string,
    input: { description: string; room?: string; assigneeId?: string; dueDate?: string; photoPath?: string },
  ) {
    await this.findById(interiorProjectId);
    return this.prisma.snagItem.create({
      data: {
        interiorProjectId,
        description: input.description,
        room: input.room,
        assigneeId: input.assigneeId,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        photoPath: input.photoPath,
      },
    });
  }

  async resolveSnag(snagId: string) {
    const snag = await this.prisma.snagItem.findUnique({ where: { id: snagId } });
    if (!snag) throw new NotFoundException('Snag not found');
    return this.prisma.snagItem.update({
      where: { id: snagId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  async updateSnag(
    snagId: string,
    input: { status?: string; description?: string; room?: string; assigneeId?: string },
  ) {
    const snag = await this.prisma.snagItem.findUnique({ where: { id: snagId } });
    if (!snag) throw new NotFoundException('Snag not found');
    return this.prisma.snagItem.update({
      where: { id: snagId },
      data: {
        ...(input.status !== undefined && {
          status: input.status as any,
          resolvedAt: input.status === 'RESOLVED' ? new Date() : (input.status === 'OPEN' ? null : undefined),
        }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.room !== undefined && { room: input.room || null }),
        ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId || null }),
      },
    });
  }

  // ─────── Internal helpers ───────

  private assertExactlyOneAnchor(unitId?: string, buildingId?: string) {
    if (!!unitId === !!buildingId) {
      throw new BadRequestException('Provide exactly one of unitId or buildingId');
    }
  }

  private assertNonNegativeMoney(ratePerSqft?: number, area?: number, contractValue?: number) {
    if (ratePerSqft != null && ratePerSqft < 0) throw new BadRequestException('ratePerSqft cannot be negative');
    if (area != null && area < 0) throw new BadRequestException('area cannot be negative');
    if (contractValue != null && contractValue < 0) throw new BadRequestException('contractValue cannot be negative');
  }

  private computeContractValue(
    contractType: InteriorContractType,
    ratePerSqft?: number,
    area?: number,
    explicit?: number,
  ): number | undefined {
    if (explicit != null) return explicit;
    if (contractType === 'PER_SQFT' && ratePerSqft != null && area != null) {
      return ratePerSqft * area;
    }
    return undefined;
  }

  /** Is the anchor unit/building's shell phase complete? */
  private async isShellComplete(project: {
    buildingId: string | null;
    unit: { buildingId: string } | null;
  }): Promise<boolean> {
    const buildingId = project.buildingId ?? project.unit?.buildingId;
    if (!buildingId) return false;
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { phase: true },
    });
    return !!building && SHELL_COMPLETE_PHASES.includes(building.phase);
  }

  private async hasDocument(interiorProjectId: string, category: DocCategory): Promise<boolean> {
    const doc = await this.prisma.document.findFirst({
      where: { interiorProjectId, category, deletedAt: null },
      select: { id: true },
    });
    return !!doc;
  }
}
