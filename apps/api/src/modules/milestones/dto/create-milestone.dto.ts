import {
  IsString, IsNotEmpty, IsOptional, IsEnum,
  IsDateString, IsInt, Min, MaxLength,
} from 'class-validator';
import { ProjectPhase, MilestoneStatus } from '@prisma/client';

export class CreateMilestoneDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional() @IsString()
  linkedDrawScheduleId?: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsEnum(ProjectPhase)
  phase!: ProjectPhase;

  @IsDateString()
  dueDate!: string;

  @IsOptional() @IsEnum(MilestoneStatus)
  status?: MilestoneStatus;

  @IsOptional() @IsString()
  ownerId?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}
