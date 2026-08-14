import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  DEPOSIT_DISPOSITIONS,
  DepositDisposition,
  TERMINATION_REASONS,
  TerminationReason,
} from '../leases.service';

export class EndTenancyDto {
  /**
   * The date the tenant actually left. NOT the contracted expiry — the whole point of
   * this field is that the two can differ, and the gap between them is the early-
   * termination exposure.
   */
  @IsDateString()
  terminationDate!: string;

  // Required. A tenancy that ended for no stated reason cannot be reported on, and the
  // reason is what tells renewal and relocation apart from a genuine turnover.
  @IsIn(TERMINATION_REASONS as unknown as string[])
  terminationReason!: TerminationReason;

  @IsOptional() @IsString() @MaxLength(1000)
  terminationNote?: string;

  /**
   * The lease that continues this tenancy — a renewal on the same unit, or a
   * relocation to another. Omit for a genuine turnover; the service derives whether
   * the unit is released from whether this is set.
   */
  @IsOptional() @IsString()
  successorLeaseId?: string;

  // Defaults to DECIDE_LATER in the service. Not defaulted here on purpose: a deposit
  // disposition nobody chose should read as "nobody has decided", not as a decision.
  @IsOptional() @IsIn(DEPOSIT_DISPOSITIONS as unknown as string[])
  depositDisposition?: DepositDisposition;

  @IsOptional() @IsString() @MaxLength(500)
  depositNote?: string;
}
