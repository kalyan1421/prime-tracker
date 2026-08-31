import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength,
} from 'class-validator';

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

/**
 * Adding several stages at once — the "pick all seventeen" case.
 *
 * Labels rather than template-item ids: a stage on a unit is a copy that stops tracking
 * its source the moment it exists (the past is immutable — see UnitConstructionStage),
 * so carrying an id through would imply a link the model does not have. It also lets one
 * call mix template stages with a typed-in one.
 *
 * Capped at 200 to keep one request from writing an unbounded batch; no real building's
 * stage list comes close.
 */
export class AddUnitStagesDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(200)
  @IsString({ each: true }) @MaxLength(200, { each: true })
  labels!: string[];
}

/** The unit's stages, in the order they should now appear. Must name every one of them. */
export class ReorderUnitStagesDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500)
  @IsString({ each: true })
  stageIds!: string[];
}
