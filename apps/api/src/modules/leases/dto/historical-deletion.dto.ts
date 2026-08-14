import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Ask a Founder to approve deleting a backfilled tenancy.
 *
 * Reason is mandatory and long-ish on purpose: the approver sees only this sentence and
 * the record itself, so "wrong" tells them nothing they can act on.
 */
export class RequestHistoricalDeletionDto {
  @IsString()
  @MinLength(10, { message: 'Explain why this historical record should be deleted' })
  @MaxLength(1000)
  reason!: string;
}

export class DecideHistoricalDeletionDto {
  // Explicit rather than two endpoints — approve and reject are the same decision with
  // the same audit shape, and a single route keeps them impossible to log differently.
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
