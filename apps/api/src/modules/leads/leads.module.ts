import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [LeadsController],
  providers: [LeadsService, AuditService],
  exports: [LeadsService],
})
export class LeadsModule {}
