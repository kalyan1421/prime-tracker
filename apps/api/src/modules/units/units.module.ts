import { Module } from '@nestjs/common';
import { UnitsService } from './units.service';
import { UnitsController } from './units.controller';
import { StaleUnitsCron } from './stale-units.cron';
import { AuditService } from '../../common/utils/audit.service';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';
import { UnitHistoryService } from './unit-history.service';

@Module({
  controllers: [UnitsController],
  providers: [UnitsService, StaleUnitsCron, AuditService, UnitStatusEventService, UnitHistoryService],
  exports: [UnitsService, UnitStatusEventService, UnitHistoryService],
})
export class UnitsModule {}
