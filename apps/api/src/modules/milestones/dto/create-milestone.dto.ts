import {
  IsString, IsNotEmpty, IsOptional,
  IsDateString, IsInt, Min, MaxLength,
} from 'class-validator';

export class CreateMilestoneDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional() @IsString()
  linkedDrawScheduleId?: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsString()
  phase!: string;

  @IsDateString()
  dueDate!: string;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  ownerId?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}
