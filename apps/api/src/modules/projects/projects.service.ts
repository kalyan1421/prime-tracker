import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, ProjectPhase, ProjectStatus, ProjectType } from '@prisma/client';
import { isProjectScopedRole } from '@prime-tracker/shared';
import { ProjectAccessService } from '../../common/access/project-access.service';

export interface ListProjectsParams {
  status?: ProjectStatus;
  phase?: ProjectPhase;
  projectType?: ProjectType;
  search?: string;
  sortBy?: 'name' | 'phase' | 'budget' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/**
 * Identifies the user making a read request, so the service can scope project
 * visibility. Field roles (PM/Construction/Sales/Marketing) only see projects they
 * are a ProjectMember of; everyone else sees the full portfolio. Omit `viewer` for
 * internal calls (update/delete already gate on project:edit/delete permissions).
 */
export interface ProjectViewer {
  userId: string;
  role: string;
  /** Whether the viewer may see budget/spend aggregates (budget:view). */
  canViewFinancials?: boolean;
}

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService, private access: ProjectAccessService) {}

  async findAll(params?: ListProjectsParams, viewer?: ProjectViewer) {
    const where: Prisma.ProjectWhereInput = {};
    if (params?.status) where.status = params.status;
    if (params?.phase) where.phase = params.phase;
    if (params?.projectType) where.projectType = params.projectType;
    if (params?.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { location: { contains: params.search, mode: 'insensitive' } },
        { slug: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    // Project-visibility scoping: field roles only see projects they're assigned to.
    if (viewer && isProjectScopedRole(viewer.role)) {
      where.members = { some: { userId: viewer.userId } };
    }

    const sortOrder = params?.sortOrder ?? 'desc';
    let orderBy: Prisma.ProjectOrderByWithRelationInput;
    switch (params?.sortBy) {
      case 'name':      orderBy = { name: sortOrder }; break;
      case 'phase':     orderBy = { phase: sortOrder }; break;
      case 'createdAt': orderBy = { createdAt: sortOrder }; break;
      case 'updatedAt': orderBy = { updatedAt: sortOrder }; break;
      // 'budget' is a computed aggregate — cannot sort in SQL; fall back to updatedAt
      // and sort in application layer after fetch if needed
      case 'budget':
      default:          orderBy = { updatedAt: 'desc' };
    }

    // Pagination — opt-in: only kicks in when page/pageSize are provided.
    // Otherwise return bare array (backwards compatible with existing callers).
    const paginated = params?.page !== undefined || params?.pageSize !== undefined;
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20));
    const skip = paginated ? (page - 1) * pageSize : undefined;
    const take = paginated ? pageSize : undefined;

    const [rawProjects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: {
          _count: { select: { buildings: true, milestones: true, budgetLines: true } },
          buildings: { include: { _count: { select: { units: true } } } },
          budgetLines: { select: { baselineAmt: true, revisedAmt: true } },
          actuals: { select: { amount: true } },
        },
        orderBy,
        skip,
        take,
      }),
      paginated ? this.prisma.project.count({ where }) : Promise.resolve(0),
    ]);

    const projects = rawProjects.map((p) => {
      const unitCount = p.buildings.reduce((sum, b) => sum + b._count.units, 0);
      const budgetTotal = p.budgetLines.reduce(
        (sum, b) => sum + Number(b.revisedAmt ?? b.baselineAmt ?? 0), 0,
      );
      const actualsTotal = p.actuals.reduce((sum, a) => sum + Number(a.amount ?? 0), 0);
      const { buildings, budgetLines, actuals, ...rest } = p;
      return { ...rest, unitCount, budgetTotal, actualsTotal };
    });

    if (paginated) {
      return {
        data: projects,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }
    return projects;
  }

  async findById(id: string, viewer?: ProjectViewer) {
    // Scoped roles can only open projects they're assigned to. Checked before the
    // fetch so a non-member can't tell an existing project from a missing one.
    if (viewer && isProjectScopedRole(viewer.role)) {
      await this.assertViewerCanAccess(id, viewer);
    }
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        buildings: {
          include: { units: true },
        },
        milestones: { orderBy: { sortOrder: 'asc' } },
        budgetLines: { orderBy: { category: 'asc' } },
        commitments: true,
        actuals: { orderBy: { txnDate: 'desc' } },
        loans: true,
        sales: { include: { unit: true } },
        kpiSnapshots: { orderBy: { snapshotDate: 'desc' }, take: 1 },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async findBySlug(slug: string, viewer?: ProjectViewer) {
    const project = await this.prisma.project.findUnique({ where: { slug } });
    if (!project) throw new NotFoundException('Project not found');
    return this.findById(project.id, viewer);
  }

  /** Throws NotFound if a scoped viewer isn't a member of the project. */
  private async assertViewerCanAccess(projectId: string, viewer: ProjectViewer) {
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: viewer.userId } },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Project not found');
  }

  async create(input: {
    name: string;
    slug: string;
    location: string;
    address?: string;
    acreage?: number;
    approvedBudget?: number;
    status?: ProjectStatus;
    phase?: ProjectPhase;
    projectType?: ProjectType;
    description?: string;
    startDate?: string;
    targetEnd?: string;
  }, creatorId?: string) {
    // Friendly slug uniqueness check (Prisma's P2002 is opaque)
    const existing = await this.prisma.project.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new ConflictException(`Slug '${input.slug}' is already taken`);
    }

    const data = {
      name: input.name,
      slug: input.slug,
      location: input.location,
      address: input.address,
      acreage: input.acreage,
      approvedBudget: input.approvedBudget,
      status: input.status,
      phase: input.phase,
      projectType: input.projectType,
      description: input.description,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      targetEnd: input.targetEnd ? new Date(input.targetEnd) : undefined,
    };

    // Create the project and auto-enrol the creator as a member atomically — otherwise a
    // scoped role (e.g. PM) could lose sight of the project it just created if enrolment failed.
    if (!creatorId) {
      return this.prisma.project.create({ data });
    }
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({ data });
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: creatorId } },
        create: { projectId: project.id, userId: creatorId, role: 'OWNER' },
        update: {},
      });
      return project;
    });
  }

  async update(id: string, input: {
    name?: string;
    slug?: string;
    location?: string;
    address?: string;
    acreage?: number;
    approvedBudget?: number;
    status?: ProjectStatus;
    phase?: ProjectPhase;
    projectType?: ProjectType;
    description?: string;
    startDate?: string;
    targetEnd?: string;
  }) {
    await this.findById(id);

    // If slug is being changed, ensure it's not taken by a different project
    if (input.slug) {
      const conflict = await this.prisma.project.findUnique({ where: { slug: input.slug } });
      if (conflict && conflict.id !== id) {
        throw new ConflictException(`Slug '${input.slug}' is already taken`);
      }
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        name: input.name,
        slug: input.slug,
        location: input.location,
        address: input.address,
        acreage: input.acreage,
        approvedBudget: input.approvedBudget,
        status: input.status,
        phase: input.phase,
        projectType: input.projectType,
        description: input.description,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        targetEnd: input.targetEnd ? new Date(input.targetEnd) : undefined,
      },
    });
  }

  /**
   * Set/clear the top-down Approved Budget (control total). Separate from update()
   * so it can be gated by budget:edit (Finance/Accounting/Founder/Admin) rather than
   * project:edit — Finance owns the budget but does not edit project metadata.
   */
  async setApprovedBudget(id: string, approvedBudget: number | null) {
    await this.findById(id);
    if (approvedBudget != null && (isNaN(approvedBudget) || approvedBudget < 0)) {
      throw new ConflictException('Approved budget must be a non-negative number');
    }
    return this.prisma.project.update({
      where: { id },
      data: { approvedBudget: approvedBudget ?? null },
    });
  }

  async delete(id: string) {
    await this.findById(id);
    // Soft-delete: archive by setting status to CANCELLED. The Project row is
    // preserved (audit log keeps integrity, FKs to buildings/units stay intact).
    return this.prisma.project.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  // ---- Team Members ----

  async getMembers(projectId: string) {
    return this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
      },
      orderBy: { addedAt: 'asc' },
    });
  }

  async addMember(projectId: string, userId: string, role?: string) {
    await this.findById(projectId);
    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, role: role ?? 'TEAM_MEMBER' },
      update: { role: role ?? 'TEAM_MEMBER' },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
      },
    });
  }

  async removeMember(projectId: string, userId: string) {
    return this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
  }

  // ---- Dashboard Aggregation ----

  async getDashboardSummary(viewer?: ProjectViewer) {
    // Scoped viewers only aggregate their member projects.
    const scopeWhere: Prisma.ProjectWhereInput =
      viewer && isProjectScopedRole(viewer.role)
        ? { id: { in: await this.access.accessibleProjectIds(viewer.userId) } }
        : {};

    const projects = await this.prisma.project.findMany({
      where: { status: 'ACTIVE', ...scopeWhere },
      include: {
        budgetLines: true,
        actuals: true,
        commitments: true,
        buildings: { include: { units: true } },
        loans: true,
        milestones: {
          where: {
            status: { in: ['OVERDUE', 'IN_PROGRESS'] },
          },
          orderBy: { dueDate: 'asc' },
          take: 10,
        },
      },
    });

    // Lightweight: only the phase field is needed for phase-distribution counts.
    const allProjects = await this.prisma.project.findMany({
      where: scopeWhere,
      select: { phase: true },
    });

    let totalBudget = 0;
    let totalActuals = 0;
    let totalCommitted = 0;
    let totalMonthlyLeaseIncome = 0;
    let totalMonthlyMortgage = 0;
    const unitsByStatus: Record<string, number> = {};
    const projectsByPhase: Record<string, number> = {};
    const alerts: Array<{
      id: string;
      type: string;
      severity: string;
      message: string;
      projectId?: string;
      createdAt: string;
    }> = [];

    for (const p of allProjects) {
      projectsByPhase[p.phase] = (projectsByPhase[p.phase] || 0) + 1;
    }

    for (const p of projects) {
      const budgetSum = p.budgetLines.reduce(
        (sum, b) => sum + Number(b.revisedAmt ?? b.baselineAmt),
        0,
      );
      const actualSum = p.actuals.reduce((sum, a) => sum + Number(a.amount), 0);
      const commitSum = p.commitments.reduce(
        (sum, c) => sum + Number(c.contractAmt),
        0,
      );

      totalBudget += budgetSum;
      totalActuals += actualSum;
      totalCommitted += commitSum;

      // Monthly mortgage payments
      for (const loan of p.loans) {
        totalMonthlyMortgage += Number(loan.monthlyPayment || 0);
      }

      // Unit status counts
      for (const building of p.buildings) {
        for (const unit of building.units) {
          unitsByStatus[unit.status] = (unitsByStatus[unit.status] || 0) + 1;
        }
      }

      // Budget overrun alert
      if (actualSum > budgetSum * 0.9 && budgetSum > 0) {
        alerts.push({
          id: `alert-budget-${p.id}`,
          type: 'BUDGET_OVERRUN',
          severity: actualSum > budgetSum ? 'CRITICAL' : 'HIGH',
          message: `${p.name}: Actuals at ${((actualSum / budgetSum) * 100).toFixed(0)}% of budget`,
          projectId: p.id,
          createdAt: new Date().toISOString(),
        });
      }

      // Overdue milestones
      for (const m of p.milestones) {
        if (m.status === 'OVERDUE') {
          alerts.push({
            id: `alert-milestone-${m.id}`,
            type: 'MILESTONE_OVERDUE',
            severity: 'MEDIUM',
            message: `${p.name}: "${m.title}" is overdue`,
            projectId: p.id,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    // Active lease income — use DB aggregate instead of loading all lease rows.
    const leaseAgg = await this.prisma.lease.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { monthlyRent: true },
    });
    totalMonthlyLeaseIncome = Number(leaseAgg._sum.monthlyRent ?? 0);

    // Recent comments (unit + project, merged and sorted by type)
    const [rawUnitComments, rawProjectComments] = await Promise.all([
      this.prisma.unitComment.findMany({
        take: 30,
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          unit: {
            select: {
              id: true,
              unitNumber: true,
              building: {
                select: {
                  name: true,
                  project: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.projectComment.findMany({
        take: 30,
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          project: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const TYPE_ORDER: Record<string, number> = { MARKETING: 0, SALES: 1, FINANCIAL: 2 };
    const recentComments = [
      ...rawUnitComments.map((c) => ({ ...c, source: 'unit' as const })),
      ...rawProjectComments.map((c) => ({ ...c, source: 'project' as const })),
    ]
      .sort((a, b) => {
        const tA = TYPE_ORDER[a.commentType] ?? 99;
        const tB = TYPE_ORDER[b.commentType] ?? 99;
        if (tA !== tB) return tA - tB;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 30);

    const recentMilestones = projects
      .flatMap((p) =>
        p.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          projectName: p.name,
          dueDate: m.dueDate.toISOString(),
          status: m.status,
        })),
      )
      .slice(0, 10);

    // Hide budget/spend/debt aggregates from viewers without budget:view.
    const showFinancials = !viewer || viewer.canViewFinancials !== false;
    const financials = showFinancials
      ? {
          totalBudget,
          totalActuals,
          totalCommitted,
          budgetVariance: totalBudget - totalActuals,
          totalMonthlyLeaseIncome,
          totalMonthlyMortgage,
          netMonthlyIncome: totalMonthlyLeaseIncome - totalMonthlyMortgage,
        }
      : {};

    return {
      totalProjects: allProjects.length,
      activeProjects: projects.length,
      ...financials,
      unitsByStatus,
      projectsByPhase,
      recentMilestones,
      alerts: showFinancials ? alerts : alerts.filter((a) => a.type !== 'BUDGET_OVERRUN'),
      recentComments,
    };
  }
}
