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
  SnagStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus.service';
import { InteriorCostingService, type CostingActor } from './interior-costing.service';
import { StorageService } from '../../common/storage/storage.service';
import { canTransition, getPhaseGate, isSnagOpen } from './interior-state-machine';
import { AddScopeItemDto, AddInteriorInvoiceDto } from './dto/scope-invoice.dto';

/**
 * A snag is only closed once someone has photographed the fix. The "before" shot
 * (`photoPath`) proves the defect; this proves the remedy. Without it "RESOLVED" is
 * just an assertion, which is the exact thing the client asked us to stop accepting.
 */
const AFTER_PHOTO_REQUIRED =
  'An "after" photo is required to resolve a snag — upload the proof-of-fix image and pass afterPhotoPath.';

/**
 * Building phases that mean the shell is complete enough for fit-out execution.
 * The soft parallel gate (INTERIOR_MODULE_DESIGN §0.2) blocks PROCUREMENT/EXECUTION
 * until the anchor building has reached one of these.
 */
const SHELL_COMPLETE_PHASES: string[] = ['LEASE_UP', 'STABILIZED', 'SOLD_REFI'];

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
  startDate?: string;
  targetEnd?: string;
  /** Further units this fit-out covers — same building as `unitId` ("Units 805–815"). */
  extraUnitIds?: string[];
  priority?: string | null;
  plansSubmittedAt?: string | null;
  /** What Prime contributes. Null = take it from the linked lease. */
  tiAllowance?: number | null;
  poPrefix?: string | null;
}

type UpdateInteriorInput = Partial<Omit<CreateInteriorInput, 'unitId' | 'buildingId'>> & {
  status?: InteriorStatus;
};

const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];

@Injectable()
export class InteriorService {
  constructor(
    private prisma: PrismaService,
    private bus: EventBus,
    private storage: StorageService,
    private costing: InteriorCostingService,
  ) {}

  /**
   * The units beyond the anchor, checked: they must exist, be live, and sit in the same
   * building as the anchor unit — one fit-out is one job on one site. Returns their sqft
   * total so the area can default to the sum.
   */
  private async checkExtraUnits(anchorUnitId: string | null | undefined, extraUnitIds: string[]) {
    const ids = [...new Set(extraUnitIds.filter((u) => u && u !== anchorUnitId))];
    if (!ids.length) return { ids, sqft: 0 };
    if (!anchorUnitId) throw new BadRequestException('Extra units need a unit-anchored fit-out');
    const anchor = await this.prisma.unit.findUnique({ where: { id: anchorUnitId }, select: { buildingId: true } });
    const units = await this.prisma.unit.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, unitNumber: true, buildingId: true, sqft: true } });
    if (units.length !== ids.length) throw new BadRequestException('One of the units no longer exists');
    const elsewhere = units.filter((u) => u.buildingId !== anchor?.buildingId);
    if (elsewhere.length) throw new BadRequestException(`Unit ${elsewhere.map((u) => u.unitNumber).join(', ')} is in a different building — a fit-out covers units in one building`);
    return { ids, sqft: units.reduce((t, u) => t + (u.sqft ?? 0), 0) };
  }

  private checkPriority(priority?: string | null) {
    if (priority && !PRIORITIES.includes(priority)) throw new BadRequestException('Priority is HIGH, MEDIUM or LOW');
  }

  // ─────── Reads ───────

  async findAll(
    filter: { unitId?: string; buildingId?: string; projectId?: string; status?: InteriorStatus },
    viewerPermissions?: string[],
  ) {
    // A fit-out reaches its project through EITHER anchor, so a projectId filter has to
    // cover both paths — a unit-anchored fit-out has no buildingId of its own.
    const projectScope: Prisma.InteriorProjectWhereInput | undefined = filter.projectId
      ? {
          OR: [
            { building: { projectId: filter.projectId } },
            { unit: { building: { projectId: filter.projectId } } },
          ],
        }
      : undefined;

    const projects = await this.prisma.interiorProject.findMany({
      where: {
        deletedAt: null,
        unitId: filter.unitId,
        buildingId: filter.buildingId,
        status: filter.status,
        ...(projectScope ?? {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        unit: {
          select: {
            id: true, unitNumber: true, buildingId: true,
            building: { select: { id: true, name: true, projectId: true } },
          },
        },
        building: { select: { id: true, name: true, projectId: true } },
        pm: { select: { id: true, name: true } },
        _count: { select: { snags: true, invoices: true, scopeItems: true } },
      },
    });
    // No `select` above means Prisma returns every scalar column, including
    // contractValue/ratePerSqft — the same interior:finance gate as findById/
    // portfolio, just easy to miss here since nothing in the `include` block hints
    // that money is riding along. Omitting `viewerPermissions` (internal calls) stays
    // full trust, matching findById's convention.
    if (!viewerPermissions || viewerPermissions.includes('interior:finance')) return projects;
    return projects.map((p) => ({ ...p, contractValue: null, ratePerSqft: null, tiAllowance: null }));
  }

  async findById(id: string, viewerPermissions?: string[]) {
    let project = await this.prisma.interiorProject.findFirst({
      where: { id, deletedAt: null },
      include: {
        // The anchor building's phase drives the shell gate, and its projectId is what
        // lets the UI link a fit-out back to its unit and project. Both are selected for
        // the unit path too — a unit-anchored fit-out previously returned neither, so the
        // page could not tell whether the shell gate would pass and had to warn about it
        // unconditionally.
        unit: {
          select: {
            id: true, unitNumber: true, buildingId: true, sqft: true,
            building: { select: { id: true, name: true, phase: true, projectId: true } },
          },
        },
        building: { select: { id: true, name: true, phase: true, projectId: true } },
        sale: { select: { id: true, buyer: true } },
        pm: { select: { id: true, name: true, email: true } },
        lease: { select: { id: true, tenantName: true, tiAllowance: true } },
        extraUnits: { include: { unit: { select: { id: true, unitNumber: true, sqft: true } } } },
        scopeItems: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
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
    // Snag photos are stored as bucket keys. Without a signed URL the before/after pair —
    // the whole point of the proof-of-fix rule — is data nobody can look at.
    const snags = await this.signSnagPhotos(project.snags);
    project = { ...project, snags };
    // TI contract value / scope pricing / sub-contractor invoices are `interior:finance`
    // territory, not `interior:view` — this endpoint requires only the latter. Redact
    // rather than 403 the whole endpoint since CONSTRUCTION still needs the phase/scope/
    // snag data alongside it. Scope items keep their non-money fields (description,
    // category, quantity) so the checklist-like BOQ is still readable, just priceless.
    //
    // Omitting `viewerPermissions` (internal calls like advancePhase, which only needs
    // `phase`/`snags`) means full trust — the same convention ProjectsService uses.
    if (!viewerPermissions || viewerPermissions.includes('interior:finance')) return project;
    return {
      ...project,
      contractValue: null,
      ratePerSqft: null,
      // The TI allowance is money too, on the fit-out and on the lease it may come from.
      tiAllowance: null,
      lease: project.lease ? { ...project.lease, tiAllowance: null } : null,
      scopeItems: project.scopeItems.map((s) => ({ ...s, unitPrice: null, total: null })),
      invoices: [],
    };
  }

  /**
   * Cross-project portfolio: phase, contract value, spend (sum of invoices), and
   * days-to-handover. Powers the InteriorPortfolioPage.
   */
  async portfolio(viewerPermissions: string[] = []) {
    const projects = await this.prisma.interiorProject.findMany({
      where: { deletedAt: null, status: { not: 'CANCELLED' } },
      orderBy: { targetEnd: 'asc' },
      include: {
        unit: { select: { id: true, unitNumber: true, building: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } } },
        building: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
        pm: { select: { id: true, name: true } },
        invoices: { select: { amount: true } },
        extraUnits: { select: { unit: { select: { id: true, unitNumber: true } } } },
      },
    });
    const now = Date.now();
    // Same interior:finance gate as findById — spend/contractValue are money, not
    // available to an interior:view-only caller.
    const canViewFinance = viewerPermissions.includes('interior:finance');
    return projects.map((p) => {
      const spend = p.invoices.reduce((sum, inv) => sum + Number(inv.amount), 0);
      const daysToHandover = p.targetEnd
        ? Math.ceil((p.targetEnd.getTime() - now) / 86_400_000)
        : null;
      const { invoices, ...rest } = p;
      return {
        ...rest,
        tiAllowance: canViewFinance && p.tiAllowance !== null ? Number(p.tiAllowance) : null,
        contractValue: canViewFinance && p.contractValue ? Number(p.contractValue) : null,
        spend: canViewFinance ? spend : null,
        daysToHandover,
      };
    });
  }

  // ─────── Create / Update / Delete ───────

  async create(input: CreateInteriorInput) {
    this.assertExactlyOneAnchor(input.unitId, input.buildingId);
    if (!input.name?.trim()) throw new BadRequestException('name is required');
    this.assertNonNegativeMoney(input.ratePerSqft, input.area, input.contractValue);

    // Multiple concurrent interior projects per unit/building are allowed (client
    // decision, 2026-07-29) — e.g. separate contractors on separate scopes, or
    // tracking competing proposals before picking one. This is NOT the discovery-doc
    // "no parallel execution" rule (INTERIOR_MODULE_DESIGN.md §0.2), which is about
    // fit-out not running in parallel with the unit/building SHELL construction —
    // that gate is unchanged and still enforced in advancePhase() below.

    // Package templates were removed (client, 2026-10-16): the estimate is built line by
    // line against BuilderTrend cost codes instead. Old rows keep their packageTemplateId.
    const ratePerSqft = input.ratePerSqft;

    this.checkPriority(input.priority);
    const extra = await this.checkExtraUnits(input.unitId, input.extraUnitIds ?? []);
    // A fit-out across several units defaults its area to their combined square feet.
    let area = input.area;
    if (area == null && input.unitId && extra.ids.length) {
      const anchor = await this.prisma.unit.findUnique({ where: { id: input.unitId }, select: { sqft: true } });
      const total = (anchor?.sqft ?? 0) + extra.sqft;
      if (total > 0) area = total;
    }
    const contractType = input.contractType ?? 'PER_SQFT';
    const contractValue = this.computeContractValue(contractType, ratePerSqft, area, input.contractValue);

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
          area: area ?? null,
          contractValue,
          startDate: input.startDate ? new Date(input.startDate) : null,
          targetEnd: input.targetEnd ? new Date(input.targetEnd) : null,
          priority: input.priority ?? null,
          plansSubmittedAt: input.plansSubmittedAt ? new Date(input.plansSubmittedAt) : null,
          tiAllowance: input.tiAllowance ?? null,
          poPrefix: input.poPrefix?.trim().toUpperCase() || null,
        },
      });
      if (extra.ids.length) {
        await tx.interiorProjectUnit.createMany({ data: extra.ids.map((unitId) => ({ interiorProjectId: project.id, unitId })) });
      }
      return project;
    });
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

    this.checkPriority(input.priority);
    const data: Prisma.InteriorProjectUpdateInput = {
      name: input.name?.trim(),
      status: input.status,
      contractType: input.contractType,
      ratePerSqft: input.ratePerSqft,
      area: input.area,
      contractValue,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      targetEnd: input.targetEnd ? new Date(input.targetEnd) : undefined,
      ...(input.priority !== undefined ? { priority: input.priority || null } : {}),
      ...(input.plansSubmittedAt !== undefined ? { plansSubmittedAt: input.plansSubmittedAt ? new Date(input.plansSubmittedAt) : null } : {}),
      ...(input.tiAllowance !== undefined ? { tiAllowance: input.tiAllowance } : {}),
      ...(input.poPrefix !== undefined ? { poPrefix: input.poPrefix?.trim().toUpperCase() || null } : {}),
    };
    if (input.extraUnitIds !== undefined) {
      const extra = await this.checkExtraUnits(project.unitId, input.extraUnitIds);
      await this.prisma.$transaction([
        this.prisma.interiorProjectUnit.deleteMany({ where: { interiorProjectId: id } }),
        ...(extra.ids.length ? [this.prisma.interiorProjectUnit.createMany({ data: extra.ids.map((unitId) => ({ interiorProjectId: id, unitId })) })] : []),
      ]);
    }
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
   *   4. Snag gate — no open punch-list item may survive into HANDOVER.
   *
   * The snag gate is the only OVERRIDABLE gate here. A hard block would eventually trap a
   * real, agreed handover behind one cosmetic snag whose contractor has left site — so it
   * follows this codebase's established shape for exactly that situation (Building/Unit
   * `force` delete, LeaseObligation.waive, SaleCancellation): allow the override, demand a
   * reason, record it. The reason is stamped onto `handoverNotes`, where it sits beside the
   * sign-off it qualifies, and the request body (force + reason + actor) lands in the
   * immutable AuditEvent log via AuditInterceptor on the POST.
   *
   * The document gates stay non-overridable: a missing HANDOVER_CERTIFICATE is a missing
   * legal artifact, not a judgement call about acceptable residual defects.
   */
  async advancePhase(
    id: string,
    target: InteriorPhase,
    _userId: string,
    signoff?: {
      handoverSignedBy?: string;
      handoverNotes?: string;
      /** Hand over anyway despite open snags. Requires `forceReason`. */
      force?: boolean;
      forceReason?: string;
    },
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

    // Snag gate — checked last, and off the snags already loaded by findById (no extra query).
    let forcedNote: string | null = null;
    if (gate.requiresSnagsClear) {
      const openCount = (project.snags ?? []).filter((s) => isSnagOpen(s.status)).length;
      if (openCount > 0) {
        const s = openCount === 1 ? '' : 's';
        if (!signoff?.force) {
          throw new ConflictException(
            `Cannot enter ${target}: ${openCount} punch-list item${s} still open. ` +
              `Resolve ${openCount === 1 ? 'it' : 'them'} — each resolution needs an "after" photo as ` +
              `proof of the fix — or hand over anyway with force: true and a forceReason, which is ` +
              `recorded on the project.`,
          );
        }
        if (!signoff.forceReason?.trim()) {
          throw new BadRequestException(
            `A reason is required to hand over with ${openCount} open punch-list item${s}`,
          );
        }
        forcedNote = `Handover forced with ${openCount} open snag${s}: ${signoff.forceReason.trim()}`;
      }
    }

    const enteringHandover = target === 'HANDOVER';
    const signoffNotes = signoff?.handoverNotes?.trim() || null;
    // The forced-handover stamp leads, so it cannot be buried under free-text notes.
    const handoverNotes = forcedNote
      ? signoffNotes
        ? `${forcedNote}\n${signoffNotes}`
        : forcedNote
      : signoffNotes;
    const updated = await this.prisma.interiorProject.update({
      where: { id },
      data: {
        phase: target,
        status: enteringHandover ? 'COMPLETED' : 'IN_PROGRESS',
        handoverAt: enteringHandover ? new Date() : undefined,
        handoverSignedBy: enteringHandover ? signoff?.handoverSignedBy?.trim() || null : undefined,
        handoverNotes: enteringHandover ? handoverNotes : undefined,
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

  async addScopeItem(interiorProjectId: string, input: AddScopeItemDto) {
    const ip = await this.findById(interiorProjectId);
    // The scope lines ARE the estimate; once it is locked they are the original budget.
    if ((ip as any).estimateStatus === 'LOCKED') throw new ConflictException('The estimate is locked. Raise a change order instead.');
    const { description, category, quantity, unit, unitPrice } = input;
    const total = quantity != null && unitPrice != null ? quantity * unitPrice : undefined;
    return this.prisma.interiorScopeItem.create({
      data: { interiorProjectId, description, category, quantity, unit, unitPrice, total },
    });
  }

  /**
   * Delete a BOQ line. Scoped to its interior project — the route is nested under the
   * project id so the access guard can resolve it, and checking the parent here means a
   * mismatched pair is a 404 rather than a cross-project delete that happens to work.
   */
  async removeScopeItem(interiorProjectId: string, itemId: string) {
    const item = await this.prisma.interiorScopeItem.findUnique({ where: { id: itemId } });
    if (!item || item.interiorProjectId !== interiorProjectId) {
      throw new NotFoundException('Scope item not found');
    }
    const ip = await this.prisma.interiorProject.findUnique({ where: { id: interiorProjectId }, select: { estimateStatus: true } });
    if (ip?.estimateStatus === 'LOCKED') throw new ConflictException('The estimate is locked. Raise a change order instead.');
    return this.prisma.interiorScopeItem.delete({ where: { id: itemId } });
  }

  // ─────── Sub-contractor invoices (creates a paired Actual so spend feeds cashflow/TI) ───────

  /**
   * Log a sub-contractor invoice AND mirror it into an `Actual` in one transaction, so
   * interior spend flows into the budget/cashflow machinery. The Actual is linked back via
   * `InteriorInvoice.actualId`; TI is reported as a top-level category by joining actuals
   * through interior_invoices (never mixed into construction actuals).
   */
  async addInvoice(interiorProjectId: string, input: AddInteriorInvoiceDto, actorId?: string) {
    if (!(input.amount > 0)) throw new BadRequestException('Invoice amount must be positive');
    // A bill against a purchase order takes its supplier from the PO and may not exceed
    // what is left unbilled on it (InteriorCostingService.checkBill).
    let vendorId = input.vendorId;
    if (input.purchaseOrderId) {
      vendorId = (await this.costing.checkBill(interiorProjectId, input.purchaseOrderId, input.amount)).vendorId;
    }
    if (!vendorId) throw new BadRequestException('Pick the purchase order this bill is for');
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
      const bill = await tx.interiorInvoice.create({
        data: {
          interiorProjectId,
          vendorId: vendorId!,
          amount: input.amount,
          invoiceNo: input.invoiceNo,
          invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : null,
          actualId: actual.id,
          purchaseOrderId: input.purchaseOrderId ?? null,
        },
      });
      await tx.interiorActivity.create({
        data: { interiorProjectId, actorId: actorId ?? null, text: `Added bill ${input.invoiceNo ?? ''} for $${Number(input.amount).toLocaleString('en-US')}.`.replace('  ', ' ') },
      });
      return bill;
    });
  }

  /**
   * Invoice lifecycle: PENDING -> APPROVED -> PAID (client, 2026-09-01).
   *
   * Approval can be undone — a wrongly approved invoice is a correction, not an event.
   * PAID is not undone here: money having moved is a fact, and the way back is to void the
   * invoice, which also reverses the mirrored Actual so TI spend stops counting it.
   */
  private static readonly INVOICE_TRANSITIONS: Record<string, string[]> = {
    PENDING: ['APPROVED'],
    APPROVED: ['PENDING', 'PAID'],
    PAID: [],
  };

  async updateInvoice(
    invoiceId: string,
    input: { status?: string; invoiceNo?: string; invoiceDate?: string },
    actor?: CostingActor,
  ) {
    const inv = await this.prisma.interiorInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    // Approving a bill is one of the configurable powers (OrgSettings.interiorBillApproverRoles).
    if (actor && input.status === 'APPROVED' && inv.status !== 'APPROVED') await this.costing.assertBillApprover(actor);

    const data: Prisma.InteriorInvoiceUncheckedUpdateInput = {};
    if (input.invoiceNo !== undefined) data.invoiceNo = input.invoiceNo.trim() || null;
    if (input.invoiceDate !== undefined) {
      data.invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : null;
    }

    if (input.status !== undefined && input.status !== inv.status) {
      const allowed = InteriorService.INVOICE_TRANSITIONS[inv.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw new ConflictException(
          `Cannot move an invoice from ${inv.status} to ${input.status}` +
            (inv.status === 'PAID' ? ' — void it instead, which also reverses the recorded spend' : ''),
        );
      }
      data.status = input.status;
      // paidAt tracks the PAID state and nothing else, so stepping back to PENDING clears it.
      data.paidAt = input.status === 'PAID' ? new Date() : null;
    }

    const updated = await this.prisma.interiorInvoice.update({
      where: { id: invoiceId },
      data,
      include: { vendor: { select: { id: true, name: true } } },
    });
    if (data.status) {
      const verb = data.status === 'PAID' ? 'Marked paid' : data.status === 'APPROVED' ? 'Approved' : 'Moved back to pending';
      await this.costing.logActivity(inv.interiorProjectId, actor?.userId ?? null, `${verb}: bill ${inv.invoiceNo ?? ''} ($${Number(inv.amount).toLocaleString('en-US')}).`.replace(': bill  (', ': bill ('));
    }
    return updated;
  }

  /**
   * Void an invoice and reverse its mirrored `Actual` in the same transaction.
   *
   * Deleting only the invoice would leave the Actual behind, and the Actual is what the
   * budget, cashflow and TI report all read — so a voided invoice would keep counting as
   * spend everywhere except the one screen it was voided on.
   */
  async removeInvoice(invoiceId: string) {
    const inv = await this.prisma.interiorInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    return this.prisma.$transaction(async (tx) => {
      if (inv.actualId) {
        // deleteMany, not delete: a missing Actual (removed by hand, or by an older code
        // path) must not block voiding the invoice that points at it.
        await tx.actual.deleteMany({ where: { id: inv.actualId } });
      }
      return tx.interiorInvoice.delete({ where: { id: invoiceId } });
    });
  }

  // ─────── Snags (punch list) ───────

  /**
   * Storage keys arrive from the presigned-upload flow and are handed straight to the
   * signer, so refuse anything that is not a relative bucket key — absolute paths,
   * traversal, or an external URL. Mirrors DailyLogsService.addPhoto.
   */
  private assertStorageKey(path?: string | null) {
    if (!path) return;
    if (path.startsWith('/') || path.includes('..') || /^[a-z]+:\/\//i.test(path)) {
      throw new BadRequestException('Invalid photo path');
    }
  }

  /** Attach short-lived signed URLs to a snag's before/after shots. */
  private async signSnagPhotos<T extends { photoPath: string | null; afterPhotoPath: string | null }>(
    snags: T[],
  ) {
    return Promise.all(
      snags.map(async (sn) => ({
        ...sn,
        photoUrl: sn.photoPath ? await this.storage.signedUrl(sn.photoPath, 3600).catch(() => '') : null,
        afterPhotoUrl: sn.afterPhotoPath
          ? await this.storage.signedUrl(sn.afterPhotoPath, 3600).catch(() => '')
          : null,
      })),
    );
  }

  async addSnag(
    interiorProjectId: string,
    input: { description: string; room?: string; assigneeId?: string; dueDate?: string; photoPath?: string },
  ) {
    await this.findById(interiorProjectId);
    this.assertStorageKey(input.photoPath);
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

  /**
   * Close a snag. Requires an "after" photo (client, 2026-08-14) — either supplied on this
   * call or already on the record. `photoPath` (the before/defect shot) is never touched:
   * the pair is the evidence, and half of it is worth much less than both.
   */
  async resolveSnag(snagId: string, input?: { afterPhotoPath?: string }) {
    const snag = await this.prisma.snagItem.findUnique({ where: { id: snagId } });
    if (!snag) throw new NotFoundException('Snag not found');
    this.assertStorageKey(input?.afterPhotoPath);
    const afterPhotoPath = input?.afterPhotoPath?.trim() || snag.afterPhotoPath;
    if (!afterPhotoPath) throw new BadRequestException(AFTER_PHOTO_REQUIRED);
    return this.prisma.snagItem.update({
      where: { id: snagId },
      data: { status: 'RESOLVED', resolvedAt: new Date(), afterPhotoPath },
    });
  }

  async updateSnag(
    snagId: string,
    input: {
      status?: string;
      description?: string;
      room?: string;
      assigneeId?: string;
      afterPhotoPath?: string;
      dueDate?: string;
    },
  ) {
    const snag = await this.prisma.snagItem.findUnique({ where: { id: snagId } });
    if (!snag) throw new NotFoundException('Snag not found');
    this.assertStorageKey(input.afterPhotoPath);

    const data: Prisma.SnagItemUncheckedUpdateInput = {};
    if (input.description !== undefined) data.description = input.description;
    if (input.room !== undefined) data.room = input.room || null;
    if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId || null;
    if (input.afterPhotoPath !== undefined) data.afterPhotoPath = input.afterPhotoPath || null;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;

    if (input.status !== undefined) {
      const status = input.status as SnagStatus;
      data.status = status;
      if (status === 'RESOLVED') {
        // Same proof requirement as resolveSnag — otherwise this route is the way around it.
        const proof = input.afterPhotoPath?.trim() || snag.afterPhotoPath;
        if (!proof) throw new BadRequestException(AFTER_PHOTO_REQUIRED);
        data.afterPhotoPath = proof;
        data.resolvedAt = new Date();
      } else {
        // Reopened (RESOLVED → OPEN/IN_PROGRESS): the fix did not hold, so its proof is
        // retired with it. Keeping it would leave a photo captioned "proof of fix" on an
        // item that is not fixed, AND would let the next resolve satisfy the gate with a
        // stale image instead of new work. The before shot survives, as always; only the
        // pointer is cleared, so the stored object is still there if anyone needs it.
        data.resolvedAt = null;
        data.afterPhotoPath = null;
      }
    }

    return this.prisma.snagItem.update({ where: { id: snagId }, data });
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
