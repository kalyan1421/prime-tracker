import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DocCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../../common/utils/audit.service';

/**
 * ============================================================================
 * Document retention — the policy the soft delete deliberately deferred
 * ============================================================================
 *
 * `DocumentsService.delete` stopped removing the stored object, for a good reason: a DEED
 * whose row survives while its bytes are gone reads as proof and isn't. The stated cost
 * was that every deleted object is billed forever with no purge job anywhere. This is that
 * job, and it is CATEGORY-AWARE rather than blanket.
 *
 * WHY CATEGORY-AWARE and not "purge everything after N days" or "keep everything":
 *
 *   Blanket purge treats a site photo and a possession certificate as the same object.
 *   They are not. The whole reason the delete went soft is that `DocCategory` contains
 *   documents that EVIDENCE something — an obligation, a payment, a permission — and the
 *   sale-stage gate counts them. Those must never be purged on a timer.
 *
 *   Keeping everything forever is a real option, but it is the option that loses: the
 *   volume in this vault is site photos, superseded drawings and marketing PDFs, which is
 *   exactly the material that has no evidentiary value AND drives essentially all of the
 *   storage bill. Retaining the 12 categories that matter and purging the 4 that do not
 *   bounds the cost without ever touching a document anybody could need to produce.
 *
 * THE SPLIT IS AN ALLOWLIST, NOT A DENYLIST — deliberately. `DocCategory` has grown four
 * times (buyer-portal categories, then interior fit-out). A denylist would have silently
 * made CITY_APPROVAL and HANDOVER_CERTIFICATE purgeable the day they were added. With an
 * allowlist, a new category is retained until somebody makes a decision about it.
 */
export const PURGEABLE_CATEGORIES: readonly DocCategory[] = [
  // Site photos. The volume driver, and reproducible in principle — nobody produces a
  // photo of a wall in a dispute about who owed what.
  DocCategory.PHOTO,
  // Superseded design drawings. Referenced BY a contract (retained) rather than being the
  // contract. If Prime later says as-built drawings are defect-claim evidence, move this
  // one line to the retained side — that is the whole edit.
  DocCategory.DRAWING,
  // Marketing collateral. Regenerable by definition.
  DocCategory.BROCHURE,
  // The dumping ground. Weighed carefully, because it is the DEFAULT category, so a deed
  // uploaded without picking a category lands here. It is included anyway on three counts:
  // the grace period below is long enough to notice a mis-filed delete, the row survives
  // as a tombstone naming the file and its uploader, and — the deciding one — the object
  // is only ever removed after somebody DELETED the document on purpose.
  DocCategory.GENERAL,
];

/**
 * Days between the soft delete and the object being removed.
 *
 * 90, picked against two anchors already in this codebase rather than by feel:
 *   - The widest alert horizon anywhere in the app is 60 days (LOAN_MATURITY_60,
 *     max(DOCUMENT_EXPIRY_HORIZONS)). Anything the system itself would still be shouting
 *     about must not have been purged, so the floor is "strictly more than 60".
 *   - A quarter is the review cycle that actually surfaces a missing file — a quarterly
 *     close, an investor pack, a draw package. 90 days means a deletion made just after
 *     one review still exists at the next one.
 *
 * Over-retaining costs pennies. Under-retaining is unrecoverable. So: the conservative
 * end of the 30–90 day range that trash retention conventionally lands in.
 */
export const DEFAULT_PURGE_GRACE_DAYS = 90;

/**
 * A floor on the configured grace, because the env var is the one input that can turn this
 * job into an immediate wipe. `DOCUMENT_PURGE_GRACE_DAYS=1` from a bad deploy would purge
 * everything deleted yesterday; clamping means the worst a positive typo can do is 30 days.
 * A zero, negative or non-numeric value is not clamped but REJECTED — it falls back to the
 * 90-day default, because "0" is far more likely to be an unset variable rendering as empty
 * than somebody genuinely asking for an immediate purge.
 */
export const MIN_PURGE_GRACE_DAYS = 30;

/**
 * Objects removed per run, per sweep. Not a performance guard — a blast-radius one. If the
 * policy is ever mis-set, the damage is capped at this many objects per day instead of the
 * whole bucket in one pass, and the run logs `capped: true` so the backlog is visible.
 */
export const PURGE_BATCH_LIMIT = 500;

/** One storage object the run removed (or, in a dry run, would have removed). */
export interface PurgedObject {
  documentId: string;
  /** null when this is the document's own current object; set when it is an archived version. */
  versionId: string | null;
  category: DocCategory;
  storagePath: string;
  /** `deletedAt` for a document, `archivedAt` for a version — what made it eligible. */
  eligibleSince: Date;
}

export interface PurgeManifest {
  dryRun: boolean;
  graceDays: number;
  cutoff: Date;
  /** Documents whose own current object was removed. */
  documents: number;
  /** Archived versions whose object was removed. */
  versions: number;
  /** Objects the storage driver refused; left intact so the next run retries them. */
  failed: number;
  /** True when a sweep hit PURGE_BATCH_LIMIT and more remain for tomorrow. */
  capped: boolean;
  objects: PurgedObject[];
}

@Injectable()
export class DocumentRetentionService {
  private readonly logger = new Logger(DocumentRetentionService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  /** Configured grace, clamped at MIN_PURGE_GRACE_DAYS. Non-numeric input falls back to the default. */
  get graceDays(): number {
    const raw = Number(this.config.get<string>('DOCUMENT_PURGE_GRACE_DAYS'));
    const days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PURGE_GRACE_DAYS;
    return Math.max(MIN_PURGE_GRACE_DAYS, Math.floor(days));
  }

  /**
   * `DOCUMENT_PURGE_DRY_RUN=true` makes the cron scan and log without deleting anything.
   * It is the single off switch — an "enabled" flag on top of it would just be a second
   * way to spell the same thing, and a policy that defaults to off is "keep everything
   * forever" wearing a costume.
   */
  get dryRunConfigured(): boolean {
    return String(this.config.get('DOCUMENT_PURGE_DRY_RUN') ?? '').toLowerCase() === 'true';
  }

  /**
   * 03:15 CT — deliberately off the 08:00 slot the notification and draw crons share, so a
   * long purge can never delay a morning alert.
   */
  @Cron('15 3 * * *', { timeZone: 'America/Chicago', name: 'document-retention-purge' })
  async runDailyPurge() {
    const manifest = await this.purge();
    this.logger.log(
      `Document retention${manifest.dryRun ? ' (DRY RUN)' : ''}: ` +
        `${manifest.documents} document object(s) + ${manifest.versions} archived version(s) purged, ` +
        `${manifest.failed} failed, cutoff ${manifest.cutoff.toISOString()} (${manifest.graceDays}d grace)` +
        (manifest.capped ? ` — batch limit hit, more remain` : ''),
    );
    return manifest;
  }

  /**
   * Remove the storage objects behind purge-eligible documents, leaving every row in place
   * as a tombstone.
   *
   * IDEMPOTENT BY CONSTRUCTION: both sweeps require `storagePath: { not: null }`, and the
   * purge nulls that column immediately after the object is gone. A re-run therefore does
   * not select the same row twice — no state flag needed, and no way for a crashed run to
   * leave a half-purged row that behaves differently from a whole one. The order (delete
   * bytes, THEN null the column) is the safe one: if the process dies in between, the row
   * still points at a key that no longer exists and the next run retries the delete, which
   * S3 treats as a success for a missing key.
   */
  async purge(opts: { dryRun?: boolean; now?: Date } = {}): Promise<PurgeManifest> {
    const dryRun = opts.dryRun ?? this.dryRunConfigured;
    const graceDays = this.graceDays;
    const now = opts.now ?? new Date();
    const cutoff = new Date(now.getTime() - graceDays * 86_400_000);

    // Sweep 1 — documents deleted longer ago than the grace period.
    //
    // `deletedAt: { not: null, lte: cutoff }` is the whole eligibility test on the document
    // side: a LIVE document is never a candidate whatever its category or age. That is what
    // makes this safe to run against a working vault — the only thing it can touch is
    // something a person already chose to delete.
    const docs = await this.prisma.document.findMany({
      where: {
        deletedAt: { not: null, lte: cutoff },
        category: { in: [...PURGEABLE_CATEGORIES] },
        storagePath: { not: null },
      },
      select: { id: true, category: true, storagePath: true, deletedAt: true, fileName: true },
      orderBy: { deletedAt: 'asc' },
      take: PURGE_BATCH_LIMIT,
    });

    // Sweep 2 — archived versions.
    //
    // This sweep exists because `replaceFile` no longer destroys the superseded object (see
    // DocumentsService.replaceFile). Retaining those bytes is the correct behaviour, but it
    // is also a NEW unbounded cost, so it gets the same policy rather than a free pass:
    // same category allowlist, same grace, keyed on when the version was superseded.
    //
    // The OR covers the two ways a version becomes dead weight — superseded long ago (the
    // parent may still be live and in daily use), or belonging to a document that is itself
    // past its grace. Without the second arm, deleting a document would purge its current
    // object while a version replaced last week outlived it.
    const versions = await this.prisma.documentVersion.findMany({
      where: {
        storagePath: { not: null },
        document: { category: { in: [...PURGEABLE_CATEGORIES] } },
        OR: [
          { archivedAt: { lte: cutoff } },
          { document: { deletedAt: { not: null, lte: cutoff } } },
        ],
      },
      select: {
        id: true,
        documentId: true,
        storagePath: true,
        archivedAt: true,
        versionNumber: true,
        document: { select: { category: true } },
      },
      orderBy: { archivedAt: 'asc' },
      take: PURGE_BATCH_LIMIT,
    });

    const capped = docs.length >= PURGE_BATCH_LIMIT || versions.length >= PURGE_BATCH_LIMIT;

    const candidates: PurgedObject[] = [
      ...docs.map((d) => ({
        documentId: d.id,
        versionId: null,
        category: d.category,
        storagePath: d.storagePath as string,
        eligibleSince: d.deletedAt as Date,
      })),
      ...versions.map((v) => ({
        documentId: v.documentId,
        versionId: v.id,
        category: v.document.category,
        storagePath: v.storagePath as string,
        eligibleSince: v.archivedAt,
      })),
    ];

    const manifest: PurgeManifest = {
      dryRun,
      graceDays,
      cutoff,
      documents: 0,
      versions: 0,
      failed: 0,
      capped,
      objects: [],
    };

    for (const candidate of candidates) {
      if (dryRun) {
        manifest.objects.push(candidate);
        if (candidate.versionId) manifest.versions++;
        else manifest.documents++;
        continue;
      }

      try {
        await this.storage.delete(candidate.storagePath);
      } catch (err) {
        // Leave storagePath intact: the row still names an object we believe exists, and
        // tomorrow's run picks it up again. Silently nulling it would strand the key with
        // nothing left pointing at it — the one outcome with no path back.
        manifest.failed++;
        this.logger.warn(`Purge failed for ${candidate.storagePath}: ${err}`);
        continue;
      }

      if (candidate.versionId) {
        await this.prisma.documentVersion.update({
          where: { id: candidate.versionId },
          data: { storagePath: null },
        });
        manifest.versions++;
      } else {
        await this.prisma.document.update({
          where: { id: candidate.documentId },
          data: { storagePath: null },
        });
        manifest.documents++;
      }
      manifest.objects.push(candidate);
    }

    if (!dryRun && manifest.objects.length) {
      await this.writeManifest(manifest);
    }

    return manifest;
  }

  /**
   * The purge is the one genuinely irreversible step in the whole document flow, so it
   * leaves a record in the one table nothing ever deletes.
   *
   * One AuditEvent per DOCUMENT (not per object) so replacing a photo forty times does not
   * produce forty audit rows, and so the event is retrievable by the natural key the audit
   * UI already filters on: entity 'Document', entityId. The metadata carries the exact
   * storage keys — which is what makes recovery possible at all where the bucket has object
   * versioning: the key plus the date is enough to restore.
   *
   * Written AFTER the deletes, and only for objects that actually went, so the log records
   * what happened rather than what was attempted.
   */
  private async writeManifest(manifest: PurgeManifest) {
    const byDocument = new Map<string, PurgedObject[]>();
    for (const object of manifest.objects) {
      const list = byDocument.get(object.documentId) ?? [];
      list.push(object);
      byDocument.set(object.documentId, list);
    }

    for (const [documentId, objects] of byDocument) {
      await this.audit.log({
        // No userId — a policy purge has no actor. `AuditEvent.userId` is nullable and
        // AuditService drops an id it cannot resolve, so this is the intended shape.
        action: 'PURGE',
        entity: 'Document',
        entityId: documentId,
        metadata: {
          reason: 'RETENTION_POLICY',
          graceDays: manifest.graceDays,
          cutoff: manifest.cutoff.toISOString(),
          category: objects[0].category,
          objects: objects.map((o) => ({
            storagePath: o.storagePath,
            versionId: o.versionId,
            eligibleSince: o.eligibleSince.toISOString(),
          })),
        },
      });
    }
  }
}
