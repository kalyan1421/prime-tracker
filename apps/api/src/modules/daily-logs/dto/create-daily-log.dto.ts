import { IsString, IsNotEmpty, IsOptional, IsDateString, IsInt, Min, MaxLength } from 'class-validator';
import { EmptyStringToUndefined } from '../../documents/dto/upload-document.dto';

export class CreateDailyLogDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional() @IsString()
  buildingId?: string;

  /**
   * Which unit this update is about. The column has existed on DailyLog since the model was
   * added ("per-unit fit-out progress had nowhere to go") but nothing in this module ever
   * read or wrote it, so every log was building-level in practice. Still optional: a
   * site-wide log (weather, crew count, a concrete pour) genuinely is not about one unit.
   */
  @IsOptional() @IsString()
  unitId?: string;

  /** Replying to an existing update. One level only — see resolveParent(). */
  @IsOptional() @IsString()
  parentId?: string;

  /** Optionally pins this update to one of the unit's checklist stages. */
  @IsOptional() @IsString()
  stageId?: string;

  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  logDate?: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  notes!: string;

  @IsOptional() @IsString() @MaxLength(200)
  weather?: string;

  @IsOptional() @IsInt() @Min(0)
  crewCount?: number;
}

export class UpdateDailyLogDto {
  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  logDate?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsString() @MaxLength(200)
  weather?: string;

  @IsOptional() @IsInt() @Min(0)
  crewCount?: number;

  @IsOptional() @IsString()
  buildingId?: string | null;

  @IsOptional() @IsString()
  unitId?: string | null;

  @IsOptional() @IsString()
  stageId?: string | null;
}

export class AddDailyLogPhotoDto {
  @IsString() @IsNotEmpty()
  storagePath!: string;

  @IsOptional() @IsString() @MaxLength(300)
  caption?: string;
}
