import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min,
} from 'class-validator';
import { InteriorContractType, InteriorPhase, InteriorStatus } from '@prisma/client';

/**
 * Interior project bodies. Create/update/advance took inline `@Body()` types, which the
 * global ValidationPipe skips — so a rate, area, contract value or TI allowance of "abc"
 * (or NaN from a cleared field) reached a Decimal column, and a status or phase outside
 * the enum reached the state machine.
 *
 * Numbers are held to "finite and not negative" rather than to two decimal places: the
 * columns are Decimal(…, 2) and Postgres rounds, which is what these forms have always
 * relied on.
 */
const NUMBER = { allowNaN: false, allowInfinity: false } as const;

export class CreateInteriorProjectDto {
  @IsOptional() @IsString() @MaxLength(64)
  unitId?: string;

  @IsOptional() @IsString() @MaxLength(64)
  buildingId?: string;

  @IsOptional() @IsString() @MaxLength(64)
  saleId?: string;

  @IsOptional() @IsString() @MaxLength(64)
  leaseId?: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(64)
  pmId?: string;

  @IsOptional() @IsEnum(InteriorContractType)
  contractType?: InteriorContractType;

  @IsOptional() @IsNumber(NUMBER) @Min(0)
  ratePerSqft?: number;

  @IsOptional() @IsNumber(NUMBER) @Min(0)
  area?: number;

  @IsOptional() @IsNumber(NUMBER) @Min(0)
  contractValue?: number;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsDateString()
  targetEnd?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  extraUnitIds?: string[];

  @IsOptional() @IsString() @MaxLength(32)
  priority?: string | null;

  @IsOptional() @IsDateString()
  plansSubmittedAt?: string | null;

  @IsOptional() @IsNumber(NUMBER) @Min(0)
  tiAllowance?: number | null;

  @IsOptional() @IsString() @MaxLength(20)
  poPrefix?: string | null;
}

export class UpdateInteriorProjectDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsEnum(InteriorStatus)
  status?: InteriorStatus;

  /** The web sends `null` to clear the PM; @IsOptional lets that through as before. */
  @IsOptional() @IsString() @MaxLength(64)
  pmId?: string;

  @IsOptional() @IsEnum(InteriorContractType)
  contractType?: InteriorContractType;

  @IsOptional() @IsNumber(NUMBER) @Min(0)
  ratePerSqft?: number;

  @IsOptional() @IsNumber(NUMBER) @Min(0)
  area?: number;

  @IsOptional() @IsNumber(NUMBER) @Min(0)
  contractValue?: number;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsDateString()
  targetEnd?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  extraUnitIds?: string[];

  @IsOptional() @IsString() @MaxLength(32)
  priority?: string | null;

  @IsOptional() @IsDateString()
  plansSubmittedAt?: string | null;

  /** `null` = fall back to the lease's allowance. */
  @IsOptional() @IsNumber(NUMBER) @Min(0)
  tiAllowance?: number | null;

  @IsOptional() @IsString() @MaxLength(20)
  poPrefix?: string | null;
}

export class AdvanceInteriorPhaseDto {
  @IsEnum(InteriorPhase)
  target!: InteriorPhase;

  @IsOptional() @IsString() @MaxLength(200)
  handoverSignedBy?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  handoverNotes?: string;

  @IsOptional() @IsBoolean()
  force?: boolean;

  @IsOptional() @IsString() @MaxLength(2000)
  forceReason?: string;
}
