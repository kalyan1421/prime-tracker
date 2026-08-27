import {
  Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DailyLogsService, type DailyLogSource } from './daily-logs.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CreateDailyLogDto, UpdateDailyLogDto, AddDailyLogPhotoDto } from './dto/create-daily-log.dto';

/** Conservative: anything not clearly a phone or tablet is WEB. */
function sourceFromUserAgent(ua?: string): DailyLogSource {
  if (!ua) return 'WEB';
  return /\b(Android|iPhone|iPad|iPod|Mobile|Windows Phone)\b/i.test(ua) ? 'MOBILE' : 'WEB';
}

@ApiTags('Daily Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('daily-logs')
export class DailyLogsController {
  constructor(private service: DailyLogsService) {}

  @Get()
  @RequirePermissions('dailylog:view')
  @ApiOperation({ summary: 'List daily logs (filter by project/building/unit), most recent first' })
  findAll(
    @Query('projectId') projectId?: string,
    @Query('buildingId') buildingId?: string,
    @Query('unitId') unitId?: string,
    @Query('source') source?: string,
  ) {
    return this.service.findAll({ projectId, buildingId, unitId, source });
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
    @Body() body: CreateDailyLogDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    // WEB vs MOBILE is a display hint — the feed shows a phone marker on a post made from
    // site, the way the client's board does. It is derived from the user agent rather than
    // taken from the body, because nothing a caller sends is allowed to set `source`; a
    // wrong guess here mislabels an icon, a trusted body field would let anyone forge an
    // "arrived by email" badge. The app is responsive rather than a native build, so a
    // phone-shaped user agent is the only signal there is.
    return this.service.create({ ...body, authorId: userId }, sourceFromUserAgent(userAgent));
  }

  @Patch(':id')
  @RequirePermissions('dailylog:edit')
  update(
    @Param('id') id: string,
    @Body() body: UpdateDailyLogDto,
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
  addPhoto(@Param('id') id: string, @Body() body: AddDailyLogPhotoDto) {
    return this.service.addPhoto(id, body);
  }

  @Delete('photos/:photoId')
  @RequirePermissions('dailylog:edit')
  removePhoto(@Param('photoId') photoId: string) {
    return this.service.removePhoto(photoId);
  }
}
