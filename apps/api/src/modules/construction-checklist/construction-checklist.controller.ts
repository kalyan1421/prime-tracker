import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConstructionChecklistService } from './construction-checklist.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { AddTemplateItemDto } from './dto/template-item.dto';
import {
  AddUnitStageDto, AddUnitStagesDto, ReorderUnitStagesDto, UpdateUnitStageDto,
} from './dto/unit-stage.dto';

@ApiTags('Construction Checklist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('construction-checklist')
export class ConstructionChecklistController {
  constructor(
    private service: ConstructionChecklistService,
  ) {}

  // ── Building template (per-building override) ───────────────────────────────

  @Get('template')
  @RequirePermissions('checklist:view')
  @ApiOperation({ summary: "A building's stage template, in order" })
  getTemplate(@Query('buildingId') buildingId: string) {
    return this.service.getTemplate(buildingId);
  }

  @Post('template')
  @RequirePermissions('checklist:edit')
  @ApiOperation({ summary: 'Append a stage to a building\'s template (existing units are untouched)' })
  addTemplateItem(
    @Query('buildingId') buildingId: string,
    @Body() body: AddTemplateItemDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.addTemplateItem(buildingId, body.label, userId);
  }

  @Delete('template/:templateItemId')
  @RequirePermissions('checklist:edit')
  @ApiOperation({ summary: 'Remove a stage from the template (existing units keep it)' })
  deleteTemplateItem(@Param('templateItemId') templateItemId: string) {
    return this.service.deleteTemplateItem(templateItemId);
  }

  // ── Per-unit checklist ──────────────────────────────────────────────────────

  @Get('unit')
  @RequirePermissions('checklist:view')
  @ApiOperation({ summary: "A unit's construction checklist, in order" })
  getUnitStages(@Query('unitId') unitId: string) {
    return this.service.getUnitStages(unitId);
  }

  @Post('unit/:unitId/apply-template')
  @RequirePermissions('checklist:edit')
  @ApiOperation({
    summary: "Seed a unit's checklist from its building's template",
    description: 'One-time only — refused (400) if the unit already has any stages.',
  })
  applyTemplate(@Param('unitId') unitId: string, @CurrentUser('sub') userId: string) {
    return this.service.applyTemplate(unitId, userId);
  }

  @Post('unit/:unitId/stage')
  @RequirePermissions('checklist:edit')
  @ApiOperation({ summary: 'Add a one-off stage to a single unit (does not touch the template)' })
  addUnitStage(
    @Param('unitId') unitId: string,
    @Body() body: AddUnitStageDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.addUnitStage(unitId, body, userId);
  }

  // Stage names themselves come from GET /custom-options?category=construction_stage now,
  // the same catalogue that already backs status and inspection status on the same form.
  @Get('ad-hoc-stages')
  @RequirePermissions('checklist:view')
  @ApiOperation({
    summary: 'Stage names in use that the catalogue does not offer',
    description:
      'Labels recorded on visible units that are not an active construction_stage option — '
      + 'one-off stages and retired legacy names. Admin promotes the useful ones.',
  })
  getAdHocStages(
    @Query('buildingId') buildingId: string | undefined,
    @Query('projectId') projectId: string | undefined,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.getAdHocStages({ buildingId, projectId }, userId, role);
  }

  // One request, not a loop of the route above: the 10 req/sec throttle silently truncates
  // a seventeen-stage batch sent as seventeen calls.
  @Post('unit/:unitId/stages')
  @RequirePermissions('checklist:edit')
  @ApiOperation({
    summary: 'Add several stages to a unit at once',
    description: 'Appended in the order given. Labels already on the unit are skipped, not rejected.',
  })
  addUnitStages(
    @Param('unitId') unitId: string,
    @Body() body: AddUnitStagesDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.addUnitStages(unitId, body.labels, userId);
  }

  @Patch('unit/:unitId/stages/order')
  @RequirePermissions('checklist:edit')
  @ApiOperation({
    summary: "Reorder a unit's stages",
    description: 'The payload must list every stage on the unit exactly once.',
  })
  reorderUnitStages(
    @Param('unitId') unitId: string,
    @Body() body: ReorderUnitStagesDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.reorderUnitStages(unitId, body.stageIds, userId);
  }

  @Patch('stage/:stageId')
  @RequirePermissions('checklist:edit')
  @ApiOperation({ summary: 'Update a stage — status, owner, inspection status/date, notes' })
  updateStage(@Param('stageId') stageId: string, @Body() body: UpdateUnitStageDto) {
    return this.service.updateStage(stageId, body);
  }

  @Post('stage/:stageId/photos')
  @RequirePermissions('checklist:edit')
  @ApiOperation({ summary: 'Attach a photo to a checklist stage' })
  addStagePhoto(
    @Param('stageId') stageId: string,
    @Body() body: { storagePath: string; caption?: string },
    @CurrentUser('sub') userId?: string,
  ) {
    return this.service.addStagePhoto(stageId, body.storagePath, body.caption, userId);
  }

  @Delete('photos/:photoId')
  @RequirePermissions('checklist:edit')
  @ApiOperation({ summary: 'Remove a stage photo' })
  removeStagePhoto(@Param('photoId') photoId: string) {
    return this.service.removeStagePhoto(photoId);
  }

  @Delete('stage/:stageId')
  @RequirePermissions('checklist:edit')
  @ApiOperation({ summary: 'Remove a stage from a unit\'s checklist' })
  deleteStage(@Param('stageId') stageId: string) {
    return this.service.deleteStage(stageId);
  }

  // One request, not a loop of the route above — same reason the bulk add exists: the
  // throttle truncates a forty-stage teardown sent as forty calls, leaving half of a
  // checklist that was meant to be gone.
  @Delete('unit/:unitId/stages')
  @RequirePermissions('checklist:edit')
  @ApiOperation({
    summary: "Clear a unit's whole checklist",
    description:
      'Deletes every stage on the unit and the photos attached to them. Site updates pinned '
      + 'to a stage are kept and lose only the pin. Returns what was removed.',
  })
  clearUnitStages(@Param('unitId') unitId: string) {
    return this.service.clearUnitStages(unitId);
  }

  // ── Rollup ──────────────────────────────────────────────────────────────────

  @Get('rollup')
  @RequirePermissions('checklist:view')
  @ApiOperation({ summary: 'Every unit with a checklist, progress and next stage — one project, or all the caller can see' })
  getProjectRollup(
    @Query('projectId') projectId: string | undefined,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.getProjectRollup(projectId, userId, role);
  }
}
