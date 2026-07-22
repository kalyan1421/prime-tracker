import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveProjectScope } from '../../common/utils/resolve-project-scope';
import { BudgetRevisionService } from './budget-revision.service';

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService, private revisions: BudgetRevisionService) {}

  async findByProject(projectId: string) {
    if (!projectId) throw new BadRequestException('projectId required');
    return this.prisma.budgetLine.findMany({
      where: { projectId },
      orderBy: [{ category: 'asc' }, { description: 'asc' }],
    });
  }

  async findByBuilding(buildingId: string) {
    if (!buildingId) throw new BadRequestException('buildingId required');
    return this.prisma.budgetLine.findMany({
      where: { buildingId },
      orderBy: [{ category: 'asc' }, { description: 'asc' }],
    });
  }

  async findByUnit(unitId: string) {
    if (!unitId) throw new BadRequestException('unitId required');
    return this.prisma.budgetLine.findMany({
      where: { unitId },
      orderBy: [{ category: 'asc' }, { description: 'asc' }],
    });
  }

  async findById(id: string) {
    const line = await this.prisma.budgetLine.findUnique({ where: { id } });
    if (!line) throw new NotFoundException('Budget line not found');
    return line;
  }

  async getFinancialSummary(projectId: string) {
    if (!projectId) throw new BadRequestException('projectId required');
    return this.summarize(projectId, { projectId });
  }

  // Building/unit summaries reuse the exact project-summary shape (budget, actual,
  // committed, forecast, variance, byCategory) so the same UI component renders all
  // three — just scoped to that building's/unit's own budget lines, actuals, and
  // commitments instead of the whole project.
  async getBuildingSummary(buildingId: string) {
    if (!buildingId) throw new BadRequestException('buildingId required');
    const building = await this.prisma.building.findUnique({ where: { id: buildingId }, select: { projectId: true } });
    if (!building) throw new NotFoundException('Building not found');
    return this.summarize(building.projectId, { buildingId });
  }

  async getUnitSummary(unitId: string) {
    if (!unitId) throw new BadRequestException('unitId required');
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId }, select: { building: { select: { projectId: true } } } });
    if (!unit) throw new NotFoundException('Unit not found');
    return this.summarize(unit.building.projectId, { unitId });
  }

  private async summarize(projectId: string, scope: { projectId: string } | { buildingId: string } | { unitId: string }) {
    const [budgets, actuals, commitments] = await Promise.all([
      this.prisma.budgetLine.findMany({ where: scope }),
      // Exclude interior/TI actuals — they are reported inside the interior module,
      // not against the main project's budget (would otherwise inflate variance).
      this.prisma.actual.findMany({ where: { ...scope, interiorProjectId: null } }),
      this.prisma.commitment.findMany({ where: scope }),
    ]);

    const budgetTotal = budgets.reduce(
      (s, b) => s + Number(b.revisedAmt ?? b.baselineAmt), 0,
    );
    const actualTotal = actuals.reduce((s, a) => s + Number(a.amount), 0);
    const committedTotal = commitments.reduce((s, c) => s + Number(c.contractAmt), 0);
    const forecastTotal =
      Math.max(committedTotal, actualTotal) + (budgetTotal - committedTotal) * 0.1;

    // Group budget lines by category so each category appears once with summed amounts.
    const categoryMap = new Map<string, { budget: number; actual: number; committed: number }>();
    for (const b of budgets) {
      const cat = b.category as string;
      const existing = categoryMap.get(cat) ?? { budget: 0, actual: 0, committed: 0 };
      existing.budget += Number(b.revisedAmt ?? b.baselineAmt);
      categoryMap.set(cat, existing);
    }
    for (const a of actuals) {
      const cat = a.category as string;
      const existing = categoryMap.get(cat);
      if (existing) existing.actual += Number(a.amount);
    }
    for (const c of commitments) {
      const cat = c.category as string;
      const existing = categoryMap.get(cat);
      if (existing) existing.committed += Number(c.contractAmt);
    }
    const byCategory = Array.from(categoryMap.entries()).map(([category, v]) => ({
      category,
      budget: v.budget,
      actual: v.actual,
      committed: v.committed,
      forecast: Math.max(v.committed, v.actual),
      variance: v.budget - v.actual,
    }));

    return {
      projectId,
      budgetTotal,
      actualTotal,
      committedTotal,
      forecastTotal,
      variance: budgetTotal - actualTotal,
      variancePercent: budgetTotal > 0 ? (budgetTotal - actualTotal) / budgetTotal : 0,
      byCategory,
    };
  }

  // Building/unit report — every building and unit in a project side-by-side, for the
  // "Budget Tracking by Building/Unit" report. Fetches each source table once for the
  // whole project (rather than calling summarize() per building/unit, which would be
  // N+1) and buckets rows in-memory. A unit-scoped row always carries a derived
  // buildingId too (see resolve-project-scope.ts), so bucketing by buildingId naturally
  // rolls unit-level rows up into their building's total — matching getBuildingSummary.
  async getBuildingUnitReport(projectId: string) {
    if (!projectId) throw new BadRequestException('projectId required');

    const [buildings, units, budgets, actuals, commitments] = await Promise.all([
      this.prisma.building.findMany({
        where: { projectId, deletedAt: null },
        select: { id: true, name: true, buildingType: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.unit.findMany({
        where: { building: { projectId, deletedAt: null }, deletedAt: null },
        select: { id: true, unitNumber: true, buildingId: true },
        orderBy: { unitNumber: 'asc' },
      }),
      this.prisma.budgetLine.findMany({ where: { projectId } }),
      this.prisma.actual.findMany({ where: { projectId, interiorProjectId: null } }),
      this.prisma.commitment.findMany({ where: { projectId } }),
    ]);

    type Totals = { budget: number; actual: number; committed: number };
    const empty = (): Totals => ({ budget: 0, actual: 0, committed: 0 });
    const projectTotal = empty();
    const unassigned = empty();
    const byBuilding = new Map<string, Totals>();
    const byUnit = new Map<string, Totals>();

    const add = (t: Totals, field: keyof Totals, amount: number) => { t[field] += amount; };
    const bucket = (buildingId: string | null, unitId: string | null, field: keyof Totals, amount: number) => {
      add(projectTotal, field, amount);
      if (unitId) {
        const t = byUnit.get(unitId) ?? empty();
        add(t, field, amount);
        byUnit.set(unitId, t);
      }
      if (buildingId) {
        const t = byBuilding.get(buildingId) ?? empty();
        add(t, field, amount);
        byBuilding.set(buildingId, t);
      } else if (!unitId) {
        add(unassigned, field, amount);
      }
    };

    for (const b of budgets) bucket(b.buildingId, b.unitId, 'budget', Number(b.revisedAmt ?? b.baselineAmt));
    for (const a of actuals) bucket(a.buildingId, a.unitId, 'actual', Number(a.amount));
    for (const c of commitments) bucket(c.buildingId, c.unitId, 'committed', Number(c.contractAmt));

    const toRow = (t: Totals) => ({
      budgetTotal: t.budget,
      actualTotal: t.actual,
      committedTotal: t.committed,
      remaining: t.budget - Math.max(t.actual, t.committed),
      variance: t.budget - t.actual,
      variancePercent: t.budget > 0 ? (t.budget - t.actual) / t.budget : 0,
    });

    const unitsByBuilding = new Map<string, typeof units>();
    for (const u of units) {
      const list = unitsByBuilding.get(u.buildingId) ?? [];
      list.push(u);
      unitsByBuilding.set(u.buildingId, list);
    }

    return {
      projectId,
      project: toRow(projectTotal),
      unassigned: toRow(unassigned),
      buildings: buildings.map((b) => ({
        id: b.id,
        name: b.name,
        buildingType: b.buildingType,
        ...toRow(byBuilding.get(b.id) ?? empty()),
        units: (unitsByBuilding.get(b.id) ?? []).map((u) => ({
          id: u.id,
          unitNumber: u.unitNumber,
          ...toRow(byUnit.get(u.id) ?? empty()),
        })),
      })),
    };
  }

  async create(input: {
    projectId: string;
    buildingId?: string;
    unitId?: string;
    category: string;
    description: string;
    baselineAmt: number;
    revisedAmt?: number;
    notes?: string;
  }, createdById: string) {
    // Verify project exists + not archived
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, status: true },
    });
    if (!project) throw new NotFoundException(`Project ${input.projectId} not found`);
    if (project.status === 'CANCELLED') {
      throw new ConflictException('Cannot add budget lines to an archived project');
    }

    const { buildingId, unitId } = await resolveProjectScope(this.prisma, input.projectId, input.buildingId, input.unitId);

    const line = await this.prisma.budgetLine.create({
      data: {
        projectId: input.projectId,
        buildingId,
        unitId,
        category: input.category,
        description: input.description,
        baselineAmt: input.baselineAmt,
        revisedAmt: input.revisedAmt,
        notes: input.notes,
      },
    });

    // Per BudgetRevisionService's documented lifecycle: creating a line starts its
    // append-only revision trail at #1, with the baseline as the initial amount.
    // Without this, the Budget Change Log stays empty forever — nothing else ever
    // logs a line's creation.
    await this.revisions.createRevision({
      budgetLineId: line.id,
      amount: Number(input.revisedAmt ?? input.baselineAmt),
      reason: 'Initial budget line created',
      changeReason: 'OTHER',
      createdById,
    });

    return line;
  }

  async update(id: string, input: {
    buildingId?: string | null;
    unitId?: string | null;
    category?: string;
    description?: string;
    baselineAmt?: number;
    revisedAmt?: number;
    notes?: string;
  }) {
    const line = await this.findById(id);
    const data: Record<string, unknown> = { ...input };

    // Re-scoping: resolve against the line's own project, same as create(). A field
    // mentioned in the payload at all (real id or explicit null) reassigns scope;
    // omitting both leaves the existing scope untouched.
    if (input.buildingId !== undefined || input.unitId !== undefined) {
      const resolved = await resolveProjectScope(this.prisma, line.projectId, input.buildingId ?? undefined, input.unitId ?? undefined);
      data.buildingId = resolved.buildingId ?? null;
      data.unitId = resolved.unitId ?? null;
    }

    return this.prisma.budgetLine.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.budgetLine.delete({ where: { id } });
  }
}
