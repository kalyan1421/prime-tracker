import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConstructionChecklistService } from './construction-checklist.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { AddTemplateItemDto } from './dto/template-item.dto';
import { AddUnitStageDto, UpdateUnitStageDto } from './dto/unit-stage.dto';

@ApiTags('Construction Checklist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('construction-checklist')
export class ConstructionChecklistController {
  constructor(private service: ConstructionChecklistService) {}

  // ── Building template ───────────────────────────────────────────────────────

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
    return this.service.addUnitStage(unitId, body.label, userId);
  }

  @Patch('stage/:stageId')
  @RequirePermissions('checklist:edit')
  @ApiOperation({ summary: 'Update a stage — status, owner, inspection status/date, notes' })
  updateStage(@Param('stageId') stageId: string, @Body() body: UpdateUnitStageDto) {
    return this.service.updateStage(stageId, body);
  }

  @Delete('stage/:stageId')
  @RequirePermissions('checklist:edit')
  @ApiOperation({ summary: 'Remove a stage from a unit\'s checklist' })
  deleteStage(@Param('stageId') stageId: string) {
    return this.service.deleteStage(stageId);
  }

  // ── Rollup ──────────────────────────────────────────────────────────────────

  @Get('rollup')
  @RequirePermissions('checklist:view')
  @ApiOperation({ summary: 'Every unit with a checklist in a project, progress and next stage' })
  getProjectRollup(@Query('projectId') projectId: string) {
    return this.service.getProjectRollup(projectId);
  }
}
