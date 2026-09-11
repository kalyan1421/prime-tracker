import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNotEmpty, IsOptional,
  IsString, MaxLength, ValidateNested,
} from 'class-validator';
import { DEPOSIT_DISPOSITIONS, TERMINATION_REASONS } from '../leases.service';

/**
 * What the reviewer intends for a unit NEXT.
 *
 * Intent only — this records words, never state. In particular SOLD must not move the unit
 * to UNDER_CONTRACT or SOLD: that is the sale's job, and doing it here would let a unit
 * read as sold with no Sale behind it.
 */
export const DEAL_UNIT_OUTCOMES = ['VACANT', 'RE_LET', 'SOLD'] as const;
export type DealUnitOutcome = (typeof DEAL_UNIT_OUTCOMES)[number];

export class EndDealUnitDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  leaseId!: string;

  @ApiProperty({ enum: DEAL_UNIT_OUTCOMES })
  @IsIn(DEAL_UNIT_OUTCOMES as unknown as string[])
  outcome!: DealUnitOutcome;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(1000)
  terminationNote?: string;
}

export class EndDealTenancyDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  projectId!: string;

  @ApiProperty({ description: 'The deal label shared by every lease in the group.' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  combinedDealRef!: string;

  @ApiProperty({ description: 'ONE move-out date for the whole deal. That is the feature.' })
  @IsDateString()
  terminationDate!: string;

  @ApiProperty({ enum: TERMINATION_REASONS })
  @IsIn(TERMINATION_REASONS as unknown as string[])
  terminationReason!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(1000)
  terminationNote?: string;

  /**
   * The set the reviewer was actually shown, echoed back. The server refuses on any
   * difference — ending a different set of units than the one approved is the outcome
   * least worth risking, and a deal can change between opening the screen and submitting.
   *
   * Capped at 50, not the 200 used for member imports: this holds row locks on N leases,
   * N schedules and N invoice sets for the length of one transaction. The largest real
   * group is 6.
   */
  @ApiProperty({ type: [EndDealUnitDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => EndDealUnitDto)
  units!: EndDealUnitDto[];

  /**
   * One decision for the whole deposit — it is held whole on a single member lease
   * (client decision, 2026-09-12), never divided. TRANSFER is refused here: the lease the
   * money would move to does not exist yet at the moment a tenancy ends.
   */
  @ApiPropertyOptional({ enum: DEPOSIT_DISPOSITIONS })
  @IsOptional() @IsIn(DEPOSIT_DISPOSITIONS as unknown as string[])
  depositDisposition?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  depositNote?: string;
}
