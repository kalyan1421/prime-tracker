import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign } from './website-signature';
import { SourceProject, WebsiteSnapshot, buildSnapshot, snapshotHash } from './website-snapshot';

/** Render's free plan sleeps; its cold start alone can take most of a minute. */
const PUSH_TIMEOUT_MS = 60_000;

/**
 * Every published project is pushed at least this often whether or not it changed.
 * The website editor saves a property's whole floor-plan blob, so an editor working
 * from a stale copy can overwrite the tracker's statuses; this puts them back.
 */
export const FULL_PUSH_INTERVAL_MS = 60 * 60 * 1000;

export interface PushOptions {
  dryRun?: boolean;
  force?: boolean;
}

export interface PushResult {
  status: number;
  ok: boolean;
  body: unknown;
}

/**
 * Mirrors published projects' unit inventory onto the public website.
 *
 * Pushes rather than letting the website read: the website stays up when the tracker
 * is down, and the tracker is never exposed to anonymous traffic. Snapshots, not
 * events — the website merges a whole project each time, so a push sent twice, late
 * or out of order does no harm, and a failed one is simply sent again next tick.
 *
 * See PrimeDevelopers-web/docs/tracker-sync-and-aws-plan.md.
 */
@Injectable()
export class WebsiteSyncService {
  private readonly logger = new Logger(WebsiteSyncService.name);
  // In memory on purpose. After a restart every project pushes once, which the
  // website reads as "no change" and answers without writing.
  private readonly pushedHash = new Map<string, string>();
  private lastFullPushAt = 0;
  private running = false;
  private warnedUnconfigured = false;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * Where to push, or null when the sync is switched off. deploy.sh writes every
   * SSM parameter it knows into .env, so an unset one arrives as an empty string and
   * one Terraform created but nobody filled in arrives as REPLACE_ME — both are off.
   */
  target(): { url: string; secret: string } | null {
    const url = (this.config.get<string>('WEBSITE_SYNC_URL') ?? '').trim();
    const secret = (this.config.get<string>('WEBSITE_SYNC_SECRET') ?? '').trim();
    if (!/^https?:\/\//.test(url) || secret.length < 32 || secret === 'REPLACE_ME') return null;
    return { url, secret };
  }

  /** Published projects, read with exactly the fields the snapshot may carry. */
  async load(projectId?: string): Promise<WebsiteSnapshot[]> {
    const projects = await this.prisma.project.findMany({
      where: { websiteSlug: { not: null }, deletedAt: null, ...(projectId ? { id: projectId } : {}) },
      select: {
        id: true,
        name: true,
        websiteSlug: true,
        buildings: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            units: {
              // A unit merged into another is soft-deleted with it; the survivor carries on.
              where: { deletedAt: null, mergedIntoId: null },
              select: {
                id: true,
                unitNumber: true,
                status: true,
                sqft: true,
                leases: {
                  where: { deletedAt: null, status: 'ACTIVE', terminationDate: null },
                  orderBy: { leaseStart: 'desc' },
                  select: { combinedDealRef: true, tenantBrand: true, tenantName: true },
                },
                sales: {
                  where: { deletedAt: null },
                  orderBy: { createdAt: 'desc' },
                  select: { status: true, combinedDealRef: true },
                },
              },
            },
          },
        },
      },
    });
    return projects.map((p) => buildSnapshot(p as SourceProject));
  }

  async snapshotFor(projectId: string): Promise<WebsiteSnapshot> {
    const [snapshot] = await this.load(projectId);
    if (snapshot) return snapshot;
    const exists = await this.prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
    if (!exists) throw new NotFoundException('Project not found');
    throw new BadRequestException('This project is not published to the website — set its website slug first');
  }

  async push(snapshot: WebsiteSnapshot, options: PushOptions = {}): Promise<PushResult> {
    const target = this.target();
    if (!target) throw new ServiceUnavailableException('Website sync is not configured (WEBSITE_SYNC_URL / WEBSITE_SYNC_SECRET)');

    const url = new URL(target.url);
    // The website's ParseBoolPipe accepts "true"/"false" only.
    if (options.dryRun) url.searchParams.set('dryRun', 'true');
    if (options.force) url.searchParams.set('force', 'true');

    const body = JSON.stringify(snapshot);
    const timestamp = String(Date.now());
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [TIMESTAMP_HEADER]: timestamp,
        [SIGNATURE_HEADER]: sign(target.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON (a proxy's error page, say) — keep the text for the log.
    }
    return { status: res.status, ok: res.ok, body: parsed };
  }

  async pushProject(projectId: string, options: PushOptions = {}): Promise<PushResult> {
    const snapshot = await this.snapshotFor(projectId);
    const result = await this.push(snapshot, options);
    if (result.ok && !options.dryRun) this.pushedHash.set(projectId, snapshotHash(snapshot));
    return result;
  }

  /**
   * One tick of the cron: push every published project whose units changed since its
   * last successful push, or every published project when the hourly full push is due.
   */
  async syncPublished(now = Date.now()): Promise<void> {
    if (!this.target()) {
      if (!this.warnedUnconfigured) {
        this.logger.log('Website sync off — WEBSITE_SYNC_URL / WEBSITE_SYNC_SECRET not set');
        this.warnedUnconfigured = true;
      }
      return;
    }
    // A push can wait a minute on a sleeping website; the next tick must not start a
    // second round on top of it.
    if (this.running) return;
    this.running = true;
    try {
      const full = now - this.lastFullPushAt >= FULL_PUSH_INTERVAL_MS;
      let failures = 0;
      for (const snapshot of await this.load()) {
        const { id, websiteSlug } = snapshot.project;
        const hash = snapshotHash(snapshot);
        if (!full && this.pushedHash.get(id) === hash) continue;
        try {
          const result = await this.push(snapshot);
          if (result.ok) {
            this.pushedHash.set(id, hash);
          } else if (result.status === 409) {
            // Refused by the website's removal guard (or a slug conflict). Retrying
            // every five minutes would only repeat the refusal; the hourly full push
            // tries again, and a person decides whether to force it.
            this.pushedHash.set(id, hash);
            this.logger.error(`Website refused ${websiteSlug}: ${JSON.stringify(result.body)}`);
          } else {
            failures++;
            this.logger.warn(`Website push for ${websiteSlug} failed: HTTP ${result.status} ${JSON.stringify(result.body)}`);
          }
        } catch (err) {
          failures++;
          this.logger.warn(`Website push for ${websiteSlug} failed: ${(err as Error).message}`);
        }
      }
      if (full && failures === 0) this.lastFullPushAt = now;
    } finally {
      this.running = false;
    }
  }
}
