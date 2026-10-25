import { Controller, Get, Param, ParseBoolPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { RequirePermissions } from '../../common/decorators/index';
import { WebsiteSyncService } from './website-sync.service';

@ApiTags('Website sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@Controller('website-sync')
export class WebsiteSyncController {
  constructor(private sync: WebsiteSyncService) {}

  /** Exactly what would leave the tracker for this project — nothing is sent. */
  @Get('projects/:id/snapshot')
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Preview the unit snapshot the website would receive' })
  snapshot(@Param('id') id: string) {
    return this.sync.snapshotFor(id);
  }

  /**
   * Push now instead of waiting for the cron. `dryRun=true` returns the website's
   * report of what it would change without writing — do that first for a newly
   * published project. `force=true` overrides the website's removal guard.
   */
  @Post('projects/:id/push')
  @RequirePermissions('project:edit')
  @ApiOperation({ summary: 'Push this project to the website now' })
  push(
    @Param('id') id: string,
    @Query('dryRun', new ParseBoolPipe({ optional: true })) dryRun?: boolean,
    @Query('force', new ParseBoolPipe({ optional: true })) force?: boolean,
  ) {
    return this.sync.pushProject(id, { dryRun, force });
  }
}
