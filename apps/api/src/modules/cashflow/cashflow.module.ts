import { Module } from '@nestjs/common';
import { CashFlowService } from './cashflow.service';
import { CashFlowController } from './cashflow.controller';
import { CashflowEngineService } from './cashflow-engine.service';

@Module({
  controllers: [CashFlowController],
  providers: [CashFlowService, CashflowEngineService],
  // CashflowEngineService is exported so the budgets module can build the
  // cash-obligations ("budget needed") view from the same projection.
  exports: [CashFlowService, CashflowEngineService],
})
export class CashFlowModule {}
