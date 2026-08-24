import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const OWNER_SELECT = { select: { id: true, name: true, email: true } } as const;

@Injectable()
export class ConstructionChecklistService {
  constructor(private prisma: PrismaService) {}

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
    return this.prisma.unitConstructionStage.findMany({
      where: { unitId },
      orderBy: { sortOrder: 'asc' },
      include: { owner: OWNER_SELECT },
    });
  }

  /**
   * One-time seed from the unit's building template. Refuses on a unit that already has
   * ANY stages — re-running the template over live progress would either duplicate rows
   * or silently discard what was recorded. Add stages individually past this point.
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

    const template = await this.getTemplate(unit.buildingId);
    if (template.length === 0) {
      throw new BadRequestException('This unit\'s building has no template stages to apply yet.');
    }

    await this.prisma.unitConstructionStage.createMany({
      data: template.map((t) => ({
        unitId,
        sortOrder: t.sortOrder,
        label: t.label,
        createdById: userId ?? null,
      })),
    });
    return this.getUnitStages(unitId);
  }

  /** Ad-hoc stage on ONE unit — never affects the template or any other unit. */
  async addUnitStage(unitId: string, label: string, userId?: string) {
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit || unit.deletedAt) throw new NotFoundException('Unit not found');

    const last = await this.prisma.unitConstructionStage.findFirst({
      where: { unitId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return this.prisma.unitConstructionStage.create({
      data: {
        unitId,
        label: label.trim(),
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdById: userId ?? null,
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
  async getProjectRollup(projectId: string) {
    const stages = await this.prisma.unitConstructionStage.findMany({
      where: { unit: { building: { projectId }, deletedAt: null } },
      orderBy: [{ unitId: 'asc' }, { sortOrder: 'asc' }],
      include: {
        owner: OWNER_SELECT,
        unit: { select: { id: true, unitNumber: true, building: { select: { id: true, name: true } } } },
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
