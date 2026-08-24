import { Module } from '@nestjs/common';
import { LeasesService } from './leases.service';
import { LeasesController } from './leases.controller';
import { LeaseObligationService } from './lease-obligation.service';
import { LeaseRentPeriodService } from './lease-rent-period.service';
import { LeaseRentInvoiceService } from './lease-rent-invoice.service';
import { LeaseImportService } from './lease-import.service';
import { AuditService } from '../../common/utils/audit.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';
import { CommissionInstallmentService } from '../../common/utils/commission-installment.service';
import { HistoricalDeletionService } from '../../common/utils/historical-deletion.service';

@Module({
  controllers: [LeasesController],
  // LeaseObligationService (security deposits + TI allowances) and
  // LeaseRentPeriodService (escalation schedule / rent history / free rent) are exported
  // so the units, buildings and reports modules can read their rollups and as-of-date
  // rent without routing through LeasesService.
  // UnitStatusEventService, CommissionInstallmentService and HistoricalDeletionService are
  // provided directly rather than by importing their owning modules: all three depend
  // only on PrismaService, and importing UnitsModule/BrokersModule/
  // HistoricalDeletionsModule here would risk a cycle. Same pattern UnitsModule itself uses.
  providers: [
    LeasesService,
    AuditService,
    LeaseObligationService,
    LeaseRentPeriodService,
    LeaseRentInvoiceService,
    UnitStatusEventService,
    CommissionInstallmentService,
    HistoricalDeletionService,
    LeaseImportService,
  ],
  exports: [
    LeasesService,
    LeaseObligationService,
    LeaseRentPeriodService,
    LeaseRentInvoiceService,
    CommissionInstallmentService,
    HistoricalDeletionService,
    LeaseImportService,
  ],
})
export class LeasesModule {}
