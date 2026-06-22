import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BudgetCategory } from '@prisma/client';

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    if (!projectId) throw new BadRequestException('projectId required');
    return this.prisma.budgetLine.findMany({
      where: { projectId },
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

    const [budgets, actuals, commitments] = await Promise.all([
      this.prisma.budgetLine.findMany({ where: { projectId } }),
      // Exclude interior/TI actuals — they are reported inside the interior module,
      // not against the main project's budget (would otherwise inflate variance).
      this.prisma.actual.findMany({ where: { projectId, interiorProjectId: null } }),
      this.prisma.commitment.findMany({ where: { projectId } }),
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

  async create(input: {
    projectId: string;
    category: BudgetCategory;
    description: string;
    baselineAmt: number;
    revisedAmt?: number;
    notes?: string;
  }) {
    // Verify project exists + not archived
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, status: true },
    });
    if (!project) throw new NotFoundException(`Project ${input.projectId} not found`);
    if (project.status === 'CANCELLED') {
      throw new ConflictException('Cannot add budget lines to an archived project');
    }

    return this.prisma.budgetLine.create({
      data: {
        projectId: input.projectId,
        category: input.category,
        description: input.description,
        baselineAmt: input.baselineAmt,
        revisedAmt: input.revisedAmt,
        notes: input.notes,
      },
    });
  }

  async update(id: string, input: {
    category?: BudgetCategory;
    description?: string;
    baselineAmt?: number;
    revisedAmt?: number;
    notes?: string;
  }) {
    await this.findById(id);
    return this.prisma.budgetLine.update({
      where: { id },
      data: input,
    });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.budgetLine.delete({ where: { id } });
  }
}
