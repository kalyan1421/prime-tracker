import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { DocCategory } from '@prisma/client';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async findByProject(projectId: string) {
    return this.prisma.document.findMany({
      where: { projectId },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByUnit(unitId: string) {
    return this.prisma.document.findMany({
      where: { unitId },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Sprint B: docs attached directly to a Building (whole-building leases, building-level
   *  contracts). Doc Vault Phase 1 already added documents.buildingId. */
  async findByBuilding(buildingId: string) {
    return this.prisma.document.findMany({
      where: { buildingId },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByInteriorProject(interiorProjectId: string) {
    return this.prisma.document.findMany({
      where: { interiorProjectId, deletedAt: null },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    file: Express.Multer.File,
    metadata: { projectId?: string; unitId?: string; interiorProjectId?: string; category?: string },
    userId: string,
  ) {
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
        fileName: file.originalname,
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
