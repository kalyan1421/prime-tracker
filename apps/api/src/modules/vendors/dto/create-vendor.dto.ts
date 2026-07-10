import { IsString, IsNotEmpty, IsOptional, IsEmail, MaxLength } from 'class-validator';

export class CreateVendorDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(200)
  contactName?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(100)
  trade?: string;
}
