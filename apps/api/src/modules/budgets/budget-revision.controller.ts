import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { BudgetChangeReason } from '@prisma/client';
import { BudgetRevisionService } from './budget-revision.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators';
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
  listForProject(@Query('projectId') projectId: string) {
    return this.revisions.listForProject(projectId);
  }

  /** GET /api/budgets/:lineId/revisions  — full audit trail for a budget line */
  @Get(':lineId/revisions')
  list(@Param('lineId') lineId: string) {
    return this.revisions.listForLine(lineId);
  }

  /** POST /api/budgets/:lineId/revisions — create a new revision */
  @Post(':lineId/revisions')
  create(
    @Param('lineId') lineId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { amount: number; reason: string; changeReason: BudgetChangeReason },
  ) {
    return this.revisions.createRevision({
      budgetLineId: lineId,
      amount: body.amount,
      reason: body.reason,
      changeReason: body.changeReason,
      createdById: userId,
    });
  }

  /** POST /api/budgets/revisions/:revisionId/approve — stamp approval */
  @Post('revisions/:revisionId/approve')
  approve(@Param('revisionId') revisionId: string, @CurrentUser('sub') userId: string) {
    return this.revisions.approve(revisionId, userId);
  }
}
