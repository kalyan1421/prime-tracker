import { Controller, Get, Post, Put, Query, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentUser } from '../../common/decorators/index';
import { NotificationType } from '@prisma/client';

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
    return this.service.findForUser(userId, limit ? parseInt(limit) : 20);
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark notifications as read' })
  markRead(
    @CurrentUser('sub') userId: string,
    @Body() body: { ids?: string[] },
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
    @Body() body: { type: NotificationType; enabled?: boolean; emailEnabled?: boolean | null },
  ) {
    return this.service.setPreference(userId, body.type, body.enabled, body.emailEnabled);
  }
}
