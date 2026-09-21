import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { AuditService } from '../../common/utils/audit.service';
// Needed for @mention notifications on the lead discussion thread.
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [LeadsController],
  providers: [LeadsService, AuditService],
  exports: [LeadsService],
})
export class LeadsModule {}
