import { IsArray, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TASK_KINDS, TaskKind } from '../tasks.service';

export class CreateTaskUpdateDto {
  @IsString() @IsNotEmpty() @MaxLength(5000)
  content!: string;

  /**
   * The day being reported. Defaults to today. Backdating is allowed — site notes are
   * routinely written up the next morning — but the service refuses future dates,
   * which are always a typo.
   */
  @IsOptional() @IsDateString()
  updateDate?: string;
}

export class AddTaskUpdatePhotoDto {
  @IsString() @IsNotEmpty()
  storagePath!: string;

  @IsOptional() @IsString() @MaxLength(300)
  caption?: string;
}

/** Mixed into the task create/update DTOs — the multi-unit link and the discriminator. */
export class TaskUnitsDto {
  @IsOptional() @IsArray() @IsString({ each: true })
  unitIds?: string[];

  @IsOptional() @IsIn(TASK_KINDS as unknown as string[])
  kind?: TaskKind;
}
