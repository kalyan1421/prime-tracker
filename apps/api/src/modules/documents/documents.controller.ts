import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Res,
  UseGuards, UseInterceptors, Request, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { DocumentRetentionService } from './document-retention.service';
import { StorageService } from '../../common/storage/storage.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { PresignedUploadDto } from './dto/presigned-upload.dto';
import { Response } from 'express';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('documents')
export class DocumentsController {
  constructor(
    private service: DocumentsService,
    private storage: StorageService,
    private retention: DocumentRetentionService,
  ) {}

  /**
   * POST /api/documents/presigned-upload
   * Returns an URL the browser PUTs the file to directly. Avoids proxying
   * large files through the API. Caller persists the storagePath in their
   * own table (DrawDocument, MilestonePhoto, etc.) on success.
   */
  @Post('presigned-upload')
  @RequirePermissions('document:upload')
  @ApiOperation({ summary: 'Issue a presigned S3 upload URL for client-direct upload' })
  presignedUpload(@Body() body: PresignedUploadDto) {
    return this.storage.createPresignedUpload(body.filename, {
      projectId: body.projectId,
      projectName: body.projectName,
      category: body.category,
    });
  }

  /**
   * GET /api/documents/retention/preview
   *
   * The dry run, on demand. The purge is the only irreversible step in the document flow,
   * so "what would today's run remove" has to be answerable WITHOUT running it — otherwise
   * the first time anyone sees the policy's blast radius is after it has fired.
   *
   * Admin-only (`user:manage`): it enumerates storage keys across every project, which is
   * broader than the per-project document permission covers.
   *
   * Declared above the `:id` routes so the literal path can never be read as an id.
   */
  @Get('retention/preview')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Dry-run the document retention purge — lists what would be removed' })
  retentionPreview() {
    return this.retention.purge({ dryRun: true });
  }

  @Get()
  @RequirePermissions('document:view')
  @ApiOperation({ summary: 'List documents by projectId, buildingId, unitId, saleId, or interiorProjectId' })
  find(
    @Query('projectId') projectId: string,
    @Query('unitId') unitId: string,
    @Query('buildingId') buildingId?: string,
    @Query('saleId') saleId?: string,
    @Query('interiorProjectId') interiorProjectId?: string,
  ) {
    if (interiorProjectId) return this.service.findByInteriorProject(interiorProjectId);
    // Before unitId: a sale-scoped read must not widen to the unit's whole file. The stage
    // gate asks what is on THIS sale, and a unit that sold twice would otherwise let the
    // first deal's Deed answer for the second.
    if (saleId) return this.service.findBySale(saleId);
    if (unitId) return this.service.findByUnit(unitId);
    if (buildingId) return this.service.findByBuilding(buildingId);
    return this.service.findByProject(projectId);
  }

  /**
   * POST /api/documents/upload-file
   *
   * Upload a file THROUGH the API and get back its storage path. No Document row is
   * created — this is for the callers that store a path on their own table (a task
   * update's photo, a building's cover image, a milestone photo).
   *
   * Why this exists alongside `presigned-upload`: a presigned PUT goes browser → S3
   * directly, which is a CROSS-ORIGIN request and therefore needs a CORS rule on the
   * bucket. Without one the browser blocks it at preflight and every upload fails with
   * an opaque "Failed to fetch" — which is exactly what was happening. This route is
   * same-origin, so it works whatever the bucket is configured to allow.
   *
   * The presigned route is kept for genuinely large files, where streaming through the
   * API is worth avoiding; it becomes useful again once the bucket has a CORS rule.
   */
  @Post('upload-file')
  @RequirePermissions('document:upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file and return its storage path (no Document row)' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } }))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { projectId?: string; projectName?: string; category?: string },
  ) {
    if (!file) throw new BadRequestException('No file was received');
    const { storagePath, publicUrl } = await this.storage.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
      { projectId: body.projectId, projectName: body.projectName, category: body.category },
    );
    return { storagePath, publicUrl, filename: file.originalname };
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

  /**
   * Rename a document and/or set/clear its expiry. Body was an inline untyped object,
   * which the global ValidationPipe skips entirely — a real DTO is what makes `expiresAt`
   * reachable at all under `forbidNonWhitelisted: true`.
   *
   * Both fields are optional: `{ fileName }` alone still works exactly as before, and
   * `{ expiresAt: null }` clears a date that was entered in error.
   */
  @Patch(':id')
  @RequirePermissions('document:upload')
  @ApiOperation({ summary: 'Rename a document and/or set its expiry date' })
  update(@Param('id') id: string, @Body() body: UpdateDocumentDto) {
    return this.service.update(id, body);
  }

  @Post(':id/replace')
  @RequirePermissions('document:upload')
  @ApiOperation({ summary: 'Replace document file (and optionally rename)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } }))
  replace(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { fileName?: string },
  ) {
    return this.service.replaceFile(id, file, body.fileName);
  }

  @Delete(':id')
  @RequirePermissions('document:upload')
  @ApiOperation({ summary: 'Delete a document' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  /**
   * The archive `replaceFile` now writes. Each entry reports `available` — false once the
   * retention purge has removed its object — so the UI can show that a version existed
   * without offering a link to bytes that are gone.
   */
  @Get(':id/versions')
  @RequirePermissions('document:view')
  @ApiOperation({ summary: 'List archived prior versions of a document' })
  versions(@Param('id') id: string) {
    return this.service.listVersions(id);
  }

  @Get(':id/download')
  @RequirePermissions('document:view')
  @ApiOperation({ summary: 'Get a signed download URL for a document' })
  async download(@Param('id') id: string, @Res() res: Response) {
    const { url } = await this.service.getDownloadUrl(id);
    res.redirect(url);
  }
}
