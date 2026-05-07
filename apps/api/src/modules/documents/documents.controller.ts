import {
  Controller, Get, Post, Delete, Param, Body, Query, Res,
  UseGuards, UseInterceptors, Request, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { StorageService } from '../../common/storage/storage.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { Response } from 'express';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('documents')
export class DocumentsController {
  constructor(private service: DocumentsService, private storage: StorageService) {}

  /**
   * POST /api/documents/presigned-upload
   * Returns an URL the browser PUTs the file to directly. Avoids proxying
   * large files through the API. Caller persists the storagePath in their
   * own table (DrawDocument, MilestonePhoto, etc.) on success.
   */
  @Post('presigned-upload')
  @RequirePermissions('document:upload')
  @ApiOperation({ summary: 'Issue a presigned Supabase upload URL for client-direct upload' })
  presignedUpload(@Body() body: { filename: string; projectId?: string; projectName?: string; category?: string }) {
    return this.storage.createPresignedUpload(body.filename, {
      projectId: body.projectId,
      projectName: body.projectName,
      category: body.category,
    });
  }

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
  @ApiOperation({ summary: 'Upload a document to Supabase Storage' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentDto,
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
  @ApiOperation({ summary: 'Get a signed download URL for a document' })
  async download(@Param('id') id: string, @Res() res: Response) {
    const { url } = await this.service.getDownloadUrl(id);
    res.redirect(url);
  }
}
