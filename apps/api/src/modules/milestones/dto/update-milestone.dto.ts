import {
  IsString, IsOptional, IsEnum,
  IsDateString, IsInt, Min, MaxLength,
} from 'class-validator';
import { ProjectPhase, MilestoneStatus } from '@prisma/client';

export class UpdateMilestoneDto {
  @IsOptional() @IsString()
  projectId?: string;

  @IsOptional()
  linkedDrawScheduleId?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsEnum(ProjectPhase)
  phase?: ProjectPhase;

  @IsOptional() @IsDateString()
  dueDate?: string;

  @IsOptional() @IsEnum(MilestoneStatus)
  status?: MilestoneStatus;

  @IsOptional() @IsString()
  ownerId?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}
