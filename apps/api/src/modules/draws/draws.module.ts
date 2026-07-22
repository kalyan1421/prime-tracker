import { Module } from '@nestjs/common';
import { DrawsService } from './draws.service';
import { DrawsController } from './draws.controller';
import { DrawFundingOverdueCron } from './draw-funding-overdue.cron';
import { DrawEventHandlers } from './draw-event-handlers.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ProjectHealthModule } from '../project-health/project-health.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditService } from '../../common/utils/audit.service';

/**
 * Draws module — workflow + cross-feature event handlers.
 *
 * The CRUD endpoints for DrawRequest still live in LoansModule for now
 * (they're entangled with loan reads). This module owns:
 *   - State machine + workflow transitions (DrawsService)
 *   - Document checklist + attachment
 *   - Funding-overdue cron
 *   - The cross-feature event handlers that wire all 7 features together
 */
@Module({
  imports: [DashboardModule, ProjectHealthModule, NotificationsModule],
  controllers: [DrawsController],
  providers: [DrawsService, DrawFundingOverdueCron, DrawEventHandlers, AuditService],
  exports: [DrawsService],
})
export class DrawsModule {}
