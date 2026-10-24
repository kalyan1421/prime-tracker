import { Controller, Get, Post, Put, Query, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentUser } from '../../common/decorators/index';
import { MarkNotificationsReadDto, SetNotificationPreferenceDto } from './dto/notification.dto';
import { clampLimit } from '../../common/pagination/pagination.dto';

/** The bell shows 20; the full list page asks for more, but never the whole history. */
const MAX_NOTIFICATIONS_PAGE = 100;

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get in-app notifications for the current user' })
  findForUser(
    @CurrentUser('sub') userId: string,
    @Query('limit') limit?: string,
  ) {
    // Capped: `?limit=1000000` used to load a user's whole notification history.
    return this.service.findForUser(userId, clampLimit(limit, 20, MAX_NOTIFICATIONS_PAGE));
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark notifications as read' })
  markRead(
    @CurrentUser('sub') userId: string,
    @Body() body: MarkNotificationsReadDto,
  ) {
    return this.service.markRead(userId, body.ids);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences for the current user' })
  getPreferences(@CurrentUser('sub') userId: string) {
    return this.service.getPreferences(userId);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update a notification preference' })
  setPreference(
    @CurrentUser('sub') userId: string,
    // Both channels optional and independent: the settings page changes one at a time,
    // and emailEnabled:null (clear the override back to the tier default) is distinct
    // from omitting the field.
    @Body() body: SetNotificationPreferenceDto,
  ) {
    return this.service.setPreference(userId, body.type, body.enabled, body.emailEnabled);
  }
}
