import { Module } from '@nestjs/common';
import { CashFlowService } from './cashflow.service';
import { CashFlowController } from './cashflow.controller';

@Module({
  controllers: [CashFlowController],
  providers: [CashFlowService],
  exports: [CashFlowService],
})
export class CashFlowModule {}
