import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Lightweight in-process cache with TTL.
 *
 * Why not Redis directly? BullMQ already uses Redis, but for read-heavy dashboard
 * aggregates we want sub-millisecond lookups, no network round trip. This is fine for
 * single-instance deployments. To scale horizontally, swap the internal Map for an
 * `ioredis` client behind the same interface — no callsite changes required.
 *
 * Used by: DashboardService, KpiService, ReportsService for expensive aggregates.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly tagIndex = new Map<string, Set<string>>(); // tag -> set of keys

  // Periodic sweep so the store doesn't grow unbounded if TTLs are hit but never read.
  constructor() {
    setInterval(() => this.sweep(), 60_000).unref?.();
  }

  /** Get-or-set with TTL. The compute function only runs on miss. */
  async wrap<T>(
    key: string,
    ttlSeconds: number,
    compute: () => Promise<T>,
    opts: { tags?: string[] } = {},
  ): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await compute();
    this.set(key, value, ttlSeconds, opts.tags);
    return value;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number, tags?: string[]): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    if (tags?.length) {
      for (const tag of tags) {
        if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
        this.tagIndex.get(tag)!.add(key);
      }
    }
  }

  /** Invalidate every cache key associated with a tag. Call from write paths. */
  invalidateTag(tag: string): void {
    const keys = this.tagIndex.get(tag);
    if (!keys) return;
    for (const key of keys) this.store.delete(key);
    this.tagIndex.delete(tag);
    this.logger.debug(`Invalidated tag "${tag}" (${keys.size} keys)`);
  }

  invalidateKey(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.tagIndex.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt < now) this.store.delete(key);
    }
  }
}
