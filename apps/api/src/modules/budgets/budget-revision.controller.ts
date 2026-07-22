import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { BudgetChangeReason } from '@prisma/client';
import { BudgetRevisionService } from './budget-revision.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';

@ApiTags('Budget Revisions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('budgets')
export class BudgetRevisionController {
  constructor(private revisions: BudgetRevisionService) {}

  /** GET /api/budgets/revisions?projectId=  — project-wide budget change log */
  @Get('revisions')
  @RequirePermissions('budget:view')
  listForProject(@Query('projectId') projectId: string) {
    return this.revisions.listForProject(projectId);
  }

  /**
   * GET /api/budgets/:budgetLineId/revisions  — full audit trail for a budget line.
   * Param is named `budgetLineId` (not `lineId`) so ProjectAccessGuard resolves the
   * owning project via KEY_ENTITY and scopes field roles to their own projects.
   */
  @Get(':budgetLineId/revisions')
  @RequirePermissions('budget:view')
  list(@Param('budgetLineId') budgetLineId: string) {
    return this.revisions.listForLine(budgetLineId);
  }

  /** POST /api/budgets/:budgetLineId/revisions — create a new revision */
  @Post(':budgetLineId/revisions')
  @RequirePermissions('budget:edit')
  create(
    @Param('budgetLineId') budgetLineId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { amount: number; reason: string; changeReason: BudgetChangeReason },
  ) {
    return this.revisions.createRevision({
      budgetLineId,
      amount: body.amount,
      reason: body.reason,
      changeReason: body.changeReason,
      createdById: userId,
    });
  }

  /** POST /api/budgets/revisions/:revisionId/approve — stamp approval */
  @Post('revisions/:revisionId/approve')
  @RequirePermissions('budget:edit')
  approve(@Param('revisionId') revisionId: string, @CurrentUser('sub') userId: string) {
    return this.revisions.approve(revisionId, userId);
  }
}
