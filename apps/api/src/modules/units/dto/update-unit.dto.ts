import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateUnitDto } from './create-unit.dto';

// Update cannot move a unit between buildings — too many side effects
// (leases, sales, comments tied to the old location). Delete and re-create.
export class UpdateUnitDto extends PartialType(
  OmitType(CreateUnitDto, ['buildingId'] as const),
) {}
