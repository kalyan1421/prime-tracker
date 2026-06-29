import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { DocCategory } from '@prisma/client';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /**
   * S3 bucket is private — replace the stored raw S3 URL with a 1-hour signed URL
   * so the browser can load documents without credentials.  For external URLs
   * (no storagePath), the original fileUrl is kept as-is.
   */
  private async withSignedUrls<T extends { storagePath?: string | null; fileUrl: string }>(
    docs: T[],
  ): Promise<T[]> {
    return Promise.all(
      docs.map(async (doc) => {
        if (doc.storagePath) {
          try {
            const signedUrl = await this.storage.signedUrl(doc.storagePath);
            return { ...doc, fileUrl: signedUrl };
          } catch {
            // leave fileUrl as-is if signing fails (e.g. object deleted from S3)
          }
        }
        return doc;
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
    metadata: { projectId?: string; unitId?: string; interiorProjectId?: string; category?: string; displayName?: string },
    userId: string,
  ) {
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

    return this.prisma.document.create({
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
      },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async rename(id: string, fileName: string) {
    const trimmed = fileName.trim();
    if (!trimmed) throw new BadRequestException('fileName is required');
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    return this.prisma.document.update({
      where: { id },
      data: { fileName: trimmed },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
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

    return this.prisma.document.update({
      where: { id },
      data: { fileName, fileUrl: publicUrl, storagePath, fileSize: file.size, mimeType: file.mimetype },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
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
