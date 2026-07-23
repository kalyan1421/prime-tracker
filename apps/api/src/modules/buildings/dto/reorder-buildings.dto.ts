import { IsString, IsNotEmpty, IsArray, ArrayMinSize, ArrayUnique } from 'class-validator';

export class ReorderBuildingsDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsString({ each: true })
  buildingIds!: string[];
}
