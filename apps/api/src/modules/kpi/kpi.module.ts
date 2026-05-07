import { Module } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { KpiController } from './kpi.controller';
import { KpiPrecomputeService } from './kpi-precompute.service';

@Module({
  controllers: [KpiController],
  providers: [KpiService, KpiPrecomputeService],
  exports: [KpiService, KpiPrecomputeService],
})
export class KpiModule {}
