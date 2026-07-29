import { Module } from '@nestjs/common';
import { LeasesService } from './leases.service';
import { LeasesController } from './leases.controller';
import { LeaseObligationService } from './lease-obligation.service';
import { LeaseRentPeriodService } from './lease-rent-period.service';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [LeasesController],
  // LeaseObligationService (security deposits + TI allowances) and
  // LeaseRentPeriodService (escalation schedule / rent history / free rent) are exported
  // so the units, buildings and reports modules can read their rollups and as-of-date
  // rent without routing through LeasesService.
  providers: [LeasesService, AuditService, LeaseObligationService, LeaseRentPeriodService],
  exports: [LeasesService, LeaseObligationService, LeaseRentPeriodService],
})
export class LeasesModule {}
