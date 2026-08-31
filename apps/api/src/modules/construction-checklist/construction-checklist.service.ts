import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectAccessService } from '../../common/access/project-access.service';
import { StorageService } from '../../common/storage/storage.service';

const OWNER_SELECT = { select: { id: true, name: true, email: true } } as const;

@Injectable()
export class ConstructionChecklistService {
  constructor(
    private prisma: PrismaService,
    private access: ProjectAccessService,
    private storage: StorageService,
  ) {}

  // ── Building template ───────────────────────────────────────────────────────

  async getTemplate(buildingId: string) {
    return this.prisma.constructionStageTemplateItem.findMany({
      where: { buildingId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Appends one stage to the building's template. Does not touch existing units. */
  async addTemplateItem(buildingId: string, label: string, userId?: string) {
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building || building.deletedAt) throw new NotFoundException('Building not found');

    const last = await this.prisma.constructionStageTemplateItem.findFirst({
      where: { buildingId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return this.prisma.constructionStageTemplateItem.create({
      data: {
        buildingId,
        label: label.trim(),
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdById: userId ?? null,
      },
    });
  }

  async deleteTemplateItem(templateItemId: string) {
    const item = await this.prisma.constructionStageTemplateItem.findUnique({
      where: { id: templateItemId },
    });
    if (!item) throw new NotFoundException('Template stage not found');
    return this.prisma.constructionStageTemplateItem.delete({ where: { id: templateItemId } });
  }

  // ── Per-unit checklist ──────────────────────────────────────────────────────

  async getUnitStages(unitId: string) {
    const stages = await this.prisma.unitConstructionStage.findMany({
      where: { unitId },
      orderBy: { sortOrder: 'asc' },
      include: {
        owner: OWNER_SELECT,
        photos: { orderBy: { uploadedAt: 'asc' } },
        // How many site updates are pinned to this stage — drives the message badge.
        _count: { select: { dailyLogs: true } },
      },
    });
    // Signed on read, like every other private object in this app — a storagePath on its own
    // renders nothing.
    return Promise.all(stages.map(async (st) => ({
      ...st,
      photos: await Promise.all(st.photos.map(async (p) => ({
        ...p,
        url: await this.storage.signedUrl(p.storagePath, 3600).catch(() => ''),
      }))),
    })));
  }

  /** Attach a photo to a stage. `storagePath` comes from the presigned-upload flow. */
  async addStagePhoto(stageId: string, storagePath: string, caption?: string, userId?: string) {
    const stage = await this.prisma.unitConstructionStage.findUnique({ where: { id: stageId } });
    if (!stage) throw new NotFoundException('Checklist stage not found');
    // Same hardening as DailyLogsService.addPhoto: the path must be a relative bucket key
    // from our own presign, not an absolute path, a traversal, or an external URL.
    if (!storagePath || storagePath.startsWith('/') || storagePath.includes('..') || /^[a-z]+:\/\//i.test(storagePath)) {
      throw new BadRequestException('Invalid storagePath');
    }
    return this.prisma.unitConstructionStagePhoto.create({
      data: { stageId, storagePath, caption: caption?.trim() || null, uploadedById: userId ?? null },
    });
  }

  async removeStagePhoto(photoId: string) {
    const photo = await this.prisma.unitConstructionStagePhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Photo not found');
    return this.prisma.unitConstructionStagePhoto.delete({ where: { id: photoId } });
  }

  /**
   * One-time seed of a unit's checklist. Refuses on a unit that already has ANY stages —
   * re-running the template over live progress would either duplicate rows or silently
   * discard what was recorded. Add stages individually past this point.
   *
   * Resolution order (Phase 2):
   *   1. the active versioned template for the unit's WORK TYPE — the default path, and
   *      the only one that stamps provenance onto the unit;
   *   2. the building's own ConstructionStageTemplateItem list, as an override for a
   *      building with genuinely bespoke stages.
   *
   * There is one source now: the building's stage list. The versioned, work-type-keyed
   * templates that used to take precedence were removed along with the work-type field
   * that selected them, so a unit inherits whatever its building uses and carries no
   * template provenance. `Unit.templateId` / `templateVersion` still hold the stamp for
   * the units seeded before the removal; nothing writes them any more.
   */
  async applyTemplate(unitId: string, userId?: string) {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { id: true, buildingId: true, deletedAt: true },
    });
    if (!unit || unit.deletedAt) throw new NotFoundException('Unit not found');

    const existing = await this.prisma.unitConstructionStage.count({ where: { unitId } });
    if (existing > 0) {
      throw new BadRequestException(
        'This unit already has a construction checklist. Applying the template again would '
        + 'duplicate or clobber recorded progress — add stages individually instead.',
      );
    }

    const buildingTemplate = await this.getTemplate(unit.buildingId);
    if (buildingTemplate.length === 0) {
      throw new BadRequestException(
        'This unit\'s building has no stage list to build a checklist from — add stages to the building first.',
      );
    }

    // Building-override path: no provenance to stamp, and the drift report says so plainly
    // rather than pretending the checklist came from a template.
    await this.prisma.unitConstructionStage.createMany({
      data: buildingTemplate.map((t) => ({
        unitId,
        sortOrder: t.sortOrder,
        label: t.label,
        createdById: userId ?? null,
      })),
    });
    return this.getUnitStages(unitId);
  }

  /**
   * Add SEVERAL stages in one call, appended in the order given.
   *
   * One request, one transaction, rather than the frontend looping addUnitStage: the API
   * is rate limited at 10 requests/second, so a loop adding seventeen template stages
   * silently lands about half of them and leaves a checklist that looks complete and is
   * not. Picking "all of them" is the normal case here, so this cannot be the slow path.
   *
   * Unlike applyTemplate this does NOT require the unit to be empty — its whole purpose is
   * topping up a checklist that already exists. Labels already on the unit are skipped
   * rather than rejected: selecting a stage twice is a slip, not a reason to lose the
   * other sixteen. What was skipped comes back so the caller can say so.
   */
  async addUnitStages(unitId: string, labels: string[], userId?: string) {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { id: true, deletedAt: true },
    });
    if (!unit || unit.deletedAt) throw new NotFoundException('Unit not found');

    const cleaned = labels.map((l) => (l ?? '').trim()).filter(Boolean);
    if (cleaned.length === 0) throw new BadRequestException('Pick at least one stage to add.');

    const existing = await this.prisma.unitConstructionStage.findMany({
      where: { unitId },
      select: { label: true, sortOrder: true },
    });
    const taken = new Set(existing.map((s) => s.label.trim().toLowerCase()));

    // Deduplicate within the request too, so the same label twice in one payload adds one.
    const toAdd: string[] = [];
    const skipped: string[] = [];
    for (const label of cleaned) {
      const key = label.toLowerCase();
      if (taken.has(key)) { skipped.push(label); continue; }
      taken.add(key);
      toAdd.push(label);
    }

    if (toAdd.length > 0) {
      const last = existing.reduce((max, s) => Math.max(max, s.sortOrder), -1);
      await this.prisma.unitConstructionStage.createMany({
        data: toAdd.map((label, i) => ({
          unitId,
          label,
          sortOrder: last + 1 + i,
          createdById: userId ?? null,
        })),
      });
    }

    return { added: toAdd.length, skipped, stages: await this.getUnitStages(unitId) };
  }

  /**
   * Put this unit's stages in the given order.
   *
   * Checklists are built by picking stages, and picking never happens in the right order —
   * a stage remembered late belonged at step three. Without this the only remedy was
   * deleting rows and re-adding them, which throws away their status, inspection, dates and
   * notes to fix nothing but position.
   *
   * The payload must name EVERY stage on the unit exactly once. A partial reorder would
   * have to invent positions for the rest, and two clients each sending half a list would
   * interleave into an order neither asked for. Rejecting is the honest failure.
   */
  async reorderUnitStages(unitId: string, stageIds: string[], userId?: string) {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { id: true, deletedAt: true },
    });
    if (!unit || unit.deletedAt) throw new NotFoundException('Unit not found');

    const current = await this.prisma.unitConstructionStage.findMany({
      where: { unitId },
      select: { id: true },
    });
    const currentIds = new Set(current.map((s) => s.id));
    const seen = new Set(stageIds);

    if (seen.size !== stageIds.length) {
      throw new BadRequestException('The same stage was listed more than once.');
    }
    if (stageIds.length !== currentIds.size || stageIds.some((id) => !currentIds.has(id))) {
      throw new BadRequestException(
        'The new order must list every stage on this unit exactly once. Reload the '
        + 'checklist — it changed since this order was worked out.',
      );
    }

    // Two passes through a negative range. sortOrder is not unique in the schema, but a
    // single pass still walks rows through positions others currently hold, and the
    // second pass reads cleanly as "nothing is left parked out of range".
    await this.prisma.$transaction([
      ...stageIds.map((id, i) => this.prisma.unitConstructionStage.update({
        where: { id },
        data: { sortOrder: -(i + 1) },
      })),
      ...stageIds.map((id, i) => this.prisma.unitConstructionStage.update({
        where: { id },
        data: { sortOrder: i },
      })),
    ]);

    return this.getUnitStages(unitId);
  }

  /**
   * Ad-hoc stage on ONE unit — never affects the template or any other unit.
   *
   * Takes the whole field set rather than just a label: a stage is now created from a form
   * that asks for owner, status, inspection and dates up front, so creating a bare row and
   * then editing it six more times is no longer the only path.
   */
  async addUnitStage(
    unitId: string,
    input: {
      label: string;
      ownerId?: string | null;
      status?: string;
      inspectionStatus?: string | null;
      inspectionDate?: string | null;
      startsOn?: string | null;
      endsOn?: string | null;
      notes?: string | null;
    },
    userId?: string,
  ) {
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit || unit.deletedAt) throw new NotFoundException('Unit not found');

    const label = input.label?.trim();
    if (!label) throw new BadRequestException('Give the stage a name.');

    // Appending rather than inserting: sortOrder is what the checklist reads as step order,
    // and renumbering the list to slot something in the middle would rewrite every row.
    const last = await this.prisma.unitConstructionStage.findFirst({
      where: { unitId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return this.prisma.unitConstructionStage.create({
      data: {
        unitId,
        label,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdById: userId ?? null,
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.inspectionStatus !== undefined ? { inspectionStatus: input.inspectionStatus } : {}),
        ...(input.inspectionDate ? { inspectionDate: new Date(input.inspectionDate) } : {}),
        ...(input.startsOn ? { startsOn: new Date(input.startsOn) } : {}),
        ...(input.endsOn ? { endsOn: new Date(input.endsOn) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      include: { owner: OWNER_SELECT },
    });
  }

  async updateStage(
    stageId: string,
    data: {
      status?: string;
      ownerId?: string | null;
      inspectionStatus?: string | null;
      inspectionDate?: string | null;
      startsOn?: string | null;
      endsOn?: string | null;
      notes?: string | null;
    },
  ) {
    const stage = await this.prisma.unitConstructionStage.findUnique({ where: { id: stageId } });
    if (!stage) throw new NotFoundException('Checklist stage not found');

    return this.prisma.unitConstructionStage.update({
      where: { id: stageId },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.ownerId !== undefined ? { ownerId: data.ownerId } : {}),
        ...(data.inspectionStatus !== undefined ? { inspectionStatus: data.inspectionStatus } : {}),
        ...(data.inspectionDate !== undefined
          ? { inspectionDate: data.inspectionDate ? new Date(data.inspectionDate) : null }
          : {}),
        ...(data.startsOn !== undefined
          ? { startsOn: data.startsOn ? new Date(data.startsOn) : null }
          : {}),
        ...(data.endsOn !== undefined
          ? { endsOn: data.endsOn ? new Date(data.endsOn) : null }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
      include: { owner: OWNER_SELECT },
    });
  }

  async deleteStage(stageId: string) {
    const stage = await this.prisma.unitConstructionStage.findUnique({ where: { id: stageId } });
    if (!stage) throw new NotFoundException('Checklist stage not found');
    return this.prisma.unitConstructionStage.delete({ where: { id: stageId } });
  }

  /**
   * Project rollup: every unit with a checklist, its progress count, the first
   * incomplete stage, and the full ordered stage list — the "what's next, and who's
   * behind" view for PM/Founder, and the source for the per-unit stage-progress strip
   * on the project's Construction tab. Each unit's `stages` is only ever that unit's own
   * list (seeded from its building template or built ad-hoc), so this holds up across
   * buildings whose templates differ in length or labels — nothing here assumes a shared
   * column set.
   */
  async getProjectRollup(projectId?: string, userId?: string, role?: string) {
    // No projectId means "every project I can see" — for a scoped role (Construction/PM)
    // that's their membership set, resolved the same way DashboardService.memberScope does
    // for its own cross-project aggregates; unscoped roles get no filter at all.
    let projectFilter: Prisma.BuildingWhereInput = projectId ? { projectId } : {};
    if (!projectId && userId && this.access.isScoped(role)) {
      const ids = await this.access.accessibleProjectIds(userId);
      projectFilter = { projectId: { in: ids } };
    }

    const stages = await this.prisma.unitConstructionStage.findMany({
      where: { unit: { building: projectFilter, deletedAt: null } },
      orderBy: [{ unitId: 'asc' }, { sortOrder: 'asc' }],
      include: {
        owner: OWNER_SELECT,
        unit: {
          select: {
            id: true,
            unitNumber: true,
            building: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
          },
        },
      },
    });

    const byUnit = new Map<string, typeof stages>();
    for (const s of stages) {
      const list = byUnit.get(s.unitId);
      if (list) list.push(s);
      else byUnit.set(s.unitId, [s]);
    }

    return Array.from(byUnit.values()).map((unitStages) => {
      const first = unitStages[0];
      const done = unitStages.filter((s) => s.status === 'DONE').length;
      const nextIncomplete = unitStages.find((s) => s.status !== 'DONE') ?? null;
      return {
        unit: first.unit,
        totalStages: unitStages.length,
        doneStages: done,
        nextStage: nextIncomplete ? { id: nextIncomplete.id, label: nextIncomplete.label, status: nextIncomplete.status } : null,
        stages: unitStages.map((s) => ({ id: s.id, label: s.label, status: s.status })),
      };
    });
  }
}
