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
      this.prisma.actual.findMany({ where: { projectId } }),
      this.prisma.commitment.findMany({ where: { projectId } }),
    ]);

    const budgetTotal = budgets.reduce(
      (s, b) => s + Number(b.revisedAmt ?? b.baselineAmt), 0,
    );
    const actualTotal = actuals.reduce((s, a) => s + Number(a.amount), 0);
    const committedTotal = commitments.reduce((s, c) => s + Number(c.contractAmt), 0);
    const forecastTotal =
      Math.max(committedTotal, actualTotal) + (budgetTotal - committedTotal) * 0.1;

    const byCategory = budgets.map((b) => {
      const catActuals = actuals
        .filter((a) => a.category === b.category)
        .reduce((s, a) => s + Number(a.amount), 0);
      const catCommitted = commitments
        .filter((c) => c.category === b.category)
        .reduce((s, c) => s + Number(c.contractAmt), 0);
      const budget = Number(b.revisedAmt ?? b.baselineAmt);
      return {
        category: b.category,
        description: b.description,
        budget,
        actual: catActuals,
        committed: catCommitted,
        forecast: Math.max(catCommitted, catActuals),
        variance: budget - catActuals,
      };
    });

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
