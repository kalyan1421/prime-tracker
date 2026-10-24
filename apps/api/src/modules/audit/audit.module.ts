import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from '../../common/utils/audit.service';
import { AuditRetentionService } from './audit-retention.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditRetentionService],
  exports: [AuditService],
})
export class AuditModule {}
