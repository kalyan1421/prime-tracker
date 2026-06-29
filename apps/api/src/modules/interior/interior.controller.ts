import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { InteriorContractType, InteriorPhase, InteriorStatus } from '@prisma/client';
import { InteriorService } from './interior.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';

@ApiTags('Interior')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('interior')
export class InteriorController {
  constructor(private service: InteriorService) {}

  @Get('portfolio')
  @RequirePermissions('interior:view')
  @ApiOperation({ summary: 'Cross-project interior portfolio (phase, budget vs actual, days-to-handover)' })
  portfolio() {
    return this.service.portfolio();
  }

  // ─────── Package templates (must precede ':id' routes) ───────

  @Get('templates')
  @RequirePermissions('interior:view')
  @ApiOperation({ summary: 'List reusable fit-out package templates' })
  listTemplates() {
    return this.service.listPackageTemplates();
  }

  @Post('templates')
  @RequirePermissions('interior:edit')
  @ApiOperation({ summary: 'Create a package template (name + preset BOQ items)' })
  createTemplate(
    @Body() body: {
      name: string;
      description?: string;
      defaultRatePerSqft?: number;
      items?: Array<{ description: string; category?: string; quantity?: number; unit?: string; unitPrice?: number }>;
    },
  ) {
    return this.service.createPackageTemplate(body);
  }

  @Patch('templates/:tid')
  @RequirePermissions('interior:edit')
  @ApiOperation({ summary: 'Update package template name/description/rate' })
  updateTemplate(
    @Param('tid') tid: string,
    @Body() body: { name?: string; description?: string; defaultRatePerSqft?: number | null },
  ) {
    return this.service.updatePackageTemplate(tid, body);
  }

  @Delete('templates/:tid')
  @RequirePermissions('interior:edit')
  removeTemplate(@Param('tid') tid: string) {
    return this.service.removePackageTemplate(tid);
  }

  @Get()
  @RequirePermissions('interior:view')
  @ApiOperation({ summary: 'List interior projects (filter by unit/building/status)' })
  findAll(
    @Query('unitId') unitId?: string,
    @Query('buildingId') buildingId?: string,
    @Query('status') status?: InteriorStatus,
  ) {
    return this.service.findAll({ unitId, buildingId, status });
  }

  @Get(':id')
  @RequirePermissions('interior:view')
  @ApiOperation({ summary: 'Get one interior project with scope, snags, invoices, documents' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @RequirePermissions('interior:edit')
  @ApiOperation({ summary: 'Create an interior project (per-sqft contract; anchor to unit OR building)' })
  create(
    @Body() body: {
      unitId?: string;
      buildingId?: string;
      saleId?: string;
      leaseId?: string;
      name: string;
      pmId?: string;
      contractType?: InteriorContractType;
      ratePerSqft?: number;
      area?: number;
      contractValue?: number;
      packageTemplateId?: string;
      startDate?: string;
      targetEnd?: string;
    },
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  @RequirePermissions('interior:edit')
  update(
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      status?: InteriorStatus;
      pmId?: string;
      contractType?: InteriorContractType;
      ratePerSqft?: number;
      area?: number;
      contractValue?: number;
      startDate?: string;
      targetEnd?: string;
    },
  ) {
    return this.service.update(id, body);
  }

  @Post(':id/advance')
  @RequirePermissions('interior:edit')
  @ApiOperation({ summary: 'Advance to the next phase (enforces shell + document gates)' })
  advance(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { target: InteriorPhase; handoverSignedBy?: string; handoverNotes?: string },
  ) {
    return this.service.advancePhase(id, body.target, userId, {
      handoverSignedBy: body.handoverSignedBy,
      handoverNotes: body.handoverNotes,
    });
  }

  @Post(':id/approve-client')
  @RequirePermissions('interior:approve')
  approveClient(@Param('id') id: string) {
    return this.service.approveClient(id);
  }

  @Post(':id/approve-city')
  @RequirePermissions('interior:approve')
  approveCity(@Param('id') id: string) {
    return this.service.approveCity(id);
  }

  @Delete(':id')
  @RequirePermissions('interior:edit')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // ─────── Scope (BOQ) ───────

  @Post(':id/scope')
  @RequirePermissions('interior:edit')
  addScope(
    @Param('id') id: string,
    @Body() body: { description: string; category?: string; quantity?: number; unit?: string; unitPrice?: number },
  ) {
    return this.service.addScopeItem(id, body);
  }

  @Delete('scope/:itemId')
  @RequirePermissions('interior:edit')
  removeScope(@Param('itemId') itemId: string) {
    return this.service.removeScopeItem(itemId);
  }

  // ─────── Sub-contractor invoices ───────

  @Post(':id/invoices')
  @RequirePermissions('interior:finance')
  addInvoice(
    @Param('id') id: string,
    @Body() body: { vendorId: string; amount: number; invoiceNo?: string; invoiceDate?: string },
  ) {
    return this.service.addInvoice(id, body);
  }

  // ─────── Snags (punch list) ───────

  @Post(':id/snags')
  @RequirePermissions('interior:edit')
  addSnag(
    @Param('id') id: string,
    @Body() body: { description: string; room?: string; assigneeId?: string; dueDate?: string; photoPath?: string },
  ) {
    return this.service.addSnag(id, body);
  }

  @Post('snags/:snagId/resolve')
  @RequirePermissions('interior:edit')
  resolveSnag(@Param('snagId') snagId: string) {
    return this.service.resolveSnag(snagId);
  }

  @Patch('snags/:snagId')
  @RequirePermissions('interior:edit')
  @ApiOperation({ summary: 'Update snag status, description, room, or assignee' })
  updateSnag(
    @Param('snagId') snagId: string,
    @Body() body: { status?: string; description?: string; room?: string; assigneeId?: string },
  ) {
    return this.service.updateSnag(snagId, body);
  }
}
