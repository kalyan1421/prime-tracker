import {
  IsEmail, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min,
} from 'class-validator';
import { LeadSource } from '@prisma/client';

/**
 * Lead bodies. These routes previously used inline `@Body() body: { … }` types.
 * TypeScript types do not exist at runtime and the global ValidationPipe only
 * whitelists against a DTO CLASS, so nothing was validated and any field in the
 * request reached Prisma.
 *
 * That is how campaign attribution came to work on update at all: `campaignId` was
 * absent from the update type, but slipped through the un-whitelisted body into the
 * service's `...rest` spread. It worked by accident, and would have broken silently
 * the moment anyone added validation here. It is declared explicitly now.
 */
export class CreateLeadDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsOptional() @IsString() @MaxLength(200)
  name?: string;

  @IsOptional() @IsEmail() @MaxLength(255)
  email?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsEnum(LeadSource)
  source!: LeadSource;

  @IsOptional() @IsString()
  status?: string;

  // Polymorphic: exactly one of unit/building. The XOR is enforced in the service.
  @IsOptional() @IsString()
  unitId?: string;

  @IsOptional() @IsString()
  buildingId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  unitInterest?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  budget?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsString()
  assignedTo?: string;

  // Campaign attribution. campaignId is the explicit tag; the utm* fields are raw
  // passthrough from the landing page and are kept even when no Campaign matches,
  // so attribution can be reconstructed if one is created later.
  @IsOptional() @IsString()
  campaignId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  utmSource?: string;

  @IsOptional() @IsString() @MaxLength(200)
  utmMedium?: string;

  @IsOptional() @IsString() @MaxLength(200)
  utmCampaign?: string;

  @IsOptional() @IsString() @MaxLength(200)
  utmContent?: string;
}

export class UpdateLeadDto {
  @IsOptional() @IsString() @MaxLength(200)
  name?: string;

  @IsOptional() @IsEmail() @MaxLength(255)
  email?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional() @IsString()
  status?: string;

  // Nullable so a link can be CLEARED, not only switched.
  @IsOptional() @IsString()
  unitId?: string | null;

  @IsOptional() @IsString()
  buildingId?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  unitInterest?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  budget?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsString()
  assignedTo?: string | null;

  /** Re-attribute an existing lead, or send null to detach it from its campaign. */
  @IsOptional() @IsString()
  campaignId?: string | null;
}
