import { IsOptional, IsString, IsArray, ArrayUnique, IsIn } from 'class-validator';
import { PROJECT_MEMBER_ROLES } from '@prime-tracker/shared';

/** Spread into @IsIn — class-validator wants a mutable array, the constant is readonly. */
const ALLOWED = [...PROJECT_MEMBER_ROLES];
const ALLOWED_MESSAGE = `must be one of: ${ALLOWED.join(', ')}`;

export class AddMemberDto {
  @IsString() userId!: string;

  // `role` is the legacy single-role field, still accepted. `roles` wins when both are
  // sent; the service keeps role === roles[0]. A person may hold several roles on one
  // project — Finance AND Legal, for instance.
  //
  // Both are constrained to PROJECT_MEMBER_ROLES (client decision 2026-08-14). The old
  // @MaxLength(64) is gone because it is subsumed: every allowed value is far shorter.
  @IsOptional() @IsString() @IsIn(ALLOWED, { message: `role ${ALLOWED_MESSAGE}` })
  role?: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  @IsIn(ALLOWED, { each: true, message: `each role ${ALLOWED_MESSAGE}` })
  roles?: string[];
}
