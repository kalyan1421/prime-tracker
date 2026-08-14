import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * C3/C4 — the PM's decision on a slip cascade.
 *
 * One route for both answers, following DecideHistoricalDeletionDto: approve and reject
 * are the same decision with the same audit shape, and a single endpoint keeps them
 * impossible to log differently.
 *
 * No mandatory reason, unlike a deletion request: rejecting a cascade destroys nothing —
 * it leaves the schedule exactly as it was.
 */
export class DecideSlipProposalDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
