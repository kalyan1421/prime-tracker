import { Module } from '@nestjs/common';
import { LeasesService } from './leases.service';
import { LeasesController } from './leases.controller';
import { LeaseObligationService } from './lease-obligation.service';
import { LeaseRentPeriodService } from './lease-rent-period.service';
import { LeaseRentInvoiceService } from './lease-rent-invoice.service';
import { AuditService } from '../../common/utils/audit.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';

@Module({
  controllers: [LeasesController],
  // LeaseObligationService (security deposits + TI allowances) and
  // LeaseRentPeriodService (escalation schedule / rent history / free rent) are exported
  // so the units, buildings and reports modules can read their rollups and as-of-date
  // rent without routing through LeasesService.
  // UnitStatusEventService is provided directly rather than by importing UnitsModule:
  // it depends only on PrismaService, and importing UnitsModule here would close a
  // cycle (units reads lease rollups). Same pattern UnitsModule itself uses.
  providers: [
    LeasesService,
    AuditService,
    LeaseObligationService,
    LeaseRentPeriodService,
    LeaseRentInvoiceService,
    UnitStatusEventService,
  ],
  exports: [LeasesService, LeaseObligationService, LeaseRentPeriodService, LeaseRentInvoiceService],
})
export class LeasesModule {}
