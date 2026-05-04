import { Module } from '@nestjs/common';
import { LeasesService } from './leases.service';
import { LeasesController } from './leases.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [LeasesController],
  providers: [LeasesService, AuditService],
  exports: [LeasesService],
})
export class LeasesModule {}
