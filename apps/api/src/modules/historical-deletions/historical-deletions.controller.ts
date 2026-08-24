import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index';
import { HistoricalDeletionService } from '../../common/utils/historical-deletion.service';
import { AuditService } from '../../common/utils/audit.service';
import { EventBus } from '../../common/events/event-bus.service';
import { DecideHistoricalDeletionDto } from '../../common/dto/historical-deletion.dto';

/**
 * R27's Founder-approval queue, generalized by R6 to cover both backfilled leases and
 * backfilled sales. "Raise a request" stays on /leases/:id/request-deletion and
 * /sales/:id/request-deletion — that step needs entity-specific context (the isHistorical
 * check, the tenant name / buyer) before a request can even exist. Deciding, cancelling
 * and listing don't: a request row already names which entity it's about, and a Founder's
 * queue naturally mixes both kinds.
 */
@ApiTags('Historical Deletions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('historical-deletions')
export class HistoricalDeletionsController {
  constructor(
    private deletions: HistoricalDeletionService,
    private audit: AuditService,
    private bus: EventBus,
  ) {}

  @Get()
  // The BACKFILL permission, not DELETE: whoever raised a request has to be able to see
  // that it is pending, or they will raise it again. Founders hold both.
  @RequirePermissions('unit:history:backfill')
  @ApiOperation({
    summary: 'Deletion requests awaiting a decision (the Founder queue)',
    description: 'Pass ?status=APPROVED|REJECTED|COMPLETED to see decided ones. Mixes leases and sales.',
  })
  list(@Query('status') status?: string) {
    return this.deletions.list(status || 'PENDING');
  }

  /**
   * Approve or reject a pending request. Approving does NOT delete anything — it
   * authorises the delete, which stays a separate deliberate act. One click that both
   * approves and destroys would make the approval a formality rather than a decision.
   */
  @Post(':requestId/decide')
  @RequirePermissions('unit:history:delete')
  @ApiOperation({ summary: 'Approve or reject a historical-deletion request (lease or sale)' })
  async decide(
    @Param('requestId') requestId: string,
    @Body() body: DecideHistoricalDeletionDto,
    @CurrentUser('sub') userId: string,
  ) {
    const { decided, request } = await this.deletions.decide(requestId, body.approve, userId, body.note);
    const entity = request.leaseId ? 'Lease' : 'Sale';
    const entityId = (request.leaseId ?? request.saleId)!;
    const label = request.lease?.tenantName ?? request.sale?.buyer ?? 'a record';

    await this.audit.log({
      userId,
      action: body.approve ? 'HISTORICAL_DELETION_APPROVED' : 'HISTORICAL_DELETION_REJECTED',
      entity,
      entityId,
      newValues: { requestId, decisionNote: decided.decisionNote },
    });
    this.bus.emit({
      type: 'history.deletionDecided',
      requestId,
      leaseId: request.leaseId ?? undefined,
      saleId: request.saleId ?? undefined,
      label,
      approved: body.approve,
      note: decided.decisionNote ?? undefined,
      requestedById: request.requestedById,
      decidedById: userId,
    });
    return decided;
  }

  /**
   * Withdraw your own pending request. Only the requester, and only while it is pending —
   * a decided request is a record of what a Founder decided, and the person who asked
   * does not get to erase that.
   */
  @Post(':requestId/cancel')
  @RequirePermissions('unit:history:backfill')
  @ApiOperation({ summary: 'Withdraw your own pending deletion request' })
  async cancel(@Param('requestId') requestId: string, @CurrentUser('sub') userId: string) {
    const cancelled = await this.deletions.cancel(requestId, userId);
    await this.audit.log({
      userId,
      action: 'HISTORICAL_DELETION_CANCELLED',
      entity: cancelled.leaseId ? 'Lease' : 'Sale',
      entityId: (cancelled.leaseId ?? cancelled.saleId)!,
      newValues: { requestId },
    });
    return cancelled;
  }
}
