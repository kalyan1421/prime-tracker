import { Controller, Get, Post, Body, Query, Res, UseGuards, SetMetadata } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { QuickbooksService } from './quickbooks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { RequirePermissions, RequireMfa, CurrentUser } from '../../common/decorators/index';

@ApiTags('QuickBooks')
@Controller('quickbooks')
export class QuickbooksController {
  constructor(
    private service: QuickbooksService,
    private config: ConfigService,
  ) {}

  @Get('connect')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('quickbooks:manage')
  connect(@Res() res: Response) {
    const authUrl = this.service.getAuthUrl();
    res.redirect(authUrl);
  }

  @Get('callback')
  @SetMetadata('isPublic', true)
  async callback(
    @Query('code') code: string,
    @Query('realmId') realmId: string,
    @Res() res: Response,
  ) {
    await this.service.handleCallback(code, realmId);
    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:5173');
    res.redirect(`${frontendUrl}/admin/integrations?qb=connected`);
  }

  @Get('status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('quickbooks:manage')
  async getStatus() {
    const connection = await this.service.getConnection();
    return {
      enabled: this.service.isEnabled(),
      connected: !!connection,
      companyName: connection?.companyName,
      lastSyncAt: connection?.lastSyncAt,
    };
  }

  @Post('sync')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard, MfaGuard)
  @RequirePermissions('quickbooks:manage')
  @RequireMfa()
  async syncAll(@CurrentUser('sub') userId: string) {
    const connection = await this.service.getConnection();
    if (!connection) return { error: 'No QuickBooks connection' };
    return this.service.syncAll(connection.realmId, userId);
  }

  @Get('sync-logs')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('quickbooks:manage')
  getSyncLogs(@Query('limit') limit?: number) {
    return this.service.getSyncLogs(limit);
  }

  @Get('mappings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('quickbooks:manage')
  getMappings() {
    return this.service.getProjectMappings();
  }

  @Post('mappings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('quickbooks:manage')
  upsertMapping(@Body() body: { projectId: string; qbClassId?: string; qbClassName?: string; qbLocationId?: string; qbLocationName?: string }) {
    return this.service.upsertProjectMapping(body.projectId, body);
  }
}
