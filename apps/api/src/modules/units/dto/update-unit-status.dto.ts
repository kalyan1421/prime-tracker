import { IsEnum } from 'class-validator';
import { UnitStatus } from '@prisma/client';

// Status-only update — used for the SALES role flow
// (Sales can move units through the pipeline but cannot edit other fields).
export class UpdateUnitStatusDto {
  @IsEnum(UnitStatus)
  status!: UnitStatus;
}
