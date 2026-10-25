import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/utils/audit.service';

/**
 * How long an audit event is kept: two years.
 *
 * AuditEvent gets a row on every non-GET request (AuditInterceptor) and was never pruned,
 * so it is the one table that grows with USAGE rather than with the business — and the
 * activity feed counts over it on every page load. Two years is chosen against what the
 * log is actually used for:
 *   - "who changed this, and when" questions are asked about the current and previous
 *     financial year — a year-end close, an investor pack, a lender's draw review —
 *     which a 24-month window always covers in full;
 *   - nothing in the app reads further back: the activity feed pages newest-first, and the
 *     longest horizon any job looks at is the 365-day stale-unit bucket.
 * Over-retaining costs disk; under-retaining is unrecoverable — so the longer end of the
 * 12–24 month range operational logs conventionally keep. Change it here, nowhere else.
 */
export const AUDIT_RETENTION_DAYS = 730;

/**
 * Actions kept FOREVER, whatever their age. An allowlist, like PURGEABLE_CATEGORIES in
 * document-retention — these rows are the only record of something irreversible:
 *   PURGE                       — document-retention's manifest of the storage keys it
 *                                 removed; the key plus the date is what makes a restore
 *                                 from bucket versioning possible at all.
 *   LEASE/SALE_HISTORICAL_DELETED,
 *   HISTORICAL_DELETION_*       — Founder-approved deletion of backfilled history, data
 *                                 that cannot be regenerated (R27/R6).
 *   AUDIT_RETENTION_PURGE       — this job's own record of what it removed.
 */
export const AUDIT_RETAINED_ACTIONS: readonly string[] = [
  'PURGE',
  'LEASE_HISTORICAL_DELETED',
  'SALE_HISTORICAL_DELETED',
  'HISTORICAL_DELETION_REQUESTED',
  'HISTORICAL_DELETION_CANCELLED',
  'AUDIT_RETENTION_PURGE',
];

/** Rows removed per DELETE statement — small enough to keep each statement's locks short. */
export const AUDIT_PURGE_BATCH_SIZE = 1000;

/**
 * Batches per nightly run. A blast-radius cap, same reasoning as PURGE_BATCH_LIMIT in
 * document-retention: if the period were ever mis-set, one night removes at most
 * 50,000 rows instead of the table, and the run reports `capped` so the backlog is visible.
 */
export const AUDIT_PURGE_MAX_BATCHES = 50;

export interface AuditPurgeResult {
  dryRun: boolean;
  cutoff: Date;
  deleted: number;
  capped: boolean;
}

@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** 03:45 CT — after document-retention (03:15), and well clear of the 08:00 alert crons. */
  @Cron('45 3 * * *', { timeZone: 'America/Chicago', name: 'audit-retention-purge' })
  async runNightly() {
    try {
      const result = await this.purge();
      if (result.deleted > 0 || result.capped) {
        this.logger.log(
          `Audit retention: ${result.deleted} event(s) older than ${result.cutoff.toISOString()} removed` +
            (result.capped ? ' — batch cap hit, more remain for tomorrow' : ''),
        );
      }
    } catch (err) {
      this.logger.error(`Cron audit-retention-purge failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }

  /**
   * Delete events older than the retention window, oldest first, in id batches.
   *
   * Prisma's deleteMany has no LIMIT, so each batch selects up to AUDIT_PURGE_BATCH_SIZE
   * ids (served by the createdAt index) and deletes exactly those. Idempotent: a crashed
   * run leaves only rows that are still eligible, and the next run takes them.
   */
  async purge(opts: { dryRun?: boolean; now?: Date } = {}): Promise<AuditPurgeResult> {
    const dryRun = opts.dryRun ?? false;
    const now = opts.now ?? new Date();
    const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86_400_000);
    const where = {
      createdAt: { lt: cutoff },
      action: { notIn: [...AUDIT_RETAINED_ACTIONS] },
    };

    if (dryRun) {
      const deleted = await this.prisma.auditEvent.count({ where });
      return { dryRun, cutoff, deleted, capped: false };
    }

    let deleted = 0;
    let capped = false;
    for (let batch = 0; ; batch++) {
      if (batch >= AUDIT_PURGE_MAX_BATCHES) {
        capped = true;
        break;
      }
      const rows = await this.prisma.auditEvent.findMany({
        where,
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: AUDIT_PURGE_BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const res = await this.prisma.auditEvent.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      deleted += res.count;
      if (rows.length < AUDIT_PURGE_BATCH_SIZE) break;
    }

    if (deleted > 0) {
      // No userId — a policy purge has no actor (same shape as document-retention's PURGE).
      await this.audit.log({
        action: 'AUDIT_RETENTION_PURGE',
        entity: 'AuditEvent',
        metadata: {
          retentionDays: AUDIT_RETENTION_DAYS,
          cutoff: cutoff.toISOString(),
          deleted,
          capped,
        },
      });
    }

    return { dryRun, cutoff, deleted, capped };
  }
}
