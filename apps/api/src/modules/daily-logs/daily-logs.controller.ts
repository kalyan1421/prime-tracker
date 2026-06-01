import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DailyLogsService } from './daily-logs.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';

@ApiTags('Daily Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('daily-logs')
export class DailyLogsController {
  constructor(private service: DailyLogsService) {}

  @Get()
  @RequirePermissions('dailylog:view')
  @ApiOperation({ summary: 'List daily logs (filter by project/building), most recent first' })
  findAll(@Query('projectId') projectId?: string, @Query('buildingId') buildingId?: string) {
    return this.service.findAll({ projectId, buildingId });
  }

  @Get(':id')
  @RequirePermissions('dailylog:view')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @RequirePermissions('dailylog:edit')
  @ApiOperation({ summary: 'Create a daily log (author = current user)' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() body: {
      projectId: string;
      buildingId?: string;
      logDate?: string;
      notes: string;
      weather?: string;
      crewCount?: number;
    },
  ) {
    return this.service.create({ ...body, authorId: userId });
  }

  @Patch(':id')
  @RequirePermissions('dailylog:edit')
  update(
    @Param('id') id: string,
    @Body() body: { logDate?: string; notes?: string; weather?: string; crewCount?: number; buildingId?: string | null },
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('dailylog:edit')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/photos')
  @RequirePermissions('dailylog:edit')
  @ApiOperation({ summary: 'Attach a photo (uploaded via presigned URL) to a daily log' })
  addPhoto(@Param('id') id: string, @Body() body: { storagePath: string; caption?: string }) {
    return this.service.addPhoto(id, body);
  }

  @Delete('photos/:photoId')
  @RequirePermissions('dailylog:edit')
  removePhoto(@Param('photoId') photoId: string) {
    return this.service.removePhoto(photoId);
  }
}
