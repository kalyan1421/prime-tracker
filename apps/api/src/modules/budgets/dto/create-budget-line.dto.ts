import {
  IsString, IsNotEmpty, MinLength, MaxLength,
  IsOptional, IsNumber, Min,
} from 'class-validator';

export class CreateBudgetLineDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  // Optional building/unit scoping — see BudgetLine schema comment. Neither set = the
  // existing project-level line.
  @IsOptional() @IsString()
  buildingId?: string;

  @IsOptional() @IsString()
  unitId?: string;

  // Free-text key backed by CustomOption (category="budget_category") — see schema
  // comment. Not validated against the live option list here, same as Unit/Sale/Lead
  // status elsewhere: the picker on the frontend is the only source of values in practice.
  @IsString() @IsNotEmpty() @MaxLength(100)
  category!: string;

  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(200)
  description!: string;

  @IsNumber() @Min(0)
  baselineAmt!: number;

  @IsOptional() @IsNumber() @Min(0)
  revisedAmt?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
