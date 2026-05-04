import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DocCategory } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

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

  async create(file: Express.Multer.File, metadata: any, userId: string) {
    return this.prisma.document.create({
      data: {
        projectId: metadata.projectId || null,
        unitId: metadata.unitId || null,
        fileName: file.originalname,
        fileUrl: `/uploads/${file.filename}`,
        fileSize: file.size,
        mimeType: file.mimetype,
        category: (metadata.category as DocCategory) || DocCategory.GENERAL,
        uploadedById: userId,
      },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async delete(id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');

    // Remove file from disk
    const filePath = path.join(process.cwd(), 'uploads', path.basename(doc.fileUrl));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return this.prisma.document.delete({ where: { id } });
  }

  getFilePath(id: string) {
    return this.prisma.document.findUnique({ where: { id } });
  }
}
