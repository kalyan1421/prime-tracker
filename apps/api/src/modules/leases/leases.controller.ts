import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors,
  UploadedFile, BadRequestException, StreamableFile, Header,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { LeasesService } from './leases.service';
import { LeaseImportService, ImportCommitRowInput } from './lease-import.service';
import type { ConfirmedMapping } from '../../common/utils/xlsx-mapping';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index';
import { CreateLeaseDto, UpdateLeaseDto } from './dto/create-lease.dto';
import { EndTenancyDto } from './dto/end-tenancy.dto';
import { AssignTenantDto } from './dto/assign-tenant.dto';
import { BackfillTenancyDto } from './dto/backfill-tenancy.dto';
import { RequestHistoricalDeletionDto } from '../../common/dto/historical-deletion.dto';
import { LeaseRentPeriodService } from './lease-rent-period.service';
import { LeaseObligationService } from './lease-obligation.service';
import { LeaseRentInvoiceService } from './lease-rent-invoice.service';
import {
  AddManualRentPeriodDto,
  CorrectRentPeriodDto,
  GenerateRentPeriodsDto,
  RegenerateFutureRentPeriodsDto,
} from './dto/rent-period.dto';
import {
  GenerateRentInvoicesDto,
  RecordRentPaymentDto,
  WaiveRentInvoiceDto,
} from './dto/rent-invoice.dto';
import {
  CreateLeaseObligationDto,
  RecordObligationPaymentDto,
  UpdateLeaseObligationDto,
  WaiveLeaseObligationDto,
} from './dto/lease-obligation.dto';

@ApiTags('Leases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('leases')
export class LeasesController {
  constructor(
    private service: LeasesService,
    private rentPeriods: LeaseRentPeriodService,
    private obligations: LeaseObligationService,
    private rentInvoices: LeaseRentInvoiceService,
    private importService: LeaseImportService,
  ) {}

  @Get()
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'List leases by project' })
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get('rent-roll')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Active leases rent roll with total monthly rent' })
  getRentRoll(@Query('projectId') projectId: string) { return this.service.getRentRoll(projectId); }

  // ───────────────────────────────────────────────────────────────────────────
  // Obligation ledger — deposits + TI allowances.
  //
  // These are keyed by obligation/payment/unit/building id, NOT by lease id, so
  // they sit here above `@Get(':id')` alongside the `rent-roll` precedent. Nest
  // matches in declaration order and `:id` binds exactly one segment, so these
  // two-segment paths could not be shadowed by it — declaring them first is
  // belt-and-braces against someone later adding a single-segment route.
  // ───────────────────────────────────────────────────────────────────────────

  @Get('obligation-summary/unit/:unitId')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Deposit/TI rollup for leases attached directly to a unit' })
  obligationSummaryForUnit(@Param('unitId') unitId: string) { return this.obligations.summaryForUnit(unitId); }

  @Get('obligation-summary/building/:buildingId')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Deposit/TI rollup for a building (building-level and unit-level split)' })
  obligationSummaryForBuilding(@Param('buildingId') buildingId: string) { return this.obligations.summaryForBuilding(buildingId); }

  @Put('obligations/:obligationId')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Update an obligation (kind is immutable)' })
  updateObligation(@Param('obligationId') obligationId: string, @Body() body: UpdateLeaseObligationDto) {
    return this.obligations.update(obligationId, body);
  }

  @Delete('obligations/:obligationId')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Delete an obligation and its payments' })
  removeObligation(@Param('obligationId') obligationId: string) { return this.obligations.remove(obligationId); }

  @Post('obligations/:obligationId/waive')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Waive an obligation (reason required; payments are kept)' })
  waiveObligation(@Param('obligationId') obligationId: string, @Body() body: WaiveLeaseObligationDto) {
    return this.obligations.waive(obligationId, body.reason);
  }

  @Post('obligations/:obligationId/payments')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Record a payment against an obligation' })
  recordObligationPayment(
    @Param('obligationId') obligationId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: RecordObligationPaymentDto,
  ) {
    return this.obligations.recordPayment(obligationId, { ...body, recordedById: userId });
  }

  @Delete('obligation-payments/:paymentId')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Delete an obligation payment and re-derive the paid mirror' })
  deleteObligationPayment(@Param('paymentId') paymentId: string) { return this.obligations.deletePayment(paymentId); }

  // ── Rent invoices (monthly collection ledger) ──────────────────────────────
  // Multi-segment paths, so they cannot collide with the single-segment `:id`
  // routes — but declared above them anyway, matching the rent-roll precedent.
  //
  // Reads use lease:view; writes use rent:collect, NOT lease:edit — an AR/AP clerk
  // must be able to record rent received without also being able to rewrite the
  // lease terms.

  @Get('rent-invoices/unit/:unitId')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Rent invoices across every lease on a unit (one continuous timeline)' })
  rentInvoicesByUnit(@Param('unitId') unitId: string) { return this.rentInvoices.findByUnit(unitId); }

  @Patch('rent-invoices/:invoiceId/payment')
  @RequirePermissions('rent:collect')
  @ApiOperation({ summary: 'Record rent received against an invoice' })
  recordRentPayment(
    @Param('invoiceId') invoiceId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: RecordRentPaymentDto,
  ) {
    return this.rentInvoices.recordPayment(invoiceId, { ...body, recordedById: userId });
  }

  @Delete('rent-invoices/:invoiceId/payment')
  @RequirePermissions('rent:collect')
  @ApiOperation({ summary: 'Clear a mis-keyed rent payment and re-derive status' })
  clearRentPayment(@Param('invoiceId') invoiceId: string) { return this.rentInvoices.clearPayment(invoiceId); }

  @Post('rent-invoices/:invoiceId/waive')
  @RequirePermissions('rent:collect')
  @ApiOperation({ summary: 'Waive a month of rent (reason required)' })
  waiveRentInvoice(@Param('invoiceId') invoiceId: string, @Body() body: WaiveRentInvoiceDto) {
    return this.rentInvoices.waive(invoiceId, body.reason);
  }

  @Patch('rent-periods/:periodId/correct')
  // NOT lease:edit. Editing future terms and rewriting a figure a tenant was already
  // invoiced for are different powers — this is the only route in the system that can
  // change a number already sent out. No role is granted it EXPLICITLY; Founder and
  // Super Admin hold it only through their blanket grants, so until Prime assigns it the
  // set of people who can correct billed rent is exactly the set who already own the
  // whole book.
  @RequirePermissions('lease:history:correct')
  @ApiOperation({
    summary: 'Correct a rent period that has already been billed (reason required)',
    description:
      'Use this only when the period was RECORDED wrong. If the rent genuinely changed '
      + 'from a date, append a manual period instead — that is an event, not a correction. '
      + 'The previous value is preserved, and any invoice already generated from this '
      + 'period is flagged for Finance rather than silently restated.',
  })
  correctRentPeriod(
    @Param('periodId') periodId: string,
    @Body() body: CorrectRentPeriodDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.rentPeriods.correctPeriod(periodId, { ...body, correctedById: userId });
  }

  @Post('rent-invoices/:invoiceId/clear-review')
  // rent:collect, not the correction permission: acknowledging a flagged invoice is a
  // collections act, and the person who reconciles the ledger is not the person who
  // corrects the schedule.
  @RequirePermissions('rent:collect')
  @ApiOperation({
    summary: 'Mark a flagged invoice as reviewed',
    description:
      'Records that somebody looked. Deliberately does not change amountDue — re-issue, '
      + 'credit or leave-it stays a Finance decision made with the normal tools.',
  })
  clearInvoiceReview(@Param('invoiceId') invoiceId: string) {
    return this.rentPeriods.clearInvoiceReview(invoiceId);
  }

  @Get(':id')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Get lease by ID' })
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Get(':id/rent-invoices')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Monthly rent invoices for one lease' })
  rentInvoices_(@Param('id') id: string) { return this.rentInvoices.findByLease(id); }

  @Get(':id/rent-invoice-summary')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Billed / collected / outstanding / overdue for one lease' })
  rentInvoiceSummary(@Param('id') id: string) { return this.rentInvoices.summaryForLease(id); }

  @Post(':id/rent-invoices/generate')
  @RequirePermissions('rent:collect')
  @ApiOperation({ summary: 'Generate or backfill monthly invoices from the rent schedule' })
  generateRentInvoices(@Param('id') id: string, @Body() body: GenerateRentInvoicesDto) {
    return this.rentInvoices.generateForLease(id, {
      through: body.through ? new Date(body.through) : undefined,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rent timeline — escalation schedule, rent history and free-rent months.
  // ───────────────────────────────────────────────────────────────────────────

  @Get(':id/rent-periods')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Rent periods for a lease, in timeline order' })
  findRentPeriods(@Param('id') id: string) { return this.rentPeriods.findByLease(id); }

  @Get(':id/rent-summary')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Straight-lined effective rent plus the first paying month' })
  async getRentSummary(@Param('id') id: string) {
    const [summary, firstPayingMonth] = await Promise.all([
      this.rentPeriods.getEffectiveRent(id),
      this.rentPeriods.getFirstPayingMonth(id),
    ]);
    return { ...summary, firstPayingMonth };
  }

  @Post(':id/rent-periods/generate')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Generate the rent timeline from the lease terms (idempotent unless force)' })
  generateRentPeriods(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: GenerateRentPeriodsDto,
  ) {
    return this.rentPeriods.generateForLease(id, { ...body, createdById: userId });
  }

  @Post(':id/rent-periods/regenerate-future')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Rewrite only periods starting in the future; past periods stay frozen' })
  regenerateFutureRentPeriods(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: RegenerateFutureRentPeriodsDto,
  ) {
    return this.rentPeriods.regenerateFuture(id, userId, body);
  }

  @Post(':id/rent-periods/manual')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Append a manual mid-term rent period (reason required)' })
  addManualRentPeriod(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() body: AddManualRentPeriodDto,
  ) {
    // startDate/endDate stay strings: addManualPeriod runs them through
    // `startOfUtcDay(new Date(...))` itself, so Prisma never sees a bare
    // 'YYYY-MM-DD'. Same for the obligation dueDate/paidAt below (service `toDate`).
    return this.rentPeriods.addManualPeriod({ leaseId: id, ...body, createdById: userId });
  }

  @Get(':id/rent-corrections')
  @RequirePermissions('lease:view')
  @ApiOperation({
    summary: 'Every correction made to this lease\'s billed rent periods, newest first',
  })
  rentCorrections(@Param('id') id: string) {
    return this.rentPeriods.findCorrections(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Obligations on a lease. (Mutations keyed by obligation id are declared above.)
  // ───────────────────────────────────────────────────────────────────────────

  @Get(':id/obligations')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'Obligations on a lease, each with its payments' })
  findObligations(@Param('id') id: string) { return this.obligations.findByLease(id); }

  @Post(':id/obligations')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Create a deposit / TI allowance / other obligation on a lease' })
  createObligation(@Param('id') id: string, @Body() body: CreateLeaseObligationDto) {
    return this.obligations.create({ leaseId: id, ...body });
  }

  @Post()
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Create lease' })
  // userId is stamped onto the rent periods the service generates for this lease.
  create(@Body() body: CreateLeaseDto, @CurrentUser('sub') userId: string) {
    // termMonths is optional on the DTO (the service derives it from the dates) but
    // required by Prisma. The cast is safe because normaliseTermAndNnn always sets it
    // before the create — a 0 here would be overwritten, not persisted.
    return this.service.create(body as unknown as Prisma.LeaseUncheckedCreateInput, userId);
  }

  @Put(':id')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Update lease' })
  // Changing rent/escalation/free-rent terms re-derives the FUTURE rent periods;
  // userId is stamped onto the regenerated rows.
  update(@Param('id') id: string, @Body() body: UpdateLeaseDto, @CurrentUser('sub') userId: string) {
    return this.service.update(id, body, userId);
  }

  @Post(':id/end-tenancy')
  @RequirePermissions('lease:edit')
  @ApiOperation({
    summary: 'End a tenancy — records the move-out, caps the ledger and releases the unit',
    description:
      'One action behind turnover, renewal and relocation. Caps the rent schedule at the ' +
      'move-out date, voids unpaid invoices billed after it, records the deposit decision, ' +
      'and — unless a successor lease continues on the same unit — releases the unit and ' +
      'writes its occupancy event. Refuses if rent has already been collected past the date.',
  })
  endTenancy(
    @Param('id') id: string,
    @Body() body: EndTenancyDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.endTenancy(id, body, userId);
  }

  @Post('backfill')
  @RequirePermissions('unit:history:backfill')
  @ApiOperation({
    summary: 'Enter a tenancy that has already ended (historical backfill)',
    description:
      'Creates the lease, its rent schedule and its COMPLETE invoice ledger in one call, '
      + 'defaulting every month to paid so a historical tenancy never shows as overdue AR. '
      + 'Backdates two occupancy events. Deliberately does NOT change the unit\'s current '
      + 'status — entering an old tenant must not change who the system thinks is in the '
      + 'unit today. Refuses a move-out date in the future: that is a live lease.',
  })
  backfillTenancy(@Body() body: BackfillTenancyDto, @CurrentUser('sub') userId: string) {
    return this.service.backfillTenancy(body, userId);
  }

  // ─────── Bulk rent history import (R1/R2/R8) ───────
  // Portfolio-wide, template-based — see docs/client-discovery/HISTORICAL_DATA_SHEET_IMPORT_SPEC.md.
  // Deliberately three separate steps: nothing is written until the user has SEEN a
  // preview and explicitly confirmed it (the safeguard that made reopening "no CSV" for
  // bulk loads safe in the first place).

  @Get('backfill/template')
  @RequirePermissions('unit:history:backfill')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="rent-history-import-template.xlsx"')
  @ApiOperation({ summary: 'Download the rent-history import template (Tenancies / Ledger Exceptions / Commission Installments)' })
  async downloadImportTemplate(): Promise<StreamableFile> {
    const buffer = await this.importService.buildTemplate();
    return new StreamableFile(buffer);
  }

  @Post('backfill/import/preview')
  @RequirePermissions('unit:history:backfill')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse and validate an uploaded rent-history file — no writes' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async previewImport(@UploadedFile() file: Express.Multer.File, @Body('projectId') projectId: string) {
    if (!file) throw new BadRequestException('No file was received');
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.importService.previewImport(file.buffer, projectId);
  }

  @Post('backfill/import/commit')
  @RequirePermissions('unit:history:backfill')
  @ApiOperation({ summary: 'Commit previously-previewed rent-history rows — one backfillTenancy() per row' })
  commitImport(@Body('rows') rows: ImportCommitRowInput[], @CurrentUser('sub') userId: string) {
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('No rows to import');
    return this.importService.commitImport(rows, userId);
  }

  // ─────── Generic column-mapping import (R9) ───────
  // For the client's OWN spreadsheet, any layout — no template required. Structural
  // analysis first (no DB writes, no validation) so the frontend can show a mapping
  // screen with suggested fields already filled in; the user confirms the mapping, then
  // preview-mapped runs the SAME validation backfill/import/preview already runs.

  @Post('backfill/import/analyze')
  @RequirePermissions('unit:history:backfill')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Detect orientation and suggest a field mapping for an arbitrary uploaded spreadsheet — no writes, no validation' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async analyzeGenericImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file was received');
    return this.importService.analyzeGenericFile(file.buffer);
  }

  @Post('backfill/import/preview-mapped')
  @RequirePermissions('unit:history:backfill')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse and validate an arbitrary spreadsheet using a user-confirmed column mapping — no writes' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async previewMappedImport(
    @UploadedFile() file: Express.Multer.File,
    @Body('projectId') projectId: string,
    @Body('mapping') mappingRaw: string,
    @Body('defaultBrokerId') defaultBrokerId?: string,
    @Body('rowBrokerOverrides') rowBrokerOverridesRaw?: string,
  ) {
    if (!file) throw new BadRequestException('No file was received');
    if (!projectId) throw new BadRequestException('projectId is required');
    let mapping: ConfirmedMapping;
    try {
      mapping = typeof mappingRaw === 'string' ? JSON.parse(mappingRaw) : (mappingRaw as unknown as ConfirmedMapping);
    } catch {
      throw new BadRequestException('mapping must be valid JSON');
    }
    if (!mapping?.columns?.length) throw new BadRequestException('mapping.columns must be a non-empty array');
    if (mapping.orientation !== 'rows' && mapping.orientation !== 'columns') {
      throw new BadRequestException('mapping.orientation must be "rows" or "columns"');
    }
    let rowBrokerOverrides: Record<number, string> | undefined;
    if (rowBrokerOverridesRaw) {
      try {
        rowBrokerOverrides = JSON.parse(rowBrokerOverridesRaw);
      } catch {
        throw new BadRequestException('rowBrokerOverrides must be valid JSON');
      }
    }
    return this.importService.previewMappedImport(file.buffer, projectId, mapping, defaultBrokerId || undefined, rowBrokerOverrides);
  }

  @Get(':id/assignments')
  @RequirePermissions('lease:view')
  @ApiOperation({ summary: 'The tenant-assignment chain for a lease, oldest first' })
  assignments(@Param('id') id: string) { return this.service.findAssignments(id); }

  @Post(':id/assign-tenant')
  @RequirePermissions('lease:edit')
  @ApiOperation({
    summary: 'Assign the lease to a new tenant (novation) — the lease document survives',
    description:
      'For a business sale or entity restructure, where a new party steps into the ' +
      'existing contract. The rent schedule, invoice ledger, obligations and unit status ' +
      'are all left untouched — that is the definition of an assignment. Use end-tenancy ' +
      'instead when the tenancy itself ends and a new lease begins.',
  })
  assignTenant(
    @Param('id') id: string,
    @Body() body: AssignTenantDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.assignTenant(id, body, userId);
  }

  @Post(':id/request-deletion')
  @RequirePermissions('unit:history:backfill')
  @ApiOperation({
    summary: 'Ask a Founder to approve deleting a backfilled tenancy',
    description:
      'Only for historical records. A backfilled tenancy carries a ledger somebody typed '
      + 'in from paper records the system never witnessed — deleting it destroys data '
      + 'nothing can regenerate, so it takes a second person. A live lease needs no '
      + 'request: its schedule can always be rebuilt from its own terms.',
  })
  requestHistoricalDeletion(
    @Param('id') id: string,
    @Body() body: RequestHistoricalDeletionDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.requestHistoricalDeletion(id, body.reason, userId);
  }

  @Delete(':id')
  @RequirePermissions('lease:edit')
  @ApiOperation({
    summary: 'Delete lease',
    description:
      'A historical (backfilled) lease additionally needs approval. A `unit:history:delete` '
      + 'holder IS the approver, so they delete directly and it is recorded as '
      + 'self-approved; everyone else goes through POST /leases/:id/request-deletion.',
  })
  delete(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    // The caller's own permission, not a role check — the approval bar is a permission
    // everywhere else in this flow and must not drift into a second definition here.
    @CurrentUser('permissions') permissions: string[] = [],
  ) {
    return this.service.delete(id, userId, (permissions ?? []).includes('unit:history:delete'));
  }
}
