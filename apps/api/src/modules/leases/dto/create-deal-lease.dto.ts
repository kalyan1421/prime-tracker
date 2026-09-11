import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsPositive,
  IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { CreateLeaseDto } from './create-lease.dto';

export class CreateDealLeaseUnitDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  unitId!: string;

  /** This unit's share. Either every unit carries one, or none do — never a mix. */
  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  monthlyRent?: number;

  /** The deal's deposit, whole, on ONE unit. More than one is refused. */
  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  securityDeposit?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  tiAllowance?: number;
}

/**
 * One letting over several units.
 *
 * Extends the ordinary lease DTO for every SHARED term (tenant, dates, escalation, broker,
 * …) rather than restating ~25 fields and their validators, which is how the two would
 * drift. The per-unit money moves to `units`, so those are omitted here.
 */
export class CreateDealLeaseDto extends PartialType(
  OmitType(CreateLeaseDto, ['unitId', 'buildingId', 'monthlyRent', 'securityDeposit', 'tiAllowance', 'combinedDealRef'] as const),
) {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  projectId!: string;

  /** Omit to mint one in the shape Prime's own sheets use; supply it to reuse a paper name. */
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  combinedDealRef?: string;

  /** The deal's total, divided by floor area where every unit has one. Mutually exclusive
   *  with per-unit `monthlyRent`. */
  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  totalMonthlyRent?: number;

  @ApiProperty({ type: [CreateDealLeaseUnitDto] })
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => CreateDealLeaseUnitDto)
  units!: CreateDealLeaseUnitDto[];
}
