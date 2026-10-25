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

/**
 * Parse a raw `?limit=` into a page size between 1 and `max`, falling back to
 * `fallback` when it is absent or not a number.
 *
 * For the older list routes that take a bare `@Query('limit')` rather than a
 * PaginationDto. Several passed the value straight to Prisma's `take` with no ceiling, so
 * `?limit=1000000` read an entire table into memory in one request.
 */
export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return Math.min(fallback, max);
  return Math.min(Math.floor(n), max);
}
