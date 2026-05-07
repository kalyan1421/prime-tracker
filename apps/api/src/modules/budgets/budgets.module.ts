import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { BudgetRevisionService } from './budget-revision.service';
import { BudgetRevisionController } from './budget-revision.controller';
import { VarianceAlertCron } from './variance-alert.cron';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [BudgetsController, BudgetRevisionController],
  providers: [BudgetsService, BudgetRevisionService, VarianceAlertCron, AuditService],
  exports: [BudgetsService, BudgetRevisionService],
})
export class BudgetsModule {}
