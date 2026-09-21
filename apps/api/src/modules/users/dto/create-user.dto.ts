import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prime-tracker/shared';

/**
 * Creating a user.
 *
 * This route previously took an inline `{ email, name, role?, roles?, password? }` type.
 * TypeScript types are erased at runtime and the global ValidationPipe only validates
 * against a DTO CLASS, so `whitelist`/`forbidNonWhitelisted` did nothing here: the email
 * was never checked for shape, and `role`/`roles` were never checked against the enum, so
 * a typo reached Prisma's enum column and came back as a bare 500 instead of a 400.
 * Every sibling route (UpdateUserDto, UpdateProfileDto, SetUserPasswordDto) already had
 * one; this was the gap.
 *
 * Shape only. WHICH roles this particular actor may grant is a policy question that needs
 * the caller's own identity, so it lives in UsersService.create() next to the same checks
 * updateRole()/updateRoles() already make.
 *
 * Fields are limited to what create() actually persists — the Add User modal sends exactly
 * name/email/roles/password, and `forbidNonWhitelisted` turns anything else into a 400
 * rather than silently dropping it.
 *
 * Password bounds match SetUserPasswordDto and ChangePasswordDto so all three agree; the
 * 72-byte ceiling is bcrypt's, which silently truncates past it.
 */
export class CreateUserDto {
  @IsEmail() @MaxLength(255)
  email!: string;

  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @IsOptional() @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional() @IsArray() @ArrayNotEmpty() @IsEnum(UserRole, { each: true })
  roles?: UserRole[];

  @IsOptional() @IsString() @MinLength(8) @MaxLength(72)
  password?: string;
}
