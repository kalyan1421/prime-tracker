import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddTemplateItemDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  label!: string;
}
