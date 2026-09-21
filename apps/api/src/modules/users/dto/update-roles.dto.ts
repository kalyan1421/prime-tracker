import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum } from 'class-validator';
import { UserRole } from '@prime-tracker/shared';

/**
 * The three authorization writes on a user: primary role, role set, active status.
 *
 * Same reason CreateUserDto exists — these took inline TypeScript types, which are erased
 * at runtime, so the global ValidationPipe validated nothing. An unrecognised role string
 * reached Prisma's enum column and surfaced as a bare 500; `{"isActive":"no"}` reached
 * Prisma as a string. The service's SUPER_ADMIN checks were always in place, so this is
 * shape, not privilege.
 */
export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}

export class UpdateUserRolesDto {
  @IsArray() @ArrayNotEmpty() @IsEnum(UserRole, { each: true })
  roles!: UserRole[];
}

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
