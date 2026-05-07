import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Standard pagination input for any list endpoint.
 *
 * Use as a query DTO:
 *   @Get() list(@Query() q: PaginationDto) { ... }
 *
 * Defaults: page=1, limit=25. Hard cap at 100 prevents callers from requesting
 * unbounded pages that would crush the DB.
 */
export class PaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  /** Convenience: pass directly to Prisma's `skip` parameter. */
  get skip(): number {
    return (this.page - 1) * this.limit;
  }

  /** Convenience: pass directly to Prisma's `take` parameter. */
  get take(): number {
    return this.limit;
  }
}

/** Standard envelope returned by every paginated endpoint. */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function paginate<T>(data: T[], total: number, p: PaginationDto): Paginated<T> {
  return {
    data,
    total,
    page: p.page,
    limit: p.limit,
    totalPages: Math.max(1, Math.ceil(total / p.limit)),
  };
}
