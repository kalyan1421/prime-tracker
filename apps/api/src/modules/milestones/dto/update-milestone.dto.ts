import {
  IsString, IsOptional,
  IsDateString, IsInt, Min, MaxLength,
} from 'class-validator';

export class UpdateMilestoneDto {
  @IsOptional() @IsString()
  projectId?: string;

  @IsOptional()
  linkedDrawScheduleId?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsString()
  phase?: string;

  @IsOptional() @IsDateString()
  dueDate?: string;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  ownerId?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}
