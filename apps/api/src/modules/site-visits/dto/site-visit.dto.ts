import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional,
  IsString, MaxLength, Max, Min, IsNotEmpty, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * main.ts runs the ValidationPipe with `forbidNonWhitelisted: true`, so any field the
 * client sends that is not declared here is a 400 — not a silent strip. Keep these in
 * step with the forms.
 */

export class CreateAvailabilityDto {
  @IsString() @IsNotEmpty()
  hostId!: string;

  @IsOptional() @IsIn(['OPEN', 'BLOCKED'])
  kind?: string;

  /** 0=Sun..6=Sat for a weekly rule. Exactly one of dayOfWeek/dayOfMonth/date. */
  @IsOptional() @IsInt() @Min(0) @Max(6)
  dayOfWeek?: number | null;

  /** 1..31 for a monthly rule. Exactly one of dayOfWeek/dayOfMonth/date — see the service. */
  @IsOptional() @IsInt() @Min(1) @Max(31)
  dayOfMonth?: number | null;

  @IsOptional() @IsDateString()
  date?: string | null;

  /** Inclusive END of a date range. Only valid alongside `date` — see the service. */
  @IsOptional() @IsDateString()
  endDate?: string | null;

  /** Minutes from local midnight. 0..1440 so a window can legitimately end at midnight. */
  @IsInt() @Min(0) @Max(1440)
  startMin!: number;

  @IsInt() @Min(0) @Max(1440)
  endMin!: number;

  @IsOptional() @IsInt() @Min(5) @Max(480)
  slotMinutes?: number;

  @IsOptional() @IsString() @MaxLength(64)
  timezone?: string;

  @IsOptional() @IsDateString()
  effectiveFrom?: string | null;

  @IsOptional() @IsDateString()
  effectiveTo?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

export class UpdateAvailabilityDto {
  @IsOptional() @IsIn(['OPEN', 'BLOCKED'])
  kind?: string;

  @IsOptional() @IsInt() @Min(0) @Max(6)
  dayOfWeek?: number | null;

  /** 1..31 for a monthly rule. Exactly one of dayOfWeek/dayOfMonth/date — see the service. */
  @IsOptional() @IsInt() @Min(1) @Max(31)
  dayOfMonth?: number | null;

  @IsOptional() @IsDateString()
  date?: string | null;

  /** Inclusive END of a date range. Only valid alongside `date` — see the service. */
  @IsOptional() @IsDateString()
  endDate?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  startMin?: number;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  endMin?: number;

  @IsOptional() @IsInt() @Min(5) @Max(480)
  slotMinutes?: number;

  @IsOptional() @IsString() @MaxLength(64)
  timezone?: string;

  @IsOptional() @IsDateString()
  effectiveFrom?: string | null;

  @IsOptional() @IsDateString()
  effectiveTo?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

export class CreateSiteVisitDto {
  @IsString() @IsNotEmpty()
  leadId!: string;

  @IsString() @IsNotEmpty()
  hostId!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional() @IsDateString()
  endsAt?: string;

  @IsOptional() @IsString()
  unitId?: string | null;

  @IsOptional() @IsString()
  buildingId?: string | null;

  @IsOptional() @IsString() @MaxLength(500)
  requestNote?: string | null;
}

export class DecideSiteVisitDto {
  @IsBoolean()
  confirmed!: boolean;

  /** Required when rejecting — enforced in the service, where the confirmed flag is known. */
  @IsOptional() @IsString() @MaxLength(500)
  decisionNote?: string | null;
}

export class RescheduleSiteVisitDto {
  @IsDateString()
  startsAt!: string;

  @IsOptional() @IsDateString()
  endsAt?: string;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string | null;
}

export class CancelSiteVisitDto {
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string | null;
}

export class OutcomeSiteVisitDto {
  @IsIn(['COMPLETED', 'NO_SHOW'])
  result!: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
}


/**
 * Publishing a whole week or month in one go. Sent as ONE request on purpose: the
 * throttler truncates a parallel per-item write loop, so seven separate posts could
 * silently land as four.
 */
export class BulkAvailabilityDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(31)
  @ValidateNested({ each: true })
  @Type(() => CreateAvailabilityDto)
  rules!: CreateAvailabilityDto[];
}
