import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateBuildingDto } from './create-building.dto';

// Update cannot change projectId — buildings can't be moved between projects.
export class UpdateBuildingDto extends PartialType(
  OmitType(CreateBuildingDto, ['projectId'] as const),
) {}
