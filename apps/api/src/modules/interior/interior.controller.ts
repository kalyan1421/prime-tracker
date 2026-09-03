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
import { AddScopeItemDto, AddInteriorInvoiceDto, UpdateInteriorInvoiceDto } from './dto/scope-invoice.dto';
import { CreateSnagDto, UpdateSnagDto, ResolveSnagDto } from './dto/snag.dto';

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
  portfolio(@CurrentUser('permissions') permissions?: string[]) {
    return this.service.portfolio(permissions ?? []);
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
    @Body() body: {
      name?: string;
      description?: string;
      defaultRatePerSqft?: number | null;
      /** Supplying this REPLACES the template's line list; omit it to leave lines alone. */
      items?: Array<{ description: string; category?: string; quantity?: number; unit?: string; unitPrice?: number }>;
    },
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
  @ApiOperation({ summary: 'List interior projects (filter by unit / building / project / status)' })
  findAll(
    @Query('unitId') unitId?: string,
    @Query('buildingId') buildingId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: InteriorStatus,
    @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.service.findAll({ unitId, buildingId, projectId, status }, permissions ?? []);
  }

  @Get(':id')
  @RequirePermissions('interior:view')
  @ApiOperation({ summary: 'Get one interior project with scope, snags, invoices, documents' })
  findOne(@Param('id') id: string, @CurrentUser('permissions') permissions?: string[]) {
    return this.service.findById(id, permissions ?? []);
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
  @ApiOperation({
    summary: 'Advance to the next phase (enforces shell, document and open-snag gates)',
    description:
      'HANDOVER is blocked while any punch-list item is OPEN or IN_PROGRESS. To hand over ' +
      'anyway send force: true with a forceReason — the reason is stamped onto handoverNotes ' +
      'and the request is captured in the audit log.',
  })
  advance(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: {
      target: InteriorPhase;
      handoverSignedBy?: string;
      handoverNotes?: string;
      force?: boolean;
      forceReason?: string;
    },
  ) {
    return this.service.advancePhase(id, body.target, userId, {
      handoverSignedBy: body.handoverSignedBy,
      handoverNotes: body.handoverNotes,
      force: body.force,
      forceReason: body.forceReason,
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
    @Body() body: AddScopeItemDto,
  ) {
    return this.service.addScopeItem(id, body);
  }

  // Nested under ':id' so ProjectAccessGuard can resolve the owning project from the
  // interior project (CONTROLLER_ID_ENTITY maps this controller's ':id' to 'interior').
  // A bare '/scope/:itemId' carried no key the guard could resolve, so it ran with no
  // project scoping at all — and the web app was calling this shape anyway, against a
  // route that did not exist, so every delete 404'd.
  @Delete(':id/scope/:itemId')
  @RequirePermissions('interior:edit')
  removeScope(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.removeScopeItem(id, itemId);
  }

  // ─────── Sub-contractor invoices ───────

  @Post(':id/invoices')
  @RequirePermissions('interior:finance')
  addInvoice(
    @Param('id') id: string,
    @Body() body: AddInteriorInvoiceDto,
  ) {
    return this.service.addInvoice(id, body);
  }

  @Patch(':id/invoices/:invoiceId')
  @RequirePermissions('interior:finance')
  @ApiOperation({
    summary: 'Move a sub-contractor invoice through PENDING → APPROVED → PAID',
    description:
      'Approval is reversible; PAID is not — void the invoice instead, which also reverses ' +
      'the Actual that mirrors it into the TI spend figures.',
  })
  updateInvoice(
    @Param('id') _id: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: UpdateInteriorInvoiceDto,
  ) {
    return this.service.updateInvoice(invoiceId, body);
  }

  @Delete(':id/invoices/:invoiceId')
  @RequirePermissions('interior:finance')
  @ApiOperation({ summary: 'Void an invoice and reverse its mirrored Actual' })
  removeInvoice(@Param('id') _id: string, @Param('invoiceId') invoiceId: string) {
    return this.service.removeInvoice(invoiceId);
  }

  // ─────── Snags (punch list) ───────

  @Post(':id/snags')
  @RequirePermissions('interior:edit')
  addSnag(@Param('id') id: string, @Body() body: CreateSnagDto) {
    return this.service.addSnag(id, body);
  }

  @Post('snags/:snagId/resolve')
  @RequirePermissions('interior:edit')
  @ApiOperation({
    summary: 'Resolve a snag — requires an "after" photo as proof of the fix',
    description:
      'afterPhotoPath is the storage key of the proof-of-fix image. The original photoPath ' +
      '(the "before" / defect shot) is left untouched.',
  })
  resolveSnag(@Param('snagId') snagId: string, @Body() body?: ResolveSnagDto) {
    return this.service.resolveSnag(snagId, body);
  }

  @Patch('snags/:snagId')
  @RequirePermissions('interior:edit')
  @ApiOperation({
    summary: 'Update snag status, description, room, assignee, or proof-of-fix photo',
    description:
      'Setting status=RESOLVED requires an afterPhotoPath (here or already on the record). ' +
      'Reopening a resolved snag clears its proof-of-fix photo — the re-fix needs its own.',
  })
  updateSnag(@Param('snagId') snagId: string, @Body() body: UpdateSnagDto) {
    return this.service.updateSnag(snagId, body);
  }
}
