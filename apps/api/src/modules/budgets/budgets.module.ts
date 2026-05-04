import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService, AuditService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
