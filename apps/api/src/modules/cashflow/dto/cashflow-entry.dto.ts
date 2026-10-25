import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { CashFlowType } from '@prisma/client';

/**
 * Body for POST /cashflow. Was `@Body() body: any`, which the global ValidationPipe skips
 * entirely — so `Number(amount)` of "abc" wrote NaN into a money column, an empty month
 * became an Invalid Date that Prisma rejected as a 500, and any extra key rode along.
 *
 * `amount` is not sign-restricted: an entry's direction is its `entryType`, but a
 * correcting entry can legitimately be negative.
 */
export class CreateCashFlowEntryDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  projectId!: string;

  /** Any day in the month the entry belongs to. */
  @IsDateString()
  month!: string;

  @IsEnum(CashFlowType)
  entryType!: CashFlowType;

  @IsString() @IsNotEmpty() @MaxLength(100)
  category!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  amount!: number;

  @IsOptional() @IsBoolean()
  isActual?: boolean;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

/** Body for PUT /cashflow/:id — every field optional; `projectId` cannot be moved. */
export class UpdateCashFlowEntryDto {
  @IsOptional() @IsDateString()
  month?: string;

  @IsOptional() @IsEnum(CashFlowType)
  entryType?: CashFlowType;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  category?: string;

  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  amount?: number;

  @IsOptional() @IsBoolean()
  isActual?: boolean;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string | null;
}
