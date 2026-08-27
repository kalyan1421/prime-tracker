import { IsString, IsNotEmpty, IsOptional, IsNumber, IsPositive, IsEnum, IsDateString, MaxLength } from 'class-validator';
import { ContractStatus, ChangeOrderStatus } from '@prisma/client';
import { EmptyStringToUndefined } from '../../documents/dto/upload-document.dto';

export class CreateContractDto {
  @IsString() @IsNotEmpty()
  projectId!: string;

  @IsString() @IsNotEmpty()
  vendorId!: string;

  @IsString() @IsNotEmpty() @MaxLength(500)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  originalAmount!: number;

  @IsOptional() @IsEnum(ContractStatus)
  status?: ContractStatus;

  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  startDate?: string;

  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  endDate?: string;
}

export class UpdateContractDto {
  @IsOptional() @IsString()
  vendorId?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500)
  description?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  originalAmount?: number;

  @IsOptional() @IsEnum(ContractStatus)
  status?: ContractStatus;

  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  startDate?: string;

  @IsOptional() @EmptyStringToUndefined() @IsDateString()
  endDate?: string;
}

export class CreateChangeOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount!: number;
}

export class UpdateChangeOrderStatusDto {
  @IsEnum(ChangeOrderStatus)
  status!: ChangeOrderStatus;
}

export class CreateContractPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount!: number;

  @IsDateString()
  paidDate!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}
