import { IsEnum } from 'class-validator';
import { UnitStatus } from '@prisma/client';

// Status-only update — used for the SALES role flow
// (Sales can move units through the pipeline but cannot edit other fields).
//
// Validated against the enum: this route exists precisely to let a role that cannot edit
// anything else move a unit through the pipeline, so the one field it does accept is the
// one that most needs constraining.
export class UpdateUnitStatusDto {
  @IsEnum(UnitStatus)
  status!: UnitStatus;
}
