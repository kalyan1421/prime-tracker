import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { InteriorContractType, InteriorPhase, InteriorStatus } from '@prisma/client';
import { InteriorService } from './interior.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, RequireAnyPermission, CurrentUser } from '../../common/decorators/index';
import { InteriorCostingService, type CostingActor } from './interior-costing.service';
import {
  EstimateLineDto, UpdateEstimateLineDto, UnlockEstimateDto, CreateChangeOrderDto, DecideChangeOrderDto,
  CreatePurchaseOrderDto, CompletePurchaseOrderDto, CostCodeDto, UpdateCostCodeDto, InteriorSettingsDto,
} from './dto/costing.dto';

/** The caller, as the costing rules see them: who, which roles, which permissions. */
const actorOf = (userId: string, role: string, roles: string[] | undefined, permissions: string[] | undefined): CostingActor =>
  ({ userId, role, roles: roles ?? [], permissions: permissions ?? [] });
import { AddScopeItemDto, AddInteriorInvoiceDto, UpdateInteriorInvoiceDto } from './dto/scope-invoice.dto';
import { CreateSnagDto, UpdateSnagDto, ResolveSnagDto } from './dto/snag.dto';

@ApiTags('Interior')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('interior')
export class InteriorController {
  constructor(
    private service: InteriorService,
    private costing: InteriorCostingService,
  ) {}

  @Get('portfolio')
  @RequirePermissions('interior:view')
  @ApiOperation({ summary: 'Cross-project interior portfolio (phase, budget vs actual, days-to-handover)' })
  async portfolio(@CurrentUser('permissions') permissions?: string[]) {
    const rows = await this.service.portfolio(permissions ?? []);
    // Job-costing totals for the board — money, so interior:finance only.
    if (!(permissions ?? []).includes('interior:finance')) return rows.map((r: any) => ({ ...r, costing: null }));
    const totals = await this.costing.portfolioTotals(rows.map((r: any) => r.id));
    return rows.map((r: any) => ({ ...r, costing: totals.get(r.id) ?? null }));
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
      startDate?: string;
      targetEnd?: string;
      extraUnitIds?: string[];
      priority?: string | null;
      plansSubmittedAt?: string | null;
      tiAllowance?: number | null;
      poPrefix?: string | null;
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
      extraUnitIds?: string[];
      priority?: string | null;
      plansSubmittedAt?: string | null;
      tiAllowance?: number | null;
      poPrefix?: string | null;
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
    @CurrentUser('sub') userId?: string,
  ) {
    return this.service.addInvoice(id, body, userId);
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
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[],
    @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.service.updateInvoice(invoiceId, body, actorOf(userId, role, roles, permissions));
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

  // ───────────── Costing (2026-10-17): estimate, budget, change orders, purchase orders ─────────────
  // Route permissions are the floor; WHO may lock, approve or unlock is decided per step by
  // OrgSettings (InteriorCostingService), which Super Admin edits.

  @Get(':id/costing')
  @RequirePermissions('interior:view')
  @ApiOperation({ summary: 'Estimate, job-costing budget, change orders, POs, bills, activity — and what the caller may do' })
  getCosting(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.costing(id, actorOf(userId, role, roles, permissions));
  }

  @Post(':id/estimate/lines')
  @RequirePermissions('interior:edit')
  addEstimateLine(@Param('id') id: string, @Body() body: EstimateLineDto) {
    return this.costing.addLine(id, body);
  }

  @Patch(':id/estimate/lines/:lineId')
  @RequirePermissions('interior:edit')
  updateEstimateLine(@Param('id') id: string, @Param('lineId') lineId: string, @Body() body: UpdateEstimateLineDto) {
    return this.costing.updateLine(id, lineId, body);
  }

  @Delete(':id/estimate/lines/:lineId')
  @RequirePermissions('interior:edit')
  removeEstimateLine(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.costing.removeLine(id, lineId);
  }

  @Post(':id/estimate/submit')
  @RequirePermissions('interior:edit')
  submitEstimate(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.submitEstimate(id, actorOf(userId, role, roles, permissions));
  }

  @Post(':id/estimate/send-back')
  @RequireAnyPermission('interior:edit', 'interior:finance')
  sendBackEstimate(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.sendBackEstimate(id, actorOf(userId, role, roles, permissions));
  }

  @Post(':id/estimate/lock')
  @RequireAnyPermission('interior:edit', 'interior:finance')
  @ApiOperation({ summary: 'Approve and lock the estimate — it becomes the original budget' })
  lockEstimate(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.lockEstimate(id, actorOf(userId, role, roles, permissions));
  }

  @Post(':id/estimate/unlock')
  @RequireAnyPermission('interior:edit', 'interior:finance')
  @ApiOperation({ summary: 'Unlock the estimate, with a reason that goes in the activity log' })
  unlockEstimate(
    @Param('id') id: string, @Body() body: UnlockEstimateDto,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.unlockEstimate(id, body.reason, actorOf(userId, role, roles, permissions));
  }

  @Post(':id/change-orders')
  @RequirePermissions('interior:edit')
  createChangeOrder(
    @Param('id') id: string, @Body() body: CreateChangeOrderDto,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.createChangeOrder(id, body, actorOf(userId, role, roles, permissions));
  }

  @Post(':id/change-orders/:coId/decide')
  @RequireAnyPermission('interior:edit', 'interior:finance')
  decideChangeOrder(
    @Param('id') id: string, @Param('coId') coId: string, @Body() body: DecideChangeOrderDto,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.decideChangeOrder(id, coId, body.decision, actorOf(userId, role, roles, permissions));
  }

  @Post(':id/purchase-orders')
  @RequirePermissions('interior:finance')
  createPurchaseOrder(
    @Param('id') id: string, @Body() body: CreatePurchaseOrderDto,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.createPurchaseOrder(id, body, actorOf(userId, role, roles, permissions));
  }

  @Post(':id/purchase-orders/:poId/send')
  @RequirePermissions('interior:finance')
  sendPurchaseOrder(
    @Param('id') id: string, @Param('poId') poId: string,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.sendPurchaseOrder(id, poId, actorOf(userId, role, roles, permissions));
  }

  @Post(':id/purchase-orders/:poId/approve')
  @RequirePermissions('interior:finance')
  approvePurchaseOrder(
    @Param('id') id: string, @Param('poId') poId: string,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.approvePurchaseOrder(id, poId, actorOf(userId, role, roles, permissions));
  }

  @Post(':id/purchase-orders/:poId/void')
  @RequirePermissions('interior:finance')
  voidPurchaseOrder(
    @Param('id') id: string, @Param('poId') poId: string,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.voidPurchaseOrder(id, poId, actorOf(userId, role, roles, permissions));
  }

  // interior:view, not finance: the site team marks the WORK complete without seeing money.
  @Post(':id/purchase-orders/:poId/complete')
  @RequirePermissions('interior:view')
  completePurchaseOrder(
    @Param('id') id: string, @Param('poId') poId: string, @Body() body: CompletePurchaseOrderDto,
    @CurrentUser('sub') userId: string, @CurrentUser('role') role: string,
    @CurrentUser('roles') roles?: string[], @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.costing.completePurchaseOrder(id, poId, body.complete, actorOf(userId, role, roles, permissions));
  }
}

/**
 * Org-wide interiors costing setup: the cost code list (BuilderTrend's) and the approval
 * rules. A separate controller with its own prefix so these static paths can never be
 * shadowed by InteriorController's `:id` routes.
 */
@ApiTags('Interior')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('interior-costing')
export class InteriorCostingController {
  constructor(private costing: InteriorCostingService) {}

  @Get('settings')
  @RequirePermissions('interior:view')
  @ApiOperation({ summary: 'Who may lock, unlock and approve, and the change order limit' })
  async getSettings(@CurrentUser('permissions') permissions?: string[]) {
    return { ...(await this.costing.settings()), canEdit: (permissions ?? []).includes('system:config') };
  }

  // system:config is SUPER_ADMIN only — the client's "option that can be set by super admin".
  @Put('settings')
  @RequirePermissions('system:config')
  updateSettings(@Body() body: InteriorSettingsDto) {
    return this.costing.updateSettings(body);
  }

  @Get('cost-codes')
  @RequirePermissions('interior:view')
  listCostCodes(@Query('includeInactive') includeInactive?: string) {
    return this.costing.listCostCodes(includeInactive === 'true');
  }

  @Post('cost-codes')
  @RequirePermissions('interior:edit')
  createCostCode(@Body() body: CostCodeDto) {
    return this.costing.createCostCode(body);
  }

  @Patch('cost-codes/:codeId')
  @RequirePermissions('interior:edit')
  updateCostCode(@Param('codeId') codeId: string, @Body() body: UpdateCostCodeDto) {
    return this.costing.updateCostCode(codeId, body);
  }
}

