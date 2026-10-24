import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for POST /units/combine — archives the source units and mints one. Was an inline
 * type the ValidationPipe skipped, so `sourceUnitIds` could be anything (a string, a
 * thousand ids) by the time the service started archiving.
 */
export class CombineUnitsDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  buildingId!: string;

  @IsArray() @ArrayMinSize(2, { message: 'Select at least two units to combine' }) @ArrayMaxSize(50)
  @IsString({ each: true })
  sourceUnitIds!: string[];

  @IsString() @IsNotEmpty() @MaxLength(50)
  unitNumber!: string;

  @IsOptional() @IsString() @MaxLength(100)
  unitType?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
