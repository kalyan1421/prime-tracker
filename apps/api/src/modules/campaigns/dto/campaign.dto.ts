import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsPositive,
  IsDateString, MaxLength, Min,
} from 'class-validator';
import { CampaignChannel, CampaignStatus, CampaignSpendSource } from '@prisma/client';

export class CreateCampaignDto {
  // Cross-project campaigns leave projectId unset; project-specific ones populate it.
  @IsOptional() @IsString()
  projectId?: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;

  @IsEnum(CampaignChannel)
  channel!: CampaignChannel;

  @IsOptional() @IsString() @MaxLength(200)
  externalId?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  plannedBudget?: number;

  @IsOptional() @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsDateString()
  endDate?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

export class UpdateCampaignDto {
  @IsOptional() @IsString() @MaxLength(200)
  name?: string;

  @IsOptional() @IsEnum(CampaignChannel)
  channel?: CampaignChannel;

  @IsOptional() @IsString() @MaxLength(200)
  externalId?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  plannedBudget?: number;

  @IsOptional() @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsDateString()
  endDate?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

export class RecordSpendDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount!: number;

  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @IsDateString()
  spentOn!: string;

  @IsOptional() @IsEnum(CampaignSpendSource)
  source?: CampaignSpendSource;

  // Vendor-side identifier — Meta invoice ID, Google line item, agency report row.
  // Combined with (campaignId, source) for the unique dedup constraint.
  @IsOptional() @IsString() @MaxLength(200)
  externalRef?: string;
}
