import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * C6 — a reviewer's verdict on one milestone photo.
 *
 * One route for both answers, following DecideSlipProposalDto: approve and reject are the
 * same decision with the same audit shape, and a single endpoint keeps them impossible to
 * log differently.
 *
 * `note` is optional here but MANDATORY on a rejection — enforced in the service (and by a
 * CHECK constraint), not by class-validator, because it depends on `approve`.
 */
export class SignOffPhotoDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/**
 * C6 — completing a milestone past the photo sign-off gate.
 *
 * The reason is mandatory and recorded on the milestone next to completedAt. Same shape as
 * the interior handover force and the building force-delete: overridable, never silently.
 */
export class ForceCompleteMilestoneDto {
  @IsString()
  @IsNotEmpty({ message: 'A reason is required to complete a milestone past the photo sign-off gate' })
  @MaxLength(1000)
  reason!: string;
}
