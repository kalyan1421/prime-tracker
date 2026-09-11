import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsPositive,
  IsString, MaxLength, ValidateNested,
} from 'class-validator';
import { CreateSaleDto } from './create-sale.dto';

export class CreateDealSaleUnitDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  unitId!: string;

  /** This unit's price. Either every unit carries one, or none do with a deal total. */
  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  salePrice?: number;
}

/**
 * Several units sold together — one buyer, one deal, N Sale rows sharing a reference.
 *
 * Extends the ordinary sale DTO for every shared term rather than restating them, which is
 * how the two would drift; the per-unit price moves to `units`.
 */
export class CreateDealSaleDto extends PartialType(
  OmitType(CreateSaleDto, ['unitId', 'buildingId', 'salePrice', 'combinedDealRef'] as const),
) {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  projectId!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  combinedDealRef?: string;

  /** The deal's total, apportioned by floor area where every unit has one. */
  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  totalSalePrice?: number;

  @ApiProperty({ type: [CreateDealSaleUnitDto] })
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => CreateDealSaleUnitDto)
  units!: CreateDealSaleUnitDto[];
}
