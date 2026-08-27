import { IsString, IsNotEmpty, IsOptional, IsInt, Min, IsBoolean, MaxLength } from 'class-validator';

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
