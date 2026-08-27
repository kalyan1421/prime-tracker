import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A stage is created from a form that asks for everything up front, so the same fields the
 * edit popup offers are accepted here. Only the label is required.
 */
export class AddUnitStageDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  label!: string;

  @IsOptional() @IsString()
  ownerId?: string | null;

  @IsOptional() @IsString() @MaxLength(100)
  status?: string;

  @IsOptional() @IsString() @MaxLength(100)
  inspectionStatus?: string | null;

  @IsOptional() @IsDateString()
  inspectionDate?: string | null;

  @IsOptional() @IsDateString()
  startsOn?: string | null;

  @IsOptional() @IsDateString()
  endsOn?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string | null;
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

  @IsOptional() @IsDateString()
  startsOn?: string | null;

  @IsOptional() @IsDateString()
  endsOn?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string | null;
}
