import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BuildingType } from '@prisma/client';
import { ProjectPhaseService } from './project-phase.service';
import { StorageService } from '../../common/storage/storage.service';

/** Zero-valued blast radius — also the shape every read returns. */
const EMPTY_RADIUS = () => ({ units: 0, leases: 0, sales: 0, loans: 0 });
type Radius = ReturnType<typeof EMPTY_RADIUS>;

/** "3 units" · "3 units and 2 leases" · "3 units, 2 leases and 1 loan". */
function phraseList(parts: string[]) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

@Injectable()
export class BuildingsService {
  constructor(
    private prisma: PrismaService,
    private projectPhase: ProjectPhaseService,
    private storage: StorageService,
  ) {}

  private async withCoverUrl<T extends { coverPhotoPath?: string | null }>(b: T) {
    const coverPhotoUrl = b.coverPhotoPath
      ? await this.storage.signedUrl(b.coverPhotoPath, 3600).catch(() => '')
      : null;
    return { ...b, coverPhotoUrl };
  }

  /**
   * Second level of the blast radius: everything hanging off the building's UNITS.
   *
   * Sale/Lease/Loan are polymorphic — each row attaches either to a Unit or to the
   * Building directly (see the back-relations on Building in schema.prisma), so the
   * full picture is "attached here" + "attached to a unit under here". Prisma's
   * `_count` only traverses one level, which is why the direct half rides along on the
   * building query (`_count`) and the nested half is computed here.
   *
   * Deliberately ONE query for the whole page of buildings, not one per building:
   * findByProject is a list endpoint, and a per-row lookup would make archiving a
   * building cost a query per sibling. Prisma has no cross-relation group-by
   * (Lease has no buildingId to group on), so this pulls a filtered `_count` per unit
   * row and reduces in memory — units per building are in the tens, not thousands.
   *
   * Only live rows count: a soft-deleted unit is already hidden, and its leases/sales/
   * loans are history that archiving the building does not touch.
   */
  private async nestedCounts(buildingIds: string[]): Promise<Map<string, Radius>> {
    const byBuilding = new Map<string, Radius>(buildingIds.map((id) => [id, EMPTY_RADIUS()]));
    if (buildingIds.length === 0) return byBuilding;

    const units = await this.prisma.unit.findMany({
      where: { buildingId: { in: buildingIds }, deletedAt: null },
      select: {
        buildingId: true,
        _count: {
          select: {
            leases: { where: { deletedAt: null } },
            sales: { where: { deletedAt: null } },
            loans: { where: { deletedAt: null } },
          },
        },
      },
    });

    for (const u of units) {
      const acc = byBuilding.get(u.buildingId);
      if (!acc) continue;
      acc.units += 1;
      acc.leases += u._count.leases;
      acc.sales += u._count.sales;
      acc.loans += u._count.loans;
    }
    return byBuilding;
  }

  /**
   * Attach `blastRadius` — what actually disappears from view if this building is
   * archived — so the delete dialog can show it BEFORE the user commits, instead of
   * discovering it from the 409 afterwards. Building-level attachments plus everything
   * under the building's units, combined into one total per category.
   */
  private withBlastRadius<
    T extends { id: string; _count: { leases: number; sales: number; loans: number } },
  >(b: T, nested: Map<string, Radius>, viewerPermissions: string[] = []) {
    const n = nested.get(b.id) ?? EMPTY_RADIUS();
    // This is only counts — no tenant/buyer names, no dollar amounts — but a CONSTRUCTION
    // or SALES viewer who holds building:view without lease:view/sales:view/loan:view is
    // still told "this building has 1 loan", which the role's own comment elsewhere calls
    // out as something they should be "fully blind" to. Zero out what the viewer can't
    // see through the matching real endpoint; `units` is unaffected (unit:view is a much
    // more widely-held permission and isn't the concern here).
    const canViewLease = viewerPermissions.includes('lease:view');
    const canViewSales = viewerPermissions.includes('sales:view');
    const canViewLoans = viewerPermissions.includes('financial:view') || viewerPermissions.includes('loan:view');
    return {
      ...b,
      _count: {
        ...b._count,
        leases: canViewLease ? b._count.leases : 0,
        sales: canViewSales ? b._count.sales : 0,
        loans: canViewLoans ? b._count.loans : 0,
      },
      blastRadius: {
        units: n.units,
        leases: canViewLease ? n.leases + b._count.leases : 0,
        sales: canViewSales ? n.sales + b._count.sales : 0,
        loans: canViewLoans ? n.loans + b._count.loans : 0,
      },
    };
  }

  async findByProject(projectId: string, viewerPermissions: string[] = []) {
    if (!projectId) {
      throw new BadRequestException('projectId query parameter is required');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const buildings = await this.prisma.building.findMany({
      where: { projectId },
      // `units` is deliberately left UNFILTERED: it is the number delete()'s guard trips
      // on (and the web dialog's force gate reads), and both have always counted every
      // unit row. The polymorphic children below ARE filtered — a soft-deleted lease is
      // history, not something archiving the building is about to hide.
      include: {
        _count: {
          select: {
            units: true,
            leases: { where: { deletedAt: null } },
            sales: { where: { deletedAt: null } },
            loans: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    // One extra query for the whole list — see nestedCounts().
    const nested = await this.nestedCounts(buildings.map((b) => b.id));
    return Promise.all(buildings.map((b) => this.withCoverUrl(this.withBlastRadius(b, nested, viewerPermissions))));
  }

  async findById(id: string, viewerPermissions: string[] = []) {
    const building = await this.prisma.building.findUnique({
      where: { id },
      include: {
        units: true,
        _count: {
          select: {
            units: true,
            leases: { where: { deletedAt: null } },
            sales: { where: { deletedAt: null } },
            loans: { where: { deletedAt: null } },
          },
        },
        project: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!building) throw new NotFoundException('Building not found');
    const nested = await this.nestedCounts([building.id]);
    return this.withCoverUrl(this.withBlastRadius(building, nested, viewerPermissions));
  }

  async create(input: {
    projectId: string;
    name: string;
    llcName?: string;
    // Decimal(10,3) on the model — LOT parcels are sized in acres, not sqft.
    acreage?: number;
    totalSqft?: number;
    stories?: number;
    buildingType?: BuildingType;
    phase?: string;
    coverPhotoPath?: string;
  }) {
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, status: true },
    });
    if (!project) throw new NotFoundException(`Project ${input.projectId} not found`);
    if (project.status === 'CANCELLED') {
      throw new ConflictException('Cannot add buildings to an archived project');
    }

    const building = await this.prisma.building.create({
      data: input,
      include: {
        _count: {
          select: {
            units: true,
            leases: { where: { deletedAt: null } },
            sales: { where: { deletedAt: null } },
            loans: { where: { deletedAt: null } },
          },
        },
      },
    });
    // Recompute project phase since a new building changes the max
    await this.projectPhase.recompute(input.projectId);
    // Same shape as the reads so a created row can be spliced straight into the list
    // cache. No nestedCounts() query needed — a brand-new building has no units yet.
    return this.withBlastRadius(building, new Map());
  }

  async update(id: string, input: {
    name?: string;
    llcName?: string;
    acreage?: number;
    totalSqft?: number;
    stories?: number;
    buildingType?: BuildingType;
    phase?: string;
    coverPhotoPath?: string;
  }) {
    const existing = await this.findById(id);
    const updated = await this.prisma.building.update({
      where: { id },
      data: input,
      include: {
        _count: {
          select: {
            units: true,
            leases: { where: { deletedAt: null } },
            sales: { where: { deletedAt: null } },
            loans: { where: { deletedAt: null } },
          },
        },
      },
    });
    // If phase changed, project phase may shift up or down
    if (input.phase && input.phase !== existing.phase) {
      await this.projectPhase.recompute(existing.projectId);
    }
    // Same shape as the reads, so an updated row can replace a list-cache entry without
    // the dialog losing its blast radius. One extra query, on a write path only.
    return this.withBlastRadius(updated, await this.nestedCounts([id]));
  }

  async delete(id: string, force = false) {
    // The confirmation message must name the FULL blast radius regardless of the
    // deleting user's own lease:view/sales:view/loan:view — they're about to destroy
    // those records, not just read them, and need to know the true consequence of an
    // irreversible action even if their day-to-day role can't otherwise see that data.
    const building = await this.findById(id, ['lease:view', 'sales:view', 'financial:view', 'loan:view']);
    const unitCount = building._count.units;

    if (unitCount > 0 && !force) {
      // Name the FULL blast radius, not just the unit count. Leases, sales and loans sit
      // under a building both directly and via its units; someone archiving a building
      // used to be told only how many units it had and had no way to know how much
      // live revenue and debt went dark with it. Zero categories are omitted so the
      // common "3 units, nothing else" case still reads as one short sentence.
      const blast = building.blastRadius;
      const parts = [
        blast.units > 0 ? plural(blast.units, 'unit') : '',
        blast.leases > 0 ? plural(blast.leases, 'lease') : '',
        blast.sales > 0 ? plural(blast.sales, 'sale') : '',
        blast.loans > 0 ? plural(blast.loans, 'loan') : '',
      ].filter(Boolean);
      // The guard trips on the raw relation count, which also includes units archived
      // one-by-one earlier; those contribute nothing live, so the blast radius can be
      // empty here. Say that rather than emitting "has  attached".
      const summary = parts.length > 0 ? phraseList(parts) : `${plural(unitCount, 'archived unit')}`;
      throw new ConflictException(
        `Building '${building.name}' has ${summary} attached. ` +
        `Delete the units first, or pass ?force=true to archive the building and its units ` +
        `instead (their sale/lease/loan history is kept, not deleted).`,
      );
    }

    // Soft-delete, not `prisma.building.delete()`. A hard delete here used to cascade
    // (every Sale/Lease/Loan/etc. relation on Building and Unit is `onDelete: Cascade`)
    // and permanently erase every sale/lease/loan record under the building AND its
    // units. `force` still archives the building's live units too — matching what it
    // used to destroy — but the units' own history is left untouched, same as a
    // regular unit delete.
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      if (unitCount > 0) {
        await tx.unit.updateMany({
          where: { buildingId: id, deletedAt: null },
          data: { deletedAt: now },
        });
      }
      return tx.building.update({ where: { id }, data: { deletedAt: now } });
    });
    await this.projectPhase.recompute(building.projectId);
    return result;
  }

  /**
   * Persist a new drag-and-drop display order. buildingIds must be exactly the
   * current set of buildings in the project (no missing/extra/duplicate IDs) so a
   * stale or cross-project payload can't silently corrupt sortOrder for other rows.
   */
  async reorder(projectId: string, buildingIds: string[]) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const existing = await this.prisma.building.findMany({ where: { projectId }, select: { id: true } });
    const existingIds = new Set(existing.map((b) => b.id));
    const incomingIds = new Set(buildingIds);
    if (
      buildingIds.length !== existing.length ||
      incomingIds.size !== existingIds.size ||
      !buildingIds.every((id) => existingIds.has(id))
    ) {
      throw new BadRequestException(
        'buildingIds must exactly match the current set of buildings in this project (no missing, extra, or duplicate IDs)',
      );
    }

    await this.prisma.$transaction(
      buildingIds.map((id, index) => this.prisma.building.update({ where: { id }, data: { sortOrder: index } })),
    );
    return this.findByProject(projectId);
  }
}
