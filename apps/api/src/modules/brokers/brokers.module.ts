import { Module } from '@nestjs/common';
import { BrokersService } from './brokers.service';
import { BrokersController } from './brokers.controller';
import { AuditService } from '../../common/utils/audit.service';

/**
 * Brokers — internal-only referral tracking + commission reporting. Commission is
 * stamped on the Sale at close (SalesService); this module owns broker CRUD + the report.
 */
@Module({
  controllers: [BrokersController],
  providers: [BrokersService, AuditService],
  exports: [BrokersService],
})
export class BrokersModule {}
