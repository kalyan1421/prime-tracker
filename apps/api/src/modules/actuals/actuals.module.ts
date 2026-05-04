import { Module } from '@nestjs/common';
import { ActualsService } from './actuals.service';
import { ActualsController } from './actuals.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [ActualsController],
  providers: [ActualsService, AuditService],
  exports: [ActualsService],
})
export class ActualsModule {}
