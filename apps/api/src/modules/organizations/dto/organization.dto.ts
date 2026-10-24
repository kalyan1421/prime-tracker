import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrgRole } from '@prisma/client';

/**
 * Organization bodies. These took inline types the ValidationPipe skipped — notably
 * `orgRole`, a free string the service cast `as any` into the OrgRole enum column, so a
 * typo surfaced as a Prisma 500 rather than a 400.
 */
export class CreateOrganizationDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(100)
  entityType?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;
}

export class UpdateOrganizationDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsString() @MaxLength(100)
  entityType?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;
}

export class AddOrganizationMemberDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  userId!: string;

  @IsEnum(OrgRole)
  orgRole!: OrgRole;
}
