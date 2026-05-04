import {
  Controller, Get, Post, Delete, Param, Body, Query, Res,
  UseGuards, UseInterceptors, Request, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { Response } from 'express';
import * as path from 'path';

const multerStorage = diskStorage({
  destination: './uploads',
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + extname(file.originalname));
  },
});

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('documents')
export class DocumentsController {
  constructor(private service: DocumentsService) {}

  @Get()
  @RequirePermissions('document:view')
  @ApiOperation({ summary: 'List documents by projectId or unitId' })
  find(@Query('projectId') projectId: string, @Query('unitId') unitId: string) {
    if (unitId) return this.service.findByUnit(unitId);
    return this.service.findByProject(projectId);
  }

  @Post()
  @RequirePermissions('document:upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document' })
  @UseInterceptors(FileInterceptor('file', { storage: multerStorage }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.service.create(file, body, req.user.sub);
  }

  @Delete(':id')
  @RequirePermissions('document:upload')
  @ApiOperation({ summary: 'Delete a document' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Get(':id/download')
  @RequirePermissions('document:view')
  @ApiOperation({ summary: 'Download a document file' })
  async download(@Param('id') id: string, @Res() res: Response) {
    const doc = await this.service.getFilePath(id);
    if (!doc) {
      res.status(404).json({ message: 'Document not found' });
      return;
    }
    const filePath = path.join(process.cwd(), 'uploads', path.basename(doc.fileUrl));
    res.download(filePath, doc.fileName);
  }
}
