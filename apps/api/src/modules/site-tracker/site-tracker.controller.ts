import {
  BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { SiteTrackerService } from './site-tracker.service';
import { SiteTrackerImportService } from './site-tracker-import.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';

@ApiTags('Site Tracker')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('site-tracker')
export class SiteTrackerController {
  constructor(
    private service: SiteTrackerService,
    private importer: SiteTrackerImportService,
  ) {}

  /**
   * Move the monday Site Tracker board across. `apply=false` (the default) is a preview that
   * writes nothing; `apply=true` writes the rows marked ready. Founder / Super Admin only —
   * it touches every property at once.
   */
  @Post('import')
  @RequirePermissions('siteTracker:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Preview or apply an import of the monday "Site Tracker" board export (.xlsx)' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  importMonday(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('sub') userId: string,
    @Body('apply') apply?: string,
    @Body('projectMap') projectMap?: string,
  ) {
    if (!file) throw new BadRequestException('No file was received');
    let map: Record<string, string> = {};
    if (projectMap) {
      try { map = JSON.parse(projectMap); } catch { throw new BadRequestException('projectMap must be JSON'); }
    }
    return this.importer.run(file.buffer, { apply: apply === 'true', projectMap: map, userId });
  }

  @Get()
  @RequirePermissions('siteTracker:view')
  @ApiOperation({ summary: 'Every tracked unit across all properties, with blocker, checklist progress and summary' })
  grid(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('permissions') permissions: string[],
    @CurrentUser('roles') roles?: string[],
    @Query('projectId') projectId?: string,
    @Query('buildingId') buildingId?: string,
    @Query('blockerStatus') blockerStatus?: string,
    @Query('sitePriority') sitePriority?: string,
    @Query('search') search?: string,
    @Query('includeUntracked') includeUntracked?: string,
    @Query('untrackedOnly') untrackedOnly?: string,
  ) {
    return this.service.grid(
      { projectId, buildingId, blockerStatus, sitePriority, search,
        includeUntracked: includeUntracked === 'true',
        untrackedOnly: untrackedOnly === 'true' },
      { userId, role, roles, permissions: permissions ?? [] },
    );
  }
}
