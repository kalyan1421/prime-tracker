import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { DocCategory } from '@prisma/client';
import { UpdateDocumentDto } from './dto/update-document.dto';

/**
 * D2 — the categories that genuinely LAPSE. An expiry on these is expected but never
 * REQUIRED: back-filled and historical documents legitimately have no known date, and
 * refusing them at upload would mean they are not filed at all. So this list drives an
 * advisory `expiryExpected` flag on reads, not a validation rule on writes.
 *
 * Everything else (photos, drawings, brochures) is silent unless somebody deliberately
 * sets a date — an expiry field nagging on every site photo is noise, and noise is what
 * makes people stop reading the flag that matters.
 */
export const EXPIRY_TRACKED_CATEGORIES: readonly DocCategory[] = [
  DocCategory.PERMIT,
  DocCategory.NOC,
  DocCategory.POSSESSION_CERTIFICATE,
];

/** Days out at which a document starts reading as EXPIRING_SOON. Matches the widest cron horizon. */
export const EXPIRY_SOON_DAYS = 60;

export type DocumentExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /**
   * Derived, read-only expiry fields. The UI needs three separate things and none of them
   * are worth recomputing (or re-deciding the thresholds for) in the browser:
   *
   *   expiryExpected   — this category ought to carry a date. Advisory: true even when
   *                      `expiresAt` is null, which is exactly the case worth surfacing.
   *   expiryStatus     — null when no date is set, otherwise VALID / EXPIRING_SOON / EXPIRED.
   *   daysUntilExpiry  — negative once past. Null when no date is set.
   */
  private decorate<T extends { category: DocCategory; expiresAt?: Date | null }>(doc: T, now = new Date()) {
    const expiresAt = doc.expiresAt ?? null;
    const expiryExpected = EXPIRY_TRACKED_CATEGORIES.includes(doc.category);

    if (!expiresAt) {
      return { ...doc, expiryExpected, expiryStatus: null, daysUntilExpiry: null };
    }

    const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
    const expiryStatus: DocumentExpiryStatus =
      daysUntilExpiry < 0 ? 'EXPIRED' : daysUntilExpiry <= EXPIRY_SOON_DAYS ? 'EXPIRING_SOON' : 'VALID';

    return { ...doc, expiryExpected, expiryStatus, daysUntilExpiry };
  }

  /**
   * Parse an incoming ISO date. The DTO already guarantees a valid `IsDateString`, so this
   * only has to catch the hand-built caller (a test, an internal service) that skipped it —
   * a silent `Invalid Date` would be persisted as NULL and the reminder would never fire.
   */
  private parseExpiry(value: string | Date | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('expiresAt must be a valid date');
    return date;
  }

  /**
   * S3 bucket is private — replace the stored raw S3 URL with a 1-hour signed URL
   * so the browser can load documents without credentials.  For external URLs
   * (no storagePath), the original fileUrl is kept as-is.
   */
  private async withSignedUrls<
    T extends { storagePath?: string | null; fileUrl: string; category: DocCategory; expiresAt?: Date | null },
  >(docs: T[]) {
    const now = new Date();
    return Promise.all(
      docs.map(async (doc) => {
        let signed = doc;
        if (doc.storagePath) {
          try {
            const signedUrl = await this.storage.signedUrl(doc.storagePath);
            signed = { ...doc, fileUrl: signedUrl };
          } catch {
            // leave fileUrl as-is if signing fails (e.g. object deleted from S3)
          }
        }
        // One `now` for the whole page so two documents with the same expiry can never
        // disagree about how many days are left.
        return this.decorate(signed, now);
      }),
    );
  }

  /**
   * The one live-row predicate every read in this service spreads. `delete()` is a SOFT
   * delete (see there for why), so "not deleted" is a condition on EVERY path — list,
   * rename, replace, download — not just the ones that happened to remember it. It is a
   * named constant rather than a repeated literal precisely because the module previously
   * had it on one of four list methods and nobody could see that from the code.
   */
  private static readonly LIVE = { deletedAt: null } as const;

  /**
   * Resolve a single document by id, live rows only. Replaces `findUnique({ where: { id } })`
   * on every by-id path: a soft-deleted document must 404 rather than be renamed, re-filed,
   * or — the one that actually leaks — handed back as a signed download URL.
   */
  private async findLive(id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, ...DocumentsService.LIVE } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async findByProject(projectId: string) {
    const docs = await this.prisma.document.findMany({
      where: { projectId, ...DocumentsService.LIVE },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.withSignedUrls(docs);
  }

  async findByUnit(unitId: string) {
    const docs = await this.prisma.document.findMany({
      where: { unitId, ...DocumentsService.LIVE },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.withSignedUrls(docs);
  }

  /** Sprint B: docs attached directly to a Building (whole-building leases, building-level
   *  contracts). Doc Vault Phase 1 already added documents.buildingId. */
  async findByBuilding(buildingId: string) {
    const docs = await this.prisma.document.findMany({
      where: { buildingId, ...DocumentsService.LIVE },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.withSignedUrls(docs);
  }

  /**
   * Documents attached to one sale — the set the stage gate actually reads.
   *
   * Scoped to `saleId` alone, deliberately, even though every such document also carries
   * the unit. The gate asks "what is on THIS sale", and a unit with two sales against it
   * over the years must not let the first deal's Deed satisfy the second's.
   */
  async findBySale(saleId: string) {
    const docs = await this.prisma.document.findMany({
      where: { saleId, ...DocumentsService.LIVE },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.withSignedUrls(docs);
  }

  async findByInteriorProject(interiorProjectId: string) {
    const docs = await this.prisma.document.findMany({
      where: { interiorProjectId, ...DocumentsService.LIVE },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.withSignedUrls(docs);
  }

  async create(
    file: Express.Multer.File,
    metadata: {
      projectId?: string;
      unitId?: string;
      saleId?: string;
      interiorProjectId?: string;
      category?: string;
      displayName?: string;
      /** D2 — ISO 8601 validity end. Omitted / empty means "no expiry", which is silent. */
      expiresAt?: string | Date | null;
    },
    userId: string,
  ) {
    // Parsed before the S3 upload so a malformed date fails the request rather than
    // orphaning an object in the bucket with no Document row pointing at it.
    const expiresAt = this.parseExpiry(metadata.expiresAt);

    /**
     * A document filed against a sale is also filed against that sale's unit and project.
     *
     * The links are independent columns, not an exactly-one-of, and this is the case that
     * needs both. A Deed is evidence about the deal (the stage gate reads `saleId`) and
     * evidence about the unit (whoever opens A-103 next year wants to see it, and will not
     * know which sale it arrived on). Filing it once, in one of the two places, guarantees
     * the other audience never finds it.
     *
     * Derived here rather than trusted from the caller: a client that sent a mismatched
     * unitId would file a Deed against the wrong unit, and the sale already knows the
     * right answer.
     */
    let { projectId, unitId } = metadata;
    if (metadata.saleId) {
      const sale = await this.prisma.sale.findUnique({
        where: { id: metadata.saleId },
        select: { id: true, projectId: true, unitId: true, deletedAt: true },
      });
      if (!sale || sale.deletedAt) throw new NotFoundException('Sale not found');
      unitId = sale.unitId ?? unitId;
      projectId = sale.projectId ?? projectId;
    }

    // Custom display name (optional). Preserve the original file extension so
    // View/Download keep the right type even when the user renames it.
    const customName = metadata.displayName?.trim();
    const dot = file.originalname.lastIndexOf('.');
    const ext = dot > 0 ? file.originalname.slice(dot) : '';
    const fileName = customName
      ? (ext && !customName.toLowerCase().endsWith(ext.toLowerCase()) ? customName + ext : customName)
      : file.originalname;
    let projectName: string | undefined;
    if (projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true },
      });
      projectName = project?.name;
    }

    const { storagePath, publicUrl } = await this.storage.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
      {
        projectId,
        projectName,
        category: metadata.category,
      },
    );

    const created = await this.prisma.document.create({
      data: {
        projectId: projectId || null,
        unitId: unitId || null,
        saleId: metadata.saleId || null,
        interiorProjectId: metadata.interiorProjectId || null,
        fileName,
        fileUrl: publicUrl,
        fileSize: file.size,
        mimeType: file.mimetype,
        category: (metadata.category as DocCategory) || DocCategory.GENERAL,
        uploadedById: userId,
        storagePath,
        expiresAt,
      },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return this.decorate(created);
  }

  /**
   * Rename and/or set-or-clear the expiry. Previously `rename`, taking a bare string.
   *
   * `expiresAt` is tri-state and read on KEY PRESENCE, not falsiness: absent leaves the
   * stored date alone, `null` clears it, a string sets it. Conflating "not sent" with
   * "clear it" would silently wipe a permit's expiry every time somebody renamed a file.
   */
  async update(id: string, dto: UpdateDocumentDto) {
    await this.findLive(id);

    const data: { fileName?: string; expiresAt?: Date | null } = {};

    if (dto.fileName !== undefined) {
      const trimmed = dto.fileName.trim();
      if (!trimmed) throw new BadRequestException('fileName is required');
      data.fileName = trimmed;
    }
    if ('expiresAt' in dto) {
      data.expiresAt = this.parseExpiry(dto.expiresAt);
    }

    const updated = await this.prisma.document.update({
      where: { id },
      data,
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return this.decorate(updated);
  }

  /**
   * Replace the bytes behind a document, ARCHIVING the outgoing file rather than destroying
   * it.
   *
   * This used to `storage.delete(doc.storagePath)` on the old object while nothing in the
   * API had ever written a `DocumentVersion` row — so the "archive of prior versions" the
   * schema promises (and its own comment claims this method maintains) was permanently
   * empty, and clicking Replace silently and irreversibly destroyed the previous file.
   *
   * The model is kept and implemented rather than dropped, for the same reason the delete
   * went soft: the superseded file is frequently the one that matters. The countersigned
   * copy replaces the draft, the revised drawing replaces the one the sub actually built
   * from, the corrected invoice replaces the one that was paid. A vault that can only ever
   * show you the newest scan of a document cannot answer "what did we have on file in
   * March", which is precisely the question a dispute asks. Dropping the model would also
   * have meant a destructive migration to delete a table whose absence is the bug.
   *
   * Retaining the object is what makes this correct rather than merely wasteful — and the
   * bytes it retains are covered by the same retention policy as everything else, see
   * DocumentRetentionService (a purged version reads as `available: false`, never as a
   * link).
   */
  async replaceFile(
    id: string,
    file: Express.Multer.File,
    newFileName?: string,
  ) {
    const doc = await this.findLive(id);

    // Upload new file; keep original project folder structure from storagePath if possible
    const projectId = doc.projectId ?? undefined;
    const { storagePath, publicUrl } = await this.storage.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
      { projectId },
    );

    const fileName = newFileName?.trim() || doc.fileName;

    try {
      // Archive row and version bump in one transaction: a Document claiming to be at v3
      // with no v2 archived is a worse state than either half of the change failing.
      const updated = await this.prisma.$transaction(async (tx) => {
        // `uploadedAt` on the archived version means "when these bytes went live", which is
        // NOT doc.updatedAt — a rename touches that. The previous archive's `archivedAt` is
        // the exact moment the outgoing version took over; for v1 it is the document's own
        // creation.
        const previous = await tx.documentVersion.findFirst({
          where: { documentId: id },
          orderBy: { versionNumber: 'desc' },
          select: { archivedAt: true },
        });

        await tx.documentVersion.create({
          data: {
            documentId: id,
            versionNumber: doc.versionNumber,
            fileName: doc.fileName,
            fileUrl: doc.fileUrl,
            storagePath: doc.storagePath,
            fileSize: doc.fileSize,
            mimeType: doc.mimeType,
            externalUrl: doc.externalUrl,
            // Who filed THAT version, which is not necessarily who is replacing it now.
            uploadedById: doc.uploadedById,
            uploadedAt: previous?.archivedAt ?? doc.createdAt,
          },
        });

        // `expiresAt` is deliberately untouched: replacing the FILE of a permit (a better
        // scan, a countersigned copy) does not change when that permit lapses. A renewal is
        // a new expiry, set explicitly through update().
        return tx.document.update({
          where: { id },
          data: {
            fileName,
            fileUrl: publicUrl,
            storagePath,
            fileSize: file.size,
            mimeType: file.mimetype,
            versionNumber: doc.versionNumber + 1,
          },
          include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
        });
      });
      return this.decorate(updated);
    } catch (err: any) {
      // Two replaces racing both read the same versionNumber; the unique
      // (documentId, versionNumber) index rejects the loser. Surface that as a retryable
      // conflict rather than an opaque 500 — the transaction means nothing was written.
      if (err?.code === 'P2002') {
        throw new ConflictException('This document was replaced by someone else — reload and try again');
      }
      throw err;
    }
  }

  /**
   * The archive, newest first. Without a read path the version rows would be an internal
   * detail, and "we kept it" is only true if somebody can get it back.
   *
   * `available` is the load-bearing field: a version whose object the retention purge has
   * removed keeps its row (file name, size, who filed it, when it was superseded) but
   * reports no URL at all. Handing back the stored `fileUrl` there would be a link into a
   * private bucket with nothing behind it — a 403 dressed as a download.
   */
  async listVersions(id: string) {
    await this.findLive(id);

    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId: id },
      orderBy: { versionNumber: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
    });

    return Promise.all(
      versions.map(async (version) => {
        let fileUrl: string | null = null;
        if (version.storagePath) {
          try {
            fileUrl = await this.storage.signedUrl(version.storagePath);
          } catch {
            // Signing failed (object gone from the bucket by some other route) — report it
            // as unavailable rather than as a URL that will not resolve.
          }
        }
        return { ...version, fileUrl, available: fileUrl !== null };
      }),
    );
  }

  /**
   * SOFT delete — set `deletedAt`, keep the row and keep the bytes.
   *
   * This was a `prisma.document.delete()`, which is what the rest of the app moved away
   * from in a5a08b4 (Building / Unit / Lease / Sale) for exactly the reason that applies
   * here. Documents are evidence, not content: `DocCategory` includes LOI, DEED,
   * BOOKING_AGREEMENT, CONTRACT, NOC and POSSESSION_CERTIFICATE, and the sale-stage gates
   * COUNT those rows. A hard delete therefore un-gated a transition that was previously
   * satisfied, with nothing left to say a document had ever been filed. The row is also
   * pointed at by LeaseTenantAssignment.documentId (`onDelete: SetNull`) — the signed
   * agreement behind a tenancy transfer would have quietly become null — and it cascades
   * DocumentVersion away.
   *
   * A deleted row is invisible to every read here (see LIVE), to the sale-stage gate and
   * to the expiry cron, both of which already filter `deletedAt: null`: a deleted LOI does
   * not satisfy a gate, and a deleted permit raises no renewal alert. Nothing in the API
   * hands the file back either — `getDownloadUrl` 404s on it.
   *
   * THE STORED OBJECT IS DELIBERATELY LEFT IN THE BUCKET AT DELETE TIME. The row still
   * points at it, and a DEED whose row survives while its bytes are gone is worse than no
   * row at all: it reads as proof and isn't.
   *
   * The retention window that decision deferred now exists: DocumentRetentionService purges
   * the objects behind purge-eligible categories 90 days later, leaving the row as a
   * tombstone with `storagePath: null`. The twelve evidentiary categories are never purged
   * at all. Read that file for the split and the reasoning — the point here is only that
   * this method never removes bytes itself, so a delete stays reversible for the whole
   * grace period.
   *
   * One cost survives and has no fix at this layer: a signed URL issued before the delete
   * stays valid for the remainder of its 1-hour TTL. Minting a NEW one is blocked
   * (`getDownloadUrl` 404s), which is the part that is actually enforceable without
   * per-object key rotation.
   */
  async delete(id: string) {
    await this.findLive(id);

    return this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getDownloadUrl(id: string): Promise<{ url: string; fileName: string }> {
    // Live-only: the bytes outlive the delete, so this is the one read that would still
    // hand out a deleted DEED if it resolved by bare id.
    const doc = await this.findLive(id);

    const storagePath = (doc as any).storagePath as string | null;
    if (storagePath) {
      const url = await this.storage.signedUrl(storagePath);
      return { url, fileName: doc.fileName };
    }
    return { url: doc.fileUrl, fileName: doc.fileName };
  }
}
