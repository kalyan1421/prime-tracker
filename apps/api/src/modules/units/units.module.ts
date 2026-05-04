import { Module } from '@nestjs/common';
import { UnitsService } from './units.service';
import { UnitsController } from './units.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [UnitsController],
  providers: [UnitsService, AuditService],
  exports: [UnitsService],
})
export class UnitsModule {}
