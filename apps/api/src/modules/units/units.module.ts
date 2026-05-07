import { Module } from '@nestjs/common';
import { UnitsService } from './units.service';
import { UnitsController } from './units.controller';
import { StaleUnitsCron } from './stale-units.cron';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [UnitsController],
  providers: [UnitsService, StaleUnitsCron, AuditService],
  exports: [UnitsService],
})
export class UnitsModule {}
