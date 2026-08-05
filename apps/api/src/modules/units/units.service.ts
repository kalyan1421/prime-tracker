import {
  Injectable, NotFoundException, BadRequestException,
  ConflictException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectAccessService } from '../../common/access/project-access.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { UserRole } from '@prisma/client';

// ---- Status state machine ----
// Defines which transitions are legal. Empty array = terminal (no further moves).
// SUPER_ADMIN/FOUNDER can override — see canOverride() below.
const STATUS_TRANSITIONS: Record<string, string[]> = {
  AVAILABLE:           ['UNDER_CONTRACT', 'LEASE_PENDING', 'LEASED', 'SOLD', 'UNDER_CONSTRUCTION', 'OCCUPIED'],
  UNDER_CONTRACT:      ['AVAILABLE', 'LEASED', 'SOLD'],
  // LEASE_PENDING: signed lease, tenant not yet moved in. Can flip to LEASED (move-in)
  // or back to AVAILABLE (deal collapsed during fit-out).
  LEASE_PENDING:       ['LEASED', 'AVAILABLE'],
  LEASED:              ['AVAILABLE', 'OCCUPIED', 'UNDER_CONTRACT'],
  OCCUPIED:            ['AVAILABLE', 'LEASED'],
  SOLD:                ['AVAILABLE'],  // rare correction path
  UNDER_CONSTRUCTION:  ['AVAILABLE'],
};

const STATUS_OVERRIDE_ROLES: UserRole[] = ['SUPER_ADMIN', 'FOUNDER'];

@Injectable()
export class UnitsService {
  constructor(
    private prisma: PrismaService,
    private access: ProjectAccessService,
    private encryption: EncryptionService,
  ) {}

  // ---- Reads ----

  async findByBuilding(buildingId: string) {
    if (!buildingId) throw new BadRequestException('buildingId required');
    return this.prisma.unit.findMany({
      where: { buildingId, deletedAt: null },
      include: { leases: { where: { status: 'ACTIVE', deletedAt: null } }, sales: { where: { deletedAt: null } } },
      orderBy: { unitNumber: 'asc' },
    });
  }

  async findByProject(projectId: string) {
    if (!projectId) throw new BadRequestException('projectId required');
    return this.prisma.unit.findMany({
      where: { building: { projectId }, deletedAt: null },
      include: {
        building: { select: { id: true, name: true } },
        leases: { where: { status: 'ACTIVE', deletedAt: null } },
        sales: { where: { deletedAt: null } },
        // No decrypt needed — monthlyPayment is not one of the encrypted fields.
        loans: { where: { deletedAt: null }, select: { id: true, loanType: true, monthlyPayment: true } },
        _count: { select: { comments: true, sales: { where: { deletedAt: null } }, leases: { where: { deletedAt: null } } } },
      },
      orderBy: [
        { building: { name: 'asc' } },
        { unitNumber: 'asc' },
      ],
    });
  }

  async findById(id: string) {
    const unit = await this.prisma.unit.findUnique({
      where: { id },
      include: {
        building: { select: { id: true, name: true, project: { select: { id: true, name: true, status: true } } } },
        // Full history — every lease/sale the unit has ever had, oldest to newest,
        // so the Unit Detail "History" timeline can render the complete story
        // (past tenants, past sale attempts) even after the unit moves on
        // (e.g. gets sold). Soft-deleted rows are excluded, not the record itself.
        leases: { where: { deletedAt: null }, orderBy: { leaseStart: 'desc' } },
        // broker relation included so the unit page can display and edit who
        // brokered a closed sale — sale.broker.name was being read without this.
        sales: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { broker: { select: { id: true, name: true } } },
        },
        // encryptedFields must be selected — lender/principalAmt live only in the blob.
        // deletedAt filter matches the leases/sales siblings above; a soft-deleted loan
        // was still rendering in the unit's "Linked Loans" panel.
        loans: {
          where: { deletedAt: null },
          select: {
            id: true, loanType: true, monthlyPayment: true,
            lender: true, principalAmt: true, encryptedFields: true,
          },
        },
        // Provenance for combined units — which source units were merged in.
        mergedFrom: { select: { id: true, unitNumber: true } },
        _count: { select: { comments: true, sales: { where: { deletedAt: null } }, leases: { where: { deletedAt: null } } } },
      },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return { ...unit, loans: this.encryption.decryptLoans(unit.loans) };
  }

  /**
   * Combine 2+ adjacent units in the same building into ONE legal unit (client decision:
   * merge, don't overlay). Creates a new combined unit (summed area), then soft-archives
   * the sources and points them at the combined unit via mergedIntoId — their sales/leases/
   * comments history is retained on the originals. The combined number must be distinct.
   */
  async combine(input: {
    buildingId: string;
    sourceUnitIds: string[];
    unitNumber: string;
    unitType?: string;
    notes?: string;
  }, userRole: UserRole) {
    // Combine archives the source units and mints a new one — same authority as delete().
    if (userRole === 'SALES') {
      throw new ForbiddenException('Sales role cannot combine units');
    }
    if (!input.sourceUnitIds || input.sourceUnitIds.length < 2) {
      throw new BadRequestException('Select at least two units to combine');
    }
    if (!input.unitNumber?.trim()) {
      throw new BadRequestException('A unit number for the combined unit is required');
    }
    const number = input.unitNumber.trim();

    const sources = await this.prisma.unit.findMany({
      where: { id: { in: input.sourceUnitIds }, deletedAt: null },
      include: {
        _count: {
          select: {
            sales: { where: { deletedAt: null } },
            leases: { where: { status: 'ACTIVE', deletedAt: null } },
            // A fit-out anchored to a source unit would orphan (FK is SetNull) on merge.
            interiorProjects: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (sources.length !== input.sourceUnitIds.length) {
      throw new BadRequestException('One or more units were not found or are already merged');
    }
    if (sources.some((u) => u.buildingId !== input.buildingId)) {
      throw new BadRequestException('All units must belong to the same building');
    }
    // Merging archives the sources; refuse to silently orphan their sales / active leases / fit-outs.
    const encumbered = sources.filter(
      (u) => u._count.sales > 0 || u._count.leases > 0 || u._count.interiorProjects > 0,
    );
    if (encumbered.length > 0) {
      throw new ConflictException(
        `Cannot combine units with attached sales, active leases, or interior fit-out projects: ${encumbered
          .map((u) => u.unitNumber)
          .join(', ')}. Resolve or move those records first.`,
      );
    }

    // The combined number must be distinct from every other live unit in the building.
    // Archived (soft-deleted) units — including ones merged away by a prior combine —
    // no longer reserve their number; see create()'s note on the partial unique index.
    const clash = await this.prisma.unit.findFirst({
      where: { buildingId: input.buildingId, unitNumber: number, deletedAt: null },
    });
    if (clash) {
      throw new ConflictException(
        `Unit '${number}' already exists in this building — choose a distinct number for the combined unit (e.g. "${sources.map((u) => u.unitNumber).join('+')}")`,
      );
    }

    const sumNum = (pick: (u: (typeof sources)[number]) => unknown) =>
      sources.reduce((s, u) => s + (pick(u) != null ? Number(pick(u)) : 0), 0) || null;
    const primary = sources[0];

    return this.prisma.$transaction(async (tx) => {
      const combined = await tx.unit.create({
        data: {
          buildingId: input.buildingId,
          unitNumber: number,
          unitType: (input.unitType ?? primary.unitType) as any,
          status: 'AVAILABLE',
          availableSince: new Date(),
          sqft: sumNum((u) => u.sqft) as number | null,
          floorArea: sumNum((u) => u.floorArea),
          mezzanineArea: sumNum((u) => u.mezzanineArea),
          primeOwned: sources.every((u) => u.primeOwned),
          notes: input.notes ?? `Combined from ${sources.map((u) => u.unitNumber).join(', ')}`,
        },
      });
      await tx.unit.updateMany({
        where: { id: { in: input.sourceUnitIds } },
        data: { deletedAt: new Date(), mergedIntoId: combined.id },
      });
      return combined;
    });
  }

  // ---- Writes ----

  async create(input: {
    buildingId: string;
    unitNumber: string;
    unitType: string;
    status?: string;
    sqft?: number;
    askingRent?: number;
    askingPrice?: number;
    primeOwned?: boolean;
    notes?: string;
  }) {
    // Validate building exists + parent project not archived
    const building = await this.prisma.building.findUnique({
      where: { id: input.buildingId },
      select: {
        id: true,
        project: { select: { status: true } },
      },
    });
    if (!building) throw new NotFoundException(`Building ${input.buildingId} not found`);
    if (building.project.status === 'CANCELLED') {
      throw new ConflictException('Cannot add units to an archived project');
    }

    // Normalize the number so whitespace variants ("101" vs "101 ") can't slip past the
    // uniqueness check and create near-duplicate units. Mirrors combine().
    const unitNumber = input.unitNumber?.trim();
    if (!unitNumber) throw new BadRequestException('Unit number is required');

    // Surface the composite-unique-constraint failure with a friendly message.
    // The DB constraint is a partial index (WHERE "deletedAt" IS NULL) so a soft-deleted
    // unit with this number must not block reuse — filter it out here too.
    const existing = await this.prisma.unit.findFirst({
      where: { buildingId: input.buildingId, unitNumber, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(
        `Unit '${unitNumber}' already exists in this building`,
      );
    }

    // If created as AVAILABLE (default), start the time-on-market clock now
    const status = input.status ?? 'AVAILABLE';
    try {
      return await this.prisma.unit.create({
        data: {
          buildingId: input.buildingId,
          unitNumber,
          unitType: input.unitType as any,
          status,
          availableSince: status === 'AVAILABLE' ? new Date() : null,
          sqft: input.sqft,
          askingRent: input.askingRent,
          askingPrice: input.askingPrice,
          primeOwned: input.primeOwned ?? false,
          notes: input.notes,
        },
        include: { building: { select: { id: true, name: true } } },
      });
    } catch (e: any) {
      // Concurrent double-submit: the unique index is the source of truth, so a racing
      // request that passed the findUnique check above lands here instead of duplicating.
      if (e?.code === 'P2002') {
        throw new ConflictException(`Unit '${unitNumber}' already exists in this building`);
      }
      throw e;
    }
  }

  async update(
    id: string,
    input: {
      unitNumber?: string;
      unitType?: string;
      status?: string;
      sqft?: number;
      askingRent?: number;
      askingPrice?: number;
      primeOwned?: boolean;
      notes?: string;
    },
    userRole: UserRole,
  ) {
    const unit = await this.findById(id);

    // SALES role: only `status` and `notes` are allowed.
    if (userRole === 'SALES') {
      const otherFields = Object.keys(input).filter((k) => !['status', 'notes'].includes(k));
      if (otherFields.length > 0) {
        throw new ForbiddenException(
          `Sales role can only update unit status and notes. Disallowed fields: ${otherFields.join(', ')}`,
        );
      }
    }

    // Normalize so whitespace-only differences don't create near-duplicate numbers.
    if (input.unitNumber != null) input.unitNumber = input.unitNumber.trim();

    // unitNumber change → uniqueness check (ignore soft-deleted units — see create())
    if (input.unitNumber && input.unitNumber !== unit.unitNumber) {
      const conflict = await this.prisma.unit.findFirst({
        where: {
          buildingId: unit.buildingId,
          unitNumber: input.unitNumber,
          deletedAt: null,
        },
      });
      if (conflict) {
        throw new ConflictException(
          `Unit '${input.unitNumber}' already exists in this building`,
        );
      }
    }

    // Status transition guard
    if (input.status && input.status !== unit.status) {
      this.assertValidStatusTransition(unit.status, input.status, userRole);
    }

    // Time-on-market: maintain `availableSince` automatically.
    //   When a unit flips TO   AVAILABLE → set availableSince = now
    //   When a unit flips FROM AVAILABLE → clear availableSince
    // The Founder/Sales pages can then sort/highlight units by how long they've sat.
    const data: Record<string, unknown> = { ...input };
    if (input.status && input.status !== unit.status) {
      if (input.status === 'AVAILABLE' && unit.status !== 'AVAILABLE') {
        data.availableSince = new Date();
      } else if (input.status !== 'AVAILABLE' && unit.status === 'AVAILABLE') {
        data.availableSince = null;
      }
    }

    return this.prisma.unit.update({
      where: { id },
      data: data as any,
      include: { building: { select: { id: true, name: true } } },
    });
  }

  async updateStatus(id: string, status: string, userRole: UserRole) {
    return this.update(id, { status }, userRole);
  }

  async delete(id: string, userRole: UserRole, force = false) {
    if (userRole === 'SALES') {
      throw new ForbiddenException('Sales role cannot delete units');
    }

    const unit = await this.findById(id);

    const activeLeases = unit._count.leases;
    const sales = unit._count.sales;

    if ((activeLeases > 0 || sales > 0) && !force) {
      const parts: string[] = [];
      if (activeLeases > 0) parts.push(`${activeLeases} lease${activeLeases === 1 ? '' : 's'}`);
      if (sales > 0) parts.push(`${sales} sale${sales === 1 ? '' : 's'}`);
      throw new ConflictException(
        `Unit '${unit.unitNumber}' has ${parts.join(' and ')} attached. ` +
        `Pass ?force=true to delete the unit and all attached records.`,
      );
    }

    return this.prisma.unit.delete({ where: { id } });
  }

  // ---- Cross-Project Inventory ----

  async findInventory(filters: {
    status?: string;
    unitType?: string;
    projectId?: string;
    search?: string;
    viewer?: { userId: string; role: string; roles?: string[] };
  }) {
    const where: any = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.unitType) where.unitType = filters.unitType;
    if (filters.projectId) where.building = { projectId: filters.projectId };
    else {
      // Units reach a project via their building — scope on building.projectId.
      const scopeIds = await this.access.listProjectScope(filters.viewer, filters.projectId);
      if (scopeIds) where.building = { projectId: { in: scopeIds } };
    }
    if (filters.search) {
      where.OR = [
        { unitNumber: { contains: filters.search, mode: 'insensitive' } },
        { building: { name: { contains: filters.search, mode: 'insensitive' } } },
        { building: { project: { name: { contains: filters.search, mode: 'insensitive' } } } },
      ];
    }

    return this.prisma.unit.findMany({
      where,
      include: {
        building: {
          select: {
            id: true,
            name: true,
            buildingType: true,
            project: { select: { id: true, name: true, status: true, phase: true } },
          },
        },
        leases: { where: { status: 'ACTIVE', deletedAt: null }, select: { id: true, tenantName: true, leaseEnd: true } },
        sales: { where: { deletedAt: null }, select: { id: true, status: true, buyer: true, salePrice: true } },
      },
      orderBy: [
        { building: { project: { name: 'asc' } } },
        { building: { name: 'asc' } },
        { unitNumber: 'asc' },
      ],
    });
  }

  // ---- Aggregates ----

  async getMonthlyLeaseIncome(projectId: string) {
    if (!projectId) throw new BadRequestException('projectId required');

    const leases = await this.prisma.lease.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        unit: { building: { projectId } },
      },
      include: {
        unit: {
          select: {
            id: true,
            unitNumber: true,
            building: { select: { name: true } },
          },
        },
      },
    });

    // After Sprint 1, leases can attach to a Building directly (no unit). The query above
    // already filters by `unit.building.projectId` so building-only leases are excluded
    // here — they don't contribute to per-unit monthly income. Filter out any leftover
    // null `unit` rows defensively before mapping.
    const perUnit = leases
      .filter((l): l is typeof l & { unit: NonNullable<typeof l.unit> } => l.unit !== null)
      .map((l) => ({
        unitId: l.unit.id,
        unitNumber: l.unit.unitNumber,
        buildingName: l.unit.building.name,
        tenantName: l.tenantName,
        monthlyRent: Number(l.monthlyRent),
      }));

    const total = perUnit.reduce((sum, u) => sum + u.monthlyRent, 0);
    return { total, annualProjection: total * 12, perUnit };
  }

  // ---- Helpers ----

  private assertValidStatusTransition(
    from: string,
    to: string,
    userRole: UserRole,
  ) {
    // Founder/SuperAdmin can override the state machine for corrections
    if (STATUS_OVERRIDE_ROLES.includes(userRole)) return;

    const allowed = STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Cannot move unit from ${from} to ${to}. Allowed transitions: ${allowed.join(', ') || '(none)'}`,
      );
    }
  }
}
