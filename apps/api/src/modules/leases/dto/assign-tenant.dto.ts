import {
  IsDateString, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength,
} from 'class-validator';
import { ASSIGNMENT_REASONS, AssignmentReason } from '../leases.service';

/**
 * Assignment / novation: the lease survives, the party changes.
 *
 * Note what is absent — no rent, no dates, no term. An assignment that altered the
 * economics would not be an assignment; it would be a new lease, and the API should not
 * offer a way to blur the two.
 */
export class AssignTenantDto {
  @IsDateString()
  effectiveDate!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  toTenantName!: string;

  // The LLC / legal entity that signs. Optional because it is often the same as the
  // trading name, and a mandatory field would just get the trading name typed twice.
  @IsOptional() @IsString() @MaxLength(200)
  toTenantLegalName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  toTenantContact?: string;

  @IsOptional() @IsEmail()
  toTenantEmail?: string;

  @IsOptional() @IsString() @MaxLength(40)
  toTenantPhone?: string;

  @IsOptional() @IsIn(ASSIGNMENT_REASONS as unknown as string[])
  reason?: AssignmentReason;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;

  @IsOptional() @IsString()
  documentId?: string;
}
