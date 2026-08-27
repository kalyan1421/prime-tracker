import { IsArray, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TASK_KINDS } from '../task-kinds';
import { EmptyStringToUndefined } from '../../documents/dto/upload-document.dto';

// status/priority are deliberately plain strings, not @IsEnum — they're CustomOption-backed
// (task_status / task_priority categories), admin-configurable, not a fixed Prisma enum.
export class CreateTaskDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional() @IsString()
  buildingId?: string;

  @IsOptional() @IsString()
  unitId?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  unitIds?: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  buildingIds?: string[];

  @IsOptional() @IsIn(TASK_KINDS as unknown as string[])
  kind?: string;

  @IsString() @IsNotEmpty() @MaxLength(300)
  title!: string;

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(50)
  status?: string;

  @IsOptional() @IsString() @MaxLength(50)
  priority?: string;

  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  dueDate?: string;

  @IsOptional() @IsString()
  assignedTo?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  assigneeIds?: string[];
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300)
  title?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(50)
  status?: string;

  @IsOptional() @IsString() @MaxLength(50)
  priority?: string;

  @IsOptional() @IsDateString()
  dueDate?: string | null;

  @IsOptional() @IsString()
  assignedTo?: string | null;

  @IsOptional() @IsArray() @IsString({ each: true })
  assigneeIds?: string[];

  @IsOptional() @IsString()
  buildingId?: string | null;

  @IsOptional() @IsArray() @IsString({ each: true })
  buildingIds?: string[];

  @IsOptional() @IsString()
  unitId?: string | null;

  @IsOptional() @IsArray() @IsString({ each: true })
  unitIds?: string[];

  @IsOptional() @IsIn(TASK_KINDS as unknown as string[])
  kind?: string;
}
