import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Admin edit of another user's details.
 *
 * This route previously took an inline `{ name?, email? }` type. TypeScript types do
 * not exist at runtime and the global ValidationPipe only whitelists against a DTO
 * CLASS, so the raw body was spread straight into `prisma.user.update` — sending
 * `{"role":"SUPER_ADMIN","isActive":false}` to the "update name/email" route applied
 * both. It required user:manage so it was not privilege escalation, but it wrote
 * `role` while leaving `roles[]` untouched, desyncing the two. That matters now that
 * scoping and permissions both read `roles[]`.
 *
 * Role, roles and active status are deliberately absent: they have dedicated routes
 * (`:id/role`, `:id/roles`, `:id/status`) that keep the primary and the array in step.
 */
export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @IsOptional() @IsEmail() @MaxLength(255)
  email?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(120)
  jobTitle?: string;
}
