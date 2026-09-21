import {
  IsDateString, IsEmail, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min,
} from 'class-validator';
import { LeadActivityType, LeadSource } from '@prisma/client';

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

  // Board-parity fields (2026-09-21). NOTE: main.ts runs the ValidationPipe with
  // `forbidNonWhitelisted: true`, so a field the form posts but the DTO omits is a 400,
  // not a silent strip — these must exist on BOTH Create and Update or the form breaks.
  @IsOptional() @IsDateString()
  followUpDate?: string;

  // CustomOption "lead_via" value. Free text on purpose (the catalogue is admin-editable),
  // so it is length-capped rather than enum-checked.
  @IsOptional() @IsString() @MaxLength(60)
  via?: string;
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

  // Nullable on update so a follow-up date or engagement signal can be CLEARED, not only
  // changed — same reason unitId/buildingId/assignedTo are nullable above.
  @IsOptional() @IsDateString()
  followUpDate?: string | null;

  @IsOptional() @IsString() @MaxLength(60)
  via?: string | null;
}


/**
 * Activity bodies. This route previously used an inline `@Body() body: { … }` type, which
 * TypeScript erases at runtime — the ValidationPipe only whitelists against a DTO CLASS,
 * so nothing here was validated at all and `occurredAt` would have reached Prisma purely
 * by accident. Declared properly instead.
 */
export class AddLeadActivityDto {
  @IsEnum(LeadActivityType)
  type!: LeadActivityType;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  note!: string;

  /**
   * When it HAPPENED. Omit for "just now" — the common case of logging a call as you make
   * it. Supplied when back-dating from the per-lead calendar.
   */
  @IsOptional() @IsDateString()
  occurredAt?: string;
}


/** Lead discussion thread. Plain text — @mentions are resolved from the body server-side. */
export class LeadCommentDto {
  @IsString() @IsNotEmpty() @MaxLength(4000)
  content!: string;
}
