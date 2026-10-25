import { IsNumber, Min, ValidateIf } from 'class-validator';

/**
 * Body for PUT /projects/:id/approved-budget. `approvedBudget` must be SENT: a number sets
 * the control total, an explicit `null` clears it. It was an inline type the pipe skipped,
 * so `{}` (or a typo'd key) silently cleared Finance's control total, and "abc" reached a
 * Decimal column.
 */
export class SetApprovedBudgetDto {
  @ValidateIf((o) => o.approvedBudget !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }) @Min(0)
  approvedBudget!: number | null;
}
