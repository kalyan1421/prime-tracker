import {
  Injectable, NotFoundException, BadRequestException,
  ConflictException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitStatus, UserRole } from '@prisma/client';

// ---- Status state machine ----
// Defines which transitions are legal. Empty array = terminal (no further moves).
// SUPER_ADMIN/FOUNDER can override — see canOverride() below.
const STATUS_TRANSITIONS: Record<UnitStatus, UnitStatus[]> = {
  AVAILABLE:           ['UNDER_CONTRACT', 'LEASED', 'SOLD', 'UNDER_CONSTRUCTION', 'OCCUPIED'],
  UNDER_CONTRACT:      ['AVAILABLE', 'LEASED', 'SOLD'],
  LEASED:              ['AVAILABLE', 'OCCUPIED', 'UNDER_CONTRACT'],
  OCCUPIED:            ['AVAILABLE', 'LEASED'],
  SOLD:                ['AVAILABLE'],  // rare correction path
  UNDER_CONSTRUCTION:  ['AVAILABLE'],
};

const STATUS_OVERRIDE_ROLES: UserRole[] = ['SUPER_ADMIN', 'FOUNDER'];

@Injectable()
export class UnitsService {
  constructor(private prisma: PrismaService) {}

  // ---- Reads ----

  async findByBuilding(buildingId: string) {
    if (!buildingId) throw new BadRequestException('buildingId required');
    return this.prisma.unit.findMany({
      where: { buildingId },
      include: { leases: { where: { status: 'ACTIVE' } }, sales: true },
      orderBy: { unitNumber: 'asc' },
    });
  }

  async findByProject(projectId: string) {
    if (!projectId) throw new BadRequestException('projectId required');
    return this.prisma.unit.findMany({
      where: { building: { projectId } },
      include: {
        building: { select: { id: true, name: true } },
        leases: { where: { status: 'ACTIVE' } },
        sales: true,
        loans: { select: { id: true, loanType: true, monthlyPayment: true } },
        _count: { select: { comments: true, sales: true, leases: true } },
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
        leases: true,
        sales: true,
        loans: { select: { id: true, loanType: true, lender: true, monthlyPayment: true, principalAmt: true } },
        _count: { select: { comments: true, sales: true, leases: true } },
      },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  // ---- Writes ----

  async create(input: {
    buildingId: string;
    unitNumber: string;
    unitType: string;
    status?: UnitStatus;
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

    // Surface the composite-unique-constraint failure with a friendly message
    const existing = await this.prisma.unit.findUnique({
      where: { buildingId_unitNumber: { buildingId: input.buildingId, unitNumber: input.unitNumber } },
    });
    if (existing) {
      throw new ConflictException(
        `Unit '${input.unitNumber}' already exists in this building`,
      );
    }

    return this.prisma.unit.create({
      data: {
        buildingId: input.buildingId,
        unitNumber: input.unitNumber,
        unitType: input.unitType as any,
        status: input.status,
        sqft: input.sqft,
        askingRent: input.askingRent,
        askingPrice: input.askingPrice,
        primeOwned: input.primeOwned ?? false,
        notes: input.notes,
      },
      include: { building: { select: { id: true, name: true } } },
    });
  }

  async update(
    id: string,
    input: {
      unitNumber?: string;
      unitType?: string;
      status?: UnitStatus;
      sqft?: number;
      askingRent?: number;
      askingPrice?: number;
      primeOwned?: boolean;
      notes?: string;
    },
    userRole: UserRole,
  ) {
    const unit = await this.findById(id);

    // SALES role: only `status` is allowed. Other fields are silently dropped
    // to avoid surprising API errors when a UI form sends extra fields.
    if (userRole === 'SALES') {
      const otherFields = Object.keys(input).filter((k) => k !== 'status');
      if (otherFields.length > 0) {
        throw new ForbiddenException(
          `Sales role can only update unit status. Disallowed fields: ${otherFields.join(', ')}`,
        );
      }
    }

    // unitNumber change → uniqueness check
    if (input.unitNumber && input.unitNumber !== unit.unitNumber) {
      const conflict = await this.prisma.unit.findUnique({
        where: {
          buildingId_unitNumber: {
            buildingId: unit.buildingId,
            unitNumber: input.unitNumber,
          },
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
      this.assertValidStatusTransition(unit.status as UnitStatus, input.status, userRole);
    }

    return this.prisma.unit.update({
      where: { id },
      data: input as any,
      include: { building: { select: { id: true, name: true } } },
    });
  }

  async updateStatus(id: string, status: UnitStatus, userRole: UserRole) {
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
    status?: UnitStatus;
    unitType?: string;
    projectId?: string;
    search?: string;
  }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.unitType) where.unitType = filters.unitType;
    if (filters.projectId) where.building = { projectId: filters.projectId };
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
        leases: { where: { status: 'ACTIVE' }, select: { id: true, tenantName: true, leaseEnd: true } },
        sales: { select: { id: true, status: true, buyer: true, salePrice: true } },
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

    const perUnit = leases.map((l) => ({
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
    from: UnitStatus,
    to: UnitStatus,
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
