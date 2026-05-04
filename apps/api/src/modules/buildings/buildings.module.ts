import { Module } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { BuildingsController } from './buildings.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [BuildingsController],
  providers: [BuildingsService, AuditService],
  exports: [BuildingsService],
})
export class BuildingsModule {}
