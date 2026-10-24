import { IsEnum, IsNotEmpty, IsNumber, IsString, MaxLength, Min } from 'class-validator';
import { BudgetChangeReason } from '@prisma/client';

/**
 * Body for POST /budgets/:budgetLineId/revisions. Was an inline type the ValidationPipe
 * skipped, so a revision amount of "abc" or an unknown changeReason reached an append-only
 * history that cannot be corrected afterwards.
 *
 * `amount` is the line's NEW figure (the service writes it to revisedAmt), so it follows
 * the same rule as revisedAmt on the budget-line DTOs: not negative.
 */
export class CreateBudgetRevisionDto {
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }) @Min(0)
  amount!: number;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  reason!: string;

  @IsEnum(BudgetChangeReason)
  changeReason!: BudgetChangeReason;
}
