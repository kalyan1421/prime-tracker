import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddUnitStageDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  label!: string;
}

/** Every field optional — a stage update usually touches one thing (a status pill, an owner). */
export class UpdateUnitStageDto {
  @IsOptional() @IsString() @MaxLength(100)
  status?: string;

  @IsOptional() @IsString()
  ownerId?: string | null;

  @IsOptional() @IsString() @MaxLength(100)
  inspectionStatus?: string | null;

  @IsOptional() @IsDateString()
  inspectionDate?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string | null;
}
