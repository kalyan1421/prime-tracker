import {
  Injectable, NotFoundException, BadRequestException,
  ConflictException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectAccessService } from '../../common/access/project-access.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';
import { CustomOptionsService } from '../custom-options/custom-options.service';
import { UserRole, UnitStatus } from '@prisma/client';

// ---- Status state machine ----
// Defines which transitions are legal. Empty array = terminal (no further moves).
// SUPER_ADMIN/FOUNDER can override — see canOverride() below.
const STATUS_TRANSITIONS: Record<string, string[]> = {
  AVAILABLE:           ['UNDER_CONTRACT', 'LEASE_PENDING', 'LEASED', 'SOLD', 'UNDER_CONSTRUCTION', 'OCCUPIED'],
  UNDER_CONTRACT:      ['AVAILABLE', 'LEASED', 'SOLD'],
  // LEASE_PENDING: signed lease, tenant not yet moved in. Can flip to LEASED (move-in)
  // or back to AVAILABLE (deal collapsed during fit-out).
  LEASE_PENDING:       ['LEASED', 'AVAILABLE'],
  // LEASE_PENDING from LEASED: the successor lease is signed while the sitting tenant
  // is still in occupation. Normal at renewal and turnover, and until this was added
  // there was no legal way to represent it — the unit had to pretend to be vacant or
  // pretend nothing was signed.
  LEASED:              ['AVAILABLE', 'OCCUPIED', 'UNDER_CONTRACT', 'LEASE_PENDING'],
  OCCUPIED:            ['AVAILABLE', 'LEASED'],
  SOLD:                ['AVAILABLE'],  // rare correction path
  UNDER_CONSTRUCTION:  ['AVAILABLE'],
};

const STATUS_OVERRIDE_ROLES: UserRole[] = ['SUPER_ADMIN', 'FOUNDER'];

/** "2 leases" · "2 leases and 1 sale" · "2 leases, 1 sale and 1 loan". */
function phraseList(parts: string[]) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

@Injectable()
export class UnitsService {
  constructor(
    private prisma: PrismaService,
    private access: ProjectAccessService,
    private encryption: EncryptionService,
    private statusEvents: UnitStatusEventService,
    private customOptions: CustomOptionsService,
  ) {}

  // ---- Reads ----

  async findByBuilding(buildingId: string, viewerPermissions: string[] = []) {
    if (!buildingId) throw new BadRequestException('buildingId required');
    const canViewLease = viewerPermissions.includes('lease:view');
    const canViewSales = viewerPermissions.includes('sales:view');
    const units = await this.prisma.unit.findMany({
      where: { buildingId, deletedAt: null },
      include: { leases: { where: { status: 'ACTIVE', deletedAt: null } }, sales: { where: { deletedAt: null } } },
      orderBy: { unitNumber: 'asc' },
    });
    if (canViewLease && canViewSales) return units;
    return units.map((u) => ({
      ...u,
      leases: canViewLease ? u.leases : [],
      sales: canViewSales ? u.sales : [],
    }));
  }

  async findByProject(projectId: string, viewerPermissions: string[] = []) {
    if (!projectId) throw new BadRequestException('projectId required');
    // Tenant name/rent and buyer/price live on the Lease/Sale rows, which have their
    // own permissions (lease:view, sales:view) for exactly this reason — unit:view
    // alone must not carry them along for the ride. `_count` stays unconditional
    // (a number, not an identity or a dollar figure) so leaseCount/saleCount on the
    // frontend still work for a viewer who gets the arrays redacted below.
    const canViewLease = viewerPermissions.includes('lease:view');
    const canViewSales = viewerPermissions.includes('sales:view');
    const units = await this.prisma.unit.findMany({
      where: { building: { projectId }, deletedAt: null },
      include: {
        building: { select: { id: true, name: true } },
        leases: { where: { status: 'ACTIVE', deletedAt: null } },
        sales: { where: { deletedAt: null } },
        // No decrypt needed — monthlyPayment is not one of the encrypted fields.
        loans: { where: { deletedAt: null }, select: { id: true, loanType: true, monthlyPayment: true } },
        // Blast radius for the delete dialog — every live record that goes dark with the
        // unit. `loans` was missing, so a unit carrying debt looked free to archive.
        _count: { select: { comments: true, sales: { where: { deletedAt: null } }, leases: { where: { deletedAt: null } }, loans: { where: { deletedAt: null } } } },
      },
      orderBy: [
        { building: { name: 'asc' } },
        { unitNumber: 'asc' },
      ],
    });
    if (canViewLease && canViewSales) return units;
    return units.map((u) => ({
      ...u,
      leases: canViewLease ? u.leases : [],
      sales: canViewSales ? u.sales : [],
    }));
  }

  async findById(id: string, viewerPermissions: string[] = []) {
    const unit = await this.prisma.unit.findUnique({
      where: { id },
      include: {
        // deletedAt on both parents so a unit under a deleted project/building can be
        // recognised as unreachable — see the check below findUnique.
        building: {
          select: {
            id: true, name: true, deletedAt: true,
            project: { select: { id: true, name: true, status: true, deletedAt: true } },
          },
        },
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
        // Who's assigned to the site work. Same shape SiteTrackerService.grid returns;
        // not gated by any extra permission there (unit:view is enough), so not gated
        // here either. Unit Detail had a `useAssignableUsers` import for this that was
        // never wired up — the field simply wasn't in this include.
        siteAssignees: {
          select: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { assignedAt: 'asc' },
        },
        // Blast radius for the delete dialog — every live record that goes dark with the
        // unit. `loans` was missing, so a unit carrying debt looked free to archive.
        _count: { select: { comments: true, sales: { where: { deletedAt: null } }, leases: { where: { deletedAt: null } }, loans: { where: { deletedAt: null } } } },
      },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    // A unit is only reachable if its whole chain is. `unit.deletedAt` alone is not
    // enough: deleting a project soft-deletes the project, NOT its units, so every unit
    // under it stayed openable by direct URL and rendered as though it were live —
    // which is how a unit in a deleted project came to be reported as a live data bug.
    // Same reason the consistency scan had to filter on the parents.
    if (unit.deletedAt || unit.building?.deletedAt || unit.building?.project?.deletedAt) {
      throw new NotFoundException('Unit not found');
    }
    // This endpoint is gated only on unit:view — a permission nearly every role holds —
    // but the include above pulls full lease (tenant name, rent), sale (buyer, price)
    // and loan (lender, principal, rate, balance — decrypted) records. Each of those
    // has its own permission for exactly this reason; unit:view alone must not carry
    // them along. `_count` stays unconditional (numbers, not identities or dollars).
    const canViewLease = viewerPermissions.includes('lease:view');
    const canViewSales = viewerPermissions.includes('sales:view');
    const canViewLoanFinancials =
      viewerPermissions.includes('financial:view') || viewerPermissions.includes('loan:view');
    return {
      ...unit,
      leases: canViewLease ? unit.leases : [],
      sales: canViewSales ? unit.sales : [],
      loans: canViewLoanFinancials ? this.encryption.decryptLoans(unit.loans) : [],
    };
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

      // The combined unit gets an opening event; each archived source gets a closing
      // one. Sources are soft-deleted precisely so their history survives, so the
      // merge itself has to be part of that history or the trail stops mid-sentence.
      await this.statusEvents.record(
        {
          unitId: combined.id,
          fromStatus: null,
          toStatus: 'AVAILABLE',
          source: 'UNIT_COMBINED',
          reason: `Combined from ${sources.map((u) => u.unitNumber).join(', ')}`,
        },
        tx,
      );
      for (const src of sources) {
        await this.statusEvents.record(
          {
            unitId: src.id,
            fromStatus: src.status,
            toStatus: src.status,
            source: 'UNIT_COMBINED',
            reason: `Merged into combined unit '${number}' and archived`,
          },
          tx,
        );
      }
      return combined;
    });
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

    // Normalize the number so whitespace variants ("101" vs "101 ") can't slip past the
    // uniqueness check and create near-duplicate units. Mirrors combine().
    const unitNumber = input.unitNumber?.trim();
    if (!unitNumber) throw new BadRequestException('Unit number is required');

    // Surface the composite-unique-constraint failure with a friendly message.
    // The DB constraint is a partial index (WHERE "deletedAt" IS NULL) so a soft-deleted
    // unit with this number must not block reuse — filter it out here too.
    // Case-insensitive, matching the index. Comparing exactly let "E2" and "e2" both
    // exist in one building — two records for one physical space, reachable from the
    // rent-history import, which offered to create the unit it had failed to match.
    const existing = await this.prisma.unit.findFirst({
      where: {
        buildingId: input.buildingId,
        unitNumber: { equals: unitNumber, mode: 'insensitive' },
        deletedAt: null,
      },
      select: { unitNumber: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.unitNumber === unitNumber
          ? `Unit '${unitNumber}' already exists in this building`
          : `Unit '${existing.unitNumber}' already exists in this building — '${unitNumber}' differs only in `
            + 'capitalisation, and would be a second record for the same space.',
      );
    }

    // If created as AVAILABLE (default), start the time-on-market clock now
    const status = input.status ?? 'AVAILABLE';
    try {
      // Unit + its first occupancy event in one transaction. A unit that exists with
      // no opening event is a hole in its own history that nothing can reconstruct.
      return await this.prisma.$transaction(async (tx) => {
        const unit = await tx.unit.create({
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
        await this.statusEvents.record(
          { unitId: unit.id, fromStatus: null, toStatus: status, source: 'UNIT_CREATED' },
          tx,
        );
        return unit;
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
      status?: UnitStatus;
      sqft?: number;
      askingRent?: number;
      askingPrice?: number;
      primeOwned?: boolean;
      notes?: string;
    },
    userRole: UserRole,
    /** Stamped onto the occupancy event so a status change has an author. */
    userId?: string,
    /**
     * The caller's permission list. Defaults to empty only for internal callers that
     * pass no permissions; those are trusted paths that supply their own field set.
     */
    permissions: string[] = [],
  ) {
    const unit = await this.findById(id);

    // The route is gated on `unit:editBuild`, which is deliberately wider than
    // `unit:edit` (see the controller). A caller who reached it WITHOUT `unit:edit` —
    // CONSTRUCTION today — may correct the physical facts of the unit but not its
    // commercial terms or its sale/lease lifecycle, so `askingPrice`, `askingRent` and
    // `status` are refused here rather than silently dropped: a site lead who types a
    // price into a form deserves to be told it was not saved.
    const BUILD_FIELDS = ['unitNumber', 'unitType', 'sqft', 'notes'];
    if (permissions.length > 0 && !permissions.includes('unit:edit')) {
      const blocked = Object.keys(input).filter((k) => !BUILD_FIELDS.includes(k));
      if (blocked.length > 0) {
        throw new ForbiddenException(
          `Editing unit number, type, size and notes is allowed; these fields need the unit:edit permission: ${blocked.join(', ')}`,
        );
      }
    }

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
    //
    // Retained as a denormalised convenience (the stale-unit cron, the exceptions feed
    // and the Vacancy Report all read it) but it is NO LONGER the source of truth —
    // unit_status_events is. It is destructive by construction: the flip away from
    // AVAILABLE erases how long the unit sat.
    const data: Record<string, unknown> = { ...input };
    const statusChanged = !!input.status && input.status !== unit.status;
    if (statusChanged) {
      if (input.status === 'AVAILABLE' && unit.status !== 'AVAILABLE') {
        data.availableSince = new Date();
      } else if (input.status !== 'AVAILABLE' && unit.status === 'AVAILABLE') {
        data.availableSince = null;
      }
    }

    // No status move → no transaction needed, nothing to log.
    if (!statusChanged) {
      return this.prisma.unit.update({
        where: { id },
        data: data as any,
        include: { building: { select: { id: true, name: true } } },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.unit.update({
        where: { id },
        data: data as any,
        include: { building: { select: { id: true, name: true } } },
      });
      await this.statusEvents.record(
        {
          unitId: id,
          fromStatus: unit.status,
          toStatus: input.status!,
          source: 'MANUAL',
          recordedById: userId,
        },
        tx,
      );
      return updated;
    });
  }

  async updateStatus(id: string, status: UnitStatus, userRole: UserRole, userId?: string) {
    return this.update(id, { status }, userRole, userId);
  }

  async delete(id: string, userRole: UserRole, force = false) {
    if (userRole === 'SALES') {
      throw new ForbiddenException('Sales role cannot delete units');
    }

    const unit = await this.findById(id);

    // Named for what findById's `_count` actually selects: every non-deleted lease, not
    // only the ACTIVE ones. It was called `activeLeases`, and the conflict message
    // inherited that lie — a unit with three expired leases was reported as having
    // three active ones.
    const leases = unit._count.leases;
    const sales = unit._count.sales;
    // Loans attach to a unit too (polymorphic — Project/Building/Unit). They were absent
    // from the message, so the one category that represents debt was the one the user
    // never saw. Reported only; the guard below still trips on leases/sales, as before.
    const loans = unit._count.loans;

    if ((leases > 0 || sales > 0) && !force) {
      const parts = [
        leases > 0 ? plural(leases, 'lease') : '',
        sales > 0 ? plural(sales, 'sale') : '',
        loans > 0 ? plural(loans, 'loan') : '',
      ].filter(Boolean);
      throw new ConflictException(
        `Unit '${unit.unitNumber}' has ${phraseList(parts)} attached. ` +
        `Pass ?force=true to remove the unit anyway — its lease/sale/loan history is kept, not deleted.`,
      );
    }

    // Soft-delete — preserves the row (and any lease/sale/loan history still attached
    // to it) instead of destroying it. A hard `prisma.unit.delete()` here used to
    // cascade-delete every Sale/Lease/Loan row pointing at this unit (all declared
    // `onDelete: Cascade`), permanently erasing financial history. `force` only
    // bypasses the "has history" guard above now; it no longer changes *how* the
    // delete happens.
    return this.prisma.unit.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---- Cross-Project Inventory ----

  async findInventory(filters: {
    status?: UnitStatus;
    unitType?: string;
    projectId?: string;
    search?: string;
    viewer?: { userId: string; role: string; roles?: string[] };
    viewerPermissions?: string[];
  }) {
    const where: any = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.unitType) where.unitType = filters.unitType;

    // The unit's own `deletedAt` is not enough — archiving a project soft-deletes the
    // PROJECT only, never its buildings or units (see ProjectsService.remove and the
    // matching check in findById). Without the parent chain here, every unit under an
    // archived project stayed in the cross-project inventory list while findById
    // rejected those exact rows: the list offered 40 units and each one 404'd.
    //
    // Built as one object rather than assigned per branch, because the project scoping
    // below used to OVERWRITE `where.building` — merging is the only way both the scope
    // and the parent-chain filter survive.
    const building: any = { deletedAt: null, project: { deletedAt: null } };
    if (filters.projectId) building.projectId = filters.projectId;
    else {
      // Units reach a project via their building — scope on building.projectId.
      const scopeIds = await this.access.listProjectScope(filters.viewer, filters.projectId);
      if (scopeIds) building.projectId = { in: scopeIds };
    }
    where.building = building;
    if (filters.search) {
      where.OR = [
        { unitNumber: { contains: filters.search, mode: 'insensitive' } },
        { building: { name: { contains: filters.search, mode: 'insensitive' } } },
        { building: { project: { name: { contains: filters.search, mode: 'insensitive' } } } },
      ];
    }

    // Tenant name/rent and buyer/price live on the Lease/Sale rows, which have their
    // own permissions (lease:view, sales:view) for exactly this reason — unit:view
    // alone (all this endpoint requires) must not carry them along for the ride.
    // Same redaction findByProject/findByBuilding/findById already apply, just
    // missed here when this cross-project endpoint was added.
    const canViewLease = (filters.viewerPermissions ?? []).includes('lease:view');
    const canViewSales = (filters.viewerPermissions ?? []).includes('sales:view');

    const units = await this.prisma.unit.findMany({
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
    if (canViewLease && canViewSales) return units;
    return units.map((u) => ({
      ...u,
      leases: canViewLease ? u.leases : [],
      sales: canViewSales ? u.sales : [],
    }));
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

  // ---- Site Tracker (Phase 1) ----

  /**
   * Blocker / site priority / work type. Its own method and its own permission
   * (`siteTracker:edit`) rather than a branch of update(), for two reasons:
   *
   *  1. update() is gated on `unit:edit`, which CONSTRUCTION does not hold and SALES and
   *     MARKETING do. A blocker flag reachable by Sales but not by the site team is
   *     precisely backwards.
   *  2. update() carries the status state machine and the SALES field allowlist, neither
   *     of which has anything to say about these fields.
   */
  async updateSiteTracker(
    id: string,
    input: {
      blockerStatus?: 'YES' | 'NO' | null;
      blockerReason?: string | null;
      sitePriority?: string | null;
    },
    userId?: string,
  ) {
    const unit = await this.prisma.unit.findUnique({
      where: { id },
      select: { id: true, deletedAt: true, blockerStatus: true, blockerReason: true },
    });
    if (!unit || unit.deletedAt) throw new NotFoundException('Unit not found');

    const data: Record<string, unknown> = {};

    if (input.sitePriority !== undefined) {
      await this.assertOption('site_priority', input.sitePriority);
      data.sitePriority = input.sitePriority;
    }

    // Reason may be edited on its own while a unit stays blocked.
    const reasonProvided = input.blockerReason !== undefined;
    const nextReason = reasonProvided ? (input.blockerReason?.trim() || null) : unit.blockerReason;
    if (reasonProvided) data.blockerReason = nextReason;

    if (input.blockerStatus !== undefined) {
      const from = unit.blockerStatus;
      const to = input.blockerStatus;

      // A YES with no reason is what makes the source board's blocker column unactionable:
      // you can see that something is stuck and never why. Refuse it here instead.
      if (to === 'YES' && !nextReason) {
        throw new BadRequestException(
          'Flagging a unit blocked needs a reason — say what is holding it up.',
        );
      }

      // `blockerSince` is maintained here and nowhere else, the same way update() owns
      // `availableSince`. Re-flagging an already-blocked unit must NOT restart the clock:
      // blocker age is the number worth looking at, and resetting it on every edit of the
      // reason would quietly hide the oldest problems.
      if (to === 'YES' && from !== 'YES') data.blockerSince = new Date();
      else if (to !== 'YES' && from === 'YES') data.blockerSince = null;

      // Clearing the flag clears the reason with it, unless this same call set a new one.
      if (to !== 'YES' && from === 'YES' && !reasonProvided) data.blockerReason = null;

      data.blockerStatus = to;
    }

    if (Object.keys(data).length === 0) return this.findById(id);

    await this.prisma.unit.update({ where: { id }, data: data as any });
    return this.findById(id);
  }

  /** Full replacement of the unit's site owners. Multi-assign; send [] to clear. */
  async setAssignees(id: string, userIds: string[], actingUserId?: string) {
    const unit = await this.prisma.unit.findUnique({
      where: { id }, select: { id: true, deletedAt: true },
    });
    if (!unit || unit.deletedAt) throw new NotFoundException('Unit not found');

    const wanted = [...new Set(userIds.filter(Boolean))];
    if (wanted.length > 0) {
      const found = await this.prisma.user.findMany({
        where: { id: { in: wanted }, isActive: true },
        select: { id: true },
      });
      if (found.length !== wanted.length) {
        const missing = wanted.filter((w) => !found.some((f) => f.id === w));
        throw new BadRequestException(
          `Not an active user: ${missing.join(', ')}`,
        );
      }
    }

    // Delete-then-insert inside one transaction. Rows already present are re-created, so
    // `assignedAt` resets for everyone — acceptable here because, unlike UpdateBoardAssignment,
    // nothing keys off it (no notification de-duplication reads this table yet).
    await this.prisma.$transaction([
      this.prisma.unitAssignee.deleteMany({ where: { unitId: id } }),
      ...(wanted.length
        ? [this.prisma.unitAssignee.createMany({
            data: wanted.map((userId) => ({ unitId: id, userId, assignedById: actingUserId ?? null })),
          })]
        : []),
    ]);

    return this.prisma.unitAssignee.findMany({
      where: { unitId: id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { assignedAt: 'asc' },
    });
  }

  /**
   * Validates a free-text value against its CustomOption category. Mirrors how unitType is
   * handled elsewhere: the value set is org-editable, so this checks membership at write
   * time rather than pinning an enum into the schema. null/'' clears the field.
   */
  private async assertOption(category: string, value: string | null | undefined) {
    if (value === null || value === undefined || value === '') return;
    const custom = await this.prisma.customOption.findFirst({
      where: { category, value, isActive: true },
      select: { id: true },
    });
    if (custom) return;
    const defaults = this.customOptions.getSystemDefaults()[category] ?? [];
    if (defaults.some((d) => d.value === value)) return;
    throw new BadRequestException(
      `'${value}' is not a valid ${category.replace(/_/g, ' ')}.`,
    );
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
