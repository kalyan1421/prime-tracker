import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { AddMemberDto } from './add-member.dto';

/**
 * Adding a whole team in one request.
 *
 * The frontend used to POST /members once per person in parallel. That works for a handful
 * and then silently breaks: the global 'short' throttle is 10 requests per second, so
 * picking 19 people landed 10 and 429'd the other 9 ("9 could not be added"). Batching is
 * the structural fix — one request, one transaction, no partial team.
 *
 * 200 is a deliberate ceiling: comfortably above any real project roster, low enough that a
 * malformed payload can't open a transaction over an unbounded list.
 */
export class AddMembersBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AddMemberDto)
  members!: AddMemberDto[];
}
