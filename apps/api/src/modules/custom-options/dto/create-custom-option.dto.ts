import {
  IsString, IsNotEmpty, IsOptional, IsInt, Min, IsBoolean, MaxLength, IsArray, ArrayNotEmpty,
} from 'class-validator';

export class CreateCustomOptionDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  category!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  value!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  label!: string;

  @IsOptional() @IsString() @MaxLength(50)
  color?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

export class UpdateCustomOptionDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  label?: string;

  @IsOptional() @IsString() @MaxLength(50)
  color?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

/**
 * The COMPLETE ordered list for one category, not a pair to swap.
 *
 * Swapping two rows takes two writes, and between them both rows briefly hold the same
 * sortOrder — the list re-sorts under the person clicking, and two quick clicks act on
 * indices that have already moved. Sending the whole order makes it one transaction with
 * one meaning. Same reason ConstructionChecklistService.reorderUnitStages refuses a
 * partial list.
 */
export class ReorderCustomOptionsDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  category!: string;

  @IsArray() @ArrayNotEmpty() @IsString({ each: true })
  ids!: string[];
}
