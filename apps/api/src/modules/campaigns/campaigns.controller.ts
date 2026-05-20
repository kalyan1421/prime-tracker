import {
  Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, UpdateCampaignDto, RecordSpendDto } from './dto/campaign.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CampaignChannel, CampaignStatus } from '@prisma/client';

@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('campaigns')
export class CampaignsController {
  constructor(private service: CampaignsService) {}

  // ---- List + read ----

  @Get()
  @RequirePermissions('campaign:view')
  @ApiOperation({ summary: 'List campaigns (filter by project / status / channel)' })
  findAll(
    @Query('projectId') projectId?: string,
    @Query('status') status?: CampaignStatus,
    @Query('channel') channel?: CampaignChannel,
  ) {
    return this.service.findAll({ projectId, status, channel });
  }

  @Get('performance')
  @RequirePermissions('campaign:view')
  @ApiOperation({ summary: 'Campaign performance: leads + revenue + spend + CPL + CPA + ROI' })
  performance(
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.performance({ projectId, from, to });
  }

  @Get('spend-trend')
  @RequirePermissions('campaign:view')
  @ApiOperation({ summary: 'Monthly spend trend grouped by channel (default last 6 months)' })
  spendTrend(
    @Query('projectId') projectId?: string,
    @Query('monthsBack') monthsBack?: string,
  ) {
    return this.service.spendTrend({ projectId, monthsBack: monthsBack ? parseInt(monthsBack, 10) : undefined });
  }

  @Get(':id')
  @RequirePermissions('campaign:view')
  @ApiOperation({ summary: 'Get a single campaign with spend ledger' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  // ---- Mutate ----

  @Post()
  @RequirePermissions('campaign:create')
  @ApiOperation({ summary: 'Create a new campaign' })
  create(@Body() body: CreateCampaignDto, @CurrentUser('sub') userId: string) {
    return this.service.create({ ...body, createdBy: userId });
  }

  @Put(':id')
  @RequirePermissions('campaign:edit')
  @ApiOperation({ summary: 'Update a campaign' })
  update(@Param('id') id: string, @Body() body: UpdateCampaignDto) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('campaign:delete')
  @ApiOperation({ summary: 'Soft-delete a campaign (preserves attribution history)' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  // ---- Spend ledger ----

  @Get(':id/spend')
  @RequirePermissions('campaign:view')
  @ApiOperation({ summary: 'List spend entries for a campaign' })
  listSpend(@Param('id') id: string) {
    return this.service.listSpend(id);
  }

  @Post(':id/spend')
  @RequirePermissions('campaign:spend')
  @ApiOperation({ summary: 'Record a spend entry (manual or import)' })
  recordSpend(
    @Param('id') id: string,
    @Body() body: RecordSpendDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.recordSpend(id, { ...body, recordedBy: userId });
  }
}
