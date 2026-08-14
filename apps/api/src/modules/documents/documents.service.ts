import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  async findByProject(projectId: string) {
    const docs = await this.prisma.document.findMany({
      where: { projectId },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.withSignedUrls(docs);
  }

  async findByUnit(unitId: string) {
    const docs = await this.prisma.document.findMany({
      where: { unitId },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.withSignedUrls(docs);
  }

  /** Sprint B: docs attached directly to a Building (whole-building leases, building-level
   *  contracts). Doc Vault Phase 1 already added documents.buildingId. */
  async findByBuilding(buildingId: string) {
    const docs = await this.prisma.document.findMany({
      where: { buildingId },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.withSignedUrls(docs);
  }

  async findByInteriorProject(interiorProjectId: string) {
    const docs = await this.prisma.document.findMany({
      where: { interiorProjectId, deletedAt: null },
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

    // Custom display name (optional). Preserve the original file extension so
    // View/Download keep the right type even when the user renames it.
    const customName = metadata.displayName?.trim();
    const dot = file.originalname.lastIndexOf('.');
    const ext = dot > 0 ? file.originalname.slice(dot) : '';
    const fileName = customName
      ? (ext && !customName.toLowerCase().endsWith(ext.toLowerCase()) ? customName + ext : customName)
      : file.originalname;
    let projectName: string | undefined;
    if (metadata.projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: metadata.projectId },
        select: { name: true },
      });
      projectName = project?.name;
    }

    const { storagePath, publicUrl } = await this.storage.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
      {
        projectId: metadata.projectId,
        projectName,
        category: metadata.category,
      },
    );

    const created = await this.prisma.document.create({
      data: {
        projectId: metadata.projectId || null,
        unitId: metadata.unitId || null,
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
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');

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

  async replaceFile(
    id: string,
    file: Express.Multer.File,
    newFileName?: string,
  ) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');

    // Upload new file; keep original project folder structure from storagePath if possible
    const projectId = doc.projectId ?? undefined;
    const { storagePath, publicUrl } = await this.storage.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
      { projectId },
    );

    // Delete old file from S3 (non-fatal if it's already gone)
    if (doc.storagePath) {
      await this.storage.delete(doc.storagePath).catch(() => {});
    }

    const fileName = newFileName?.trim() || doc.fileName;

    // `expiresAt` is deliberately untouched: replacing the FILE of a permit (a better scan,
    // a countersigned copy) does not change when that permit lapses. A renewal is a new
    // expiry, set explicitly through update().
    const updated = await this.prisma.document.update({
      where: { id },
      data: { fileName, fileUrl: publicUrl, storagePath, fileSize: file.size, mimeType: file.mimetype },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return this.decorate(updated);
  }

  async delete(id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');

    if ((doc as any).storagePath) {
      await this.storage.delete((doc as any).storagePath);
    }

    return this.prisma.document.delete({ where: { id } });
  }

  async getDownloadUrl(id: string): Promise<{ url: string; fileName: string }> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');

    const storagePath = (doc as any).storagePath as string | null;
    if (storagePath) {
      const url = await this.storage.signedUrl(storagePath);
      return { url, fileName: doc.fileName };
    }
    return { url: doc.fileUrl, fileName: doc.fileName };
  }
}
