import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateBudgetLineDto } from './create-budget-line.dto';

// Update cannot move a line to a different project.
export class UpdateBudgetLineDto extends PartialType(
  OmitType(CreateBudgetLineDto, ['projectId'] as const),
) {}
