import { IsString } from 'class-validator';

// Status-only update — used for the SALES role flow
// (Sales can move units through the pipeline but cannot edit other fields).
export class UpdateUnitStatusDto {
  @IsString()
  status!: string;
}
