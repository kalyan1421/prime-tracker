import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors,
  UploadedFile, BadRequestException, StreamableFile, Header,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { SalesForecastService } from './sales-forecast.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { BackfillSaleDto } from './dto/backfill-sale.dto';
import { SettleSaleCancellationDto } from './dto/sale-cancellation.dto';
import { TransferSaleUnitDto } from './dto/transfer-sale-unit.dto';
import { UserRole, SalePaymentTrigger } from '@prisma/client';
import { SalePaymentsService, PAYMENT_TEMPLATES } from './sale-payments.service';
import { SaleUnitTransferService } from './sale-unit-transfer.service';
import { SaleImportService } from './sale-import.service';
import { RequestHistoricalDeletionDto } from '../../common/dto/historical-deletion.dto';

@ApiTags('Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('sales')
export class SalesController {
  constructor(
    private service: SalesService,
    private forecast: SalesForecastService,
    private salePayments: SalePaymentsService,
    private unitTransfers: SaleUnitTransferService,
    private importService: SaleImportService,
  ) {}

  /** GET /api/sales/forecast?projectId=:id — probability-weighted pipeline forecast */
  @Get('forecast')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Probability-weighted pipeline forecast for a project' })
  getForecast(@Query('projectId') projectId: string) {
    return this.forecast.forProject(projectId);
  }

  @Get()
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'List sales by project' })
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get('pipeline')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Sales pipeline grouped by status with velocity metrics' })
  getPipeline(@Query('projectId') projectId: string) { return this.service.getPipeline(projectId); }

  /** GET /api/sales/receivables?weeks=4 — upcoming + overdue installments (cashflow inflows). */
  @Get('receivables')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Upcoming + overdue sale-payment receivables (Finance widget / cashflow inflows)' })
  receivables(@Query('weeks') weeks?: string) {
    return this.salePayments.receivables(weeks ? Number(weeks) : 4);
  }

  @Get(':id')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Get sale by ID' })
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('sales:edit')
  @ApiOperation({ summary: 'Create sale (validates unit belongs to project)' })
  // The user id is threaded through so a sale created already-CLOSED stamps its
  // occupancy event with who did it, exactly as closing one through update() does.
  create(@Body() body: CreateSaleDto, @CurrentUser('sub') userId: string) {
    return this.service.create(body as any, userId);
  }

  /**
   * POST /api/sales/backfill — a sale that already closed, entered by hand (R4). The
   * sale-side counterpart of POST /leases/backfill (H2) — same permission, same "this
   * already happened" framing, no discount/document gates because those govern a deal
   * that is about to happen, not one being typed in from records.
   */
  @Post('backfill')
  @RequirePermissions('unit:history:backfill')
  @ApiOperation({ summary: 'Enter a sale that has already closed (historical backfill)' })
  backfillSale(@Body() body: BackfillSaleDto, @CurrentUser('sub') userId: string) {
    return this.service.backfillSale(body, userId);
  }

  // ─────── Bulk sale history import (R5) ───────
  // Same template/preview/commit shape as the rent-history importer (R1/R2) — see
  // docs/client-discovery/HISTORICAL_DATA_SHEET_IMPORT_SPEC.md.

  @Get('backfill/template')
  @RequirePermissions('unit:history:backfill')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="sale-history-import-template.xlsx"')
  @ApiOperation({ summary: 'Download the sale-history import template (Sales / Commission Installments)' })
  async downloadImportTemplate(): Promise<StreamableFile> {
    const buffer = await this.importService.buildTemplate();
    return new StreamableFile(buffer);
  }

  @Post('backfill/import/preview')
  @RequirePermissions('unit:history:backfill')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse and validate an uploaded sale-history file — no writes' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async previewImport(@UploadedFile() file: Express.Multer.File, @Body('projectId') projectId: string) {
    if (!file) throw new BadRequestException('No file was received');
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.importService.previewImport(file.buffer, projectId);
  }

  @Post('backfill/import/commit')
  @RequirePermissions('unit:history:backfill')
  @ApiOperation({ summary: 'Commit previously-previewed sale-history rows — one backfillSale() per row' })
  commitImport(@Body('rows') rows: any[], @CurrentUser('sub') userId: string) {
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('No rows to import');
    return this.importService.commitImport(rows, userId);
  }

  @Put(':id')
  @RequirePermissions('sales:edit')
  @ApiOperation({
    summary:
      'Update sale (atomically updates unit status on CLOSED; on CANCELLED also records ' +
      'the refund/penalty ledger and voids the unpaid schedule)',
  })
  update(
    @Param('id') id: string,
    @Body() body: UpdateSaleDto,
    @CurrentUser('sub') userId?: string,
  ) {
    // The cancellation fields are split out here rather than passed through: none of them
    // is a column on Sale, so leaving them in the body would hand Prisma unknown fields.
    // They are on the DTO because ValidationPipe runs forbidNonWhitelisted — an undeclared
    // field 400s the entire cancellation, which is why the modal stopped sending them.
    const {
      cancellationDisposition,
      refundAmount,
      penaltyAmount,
      refundPaidAt,
      refundReference,
      cancellationNote,
      ...saleFields
    } = body;
    return this.service.update(id, saleFields as any, userId, {
      disposition: cancellationDisposition,
      refundAmount,
      penaltyAmount,
      refundPaidAt,
      refundReference,
      note: cancellationNote,
    });
  }

  /** GET /api/sales/:id/cancellation — what became of the money on a cancelled sale. */
  @Get(':id/cancellation')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Refund/penalty ledger for a cancelled sale (null if none)' })
  getCancellation(@Param('id') id: string) {
    return this.service.getCancellation(id);
  }

  /**
   * POST /api/sales/:id/cancellation/settle — Finance decides a DECIDE_LATER after the
   * fact, or stamps the reference once the refund has actually cleared. Gated on
   * payment:log (Finance / Accounting / AR-AP), not sales:edit: this is the money
   * decision the cancel dialog deliberately lets Sales defer.
   */
  @Post(':id/cancellation/settle')
  @RequirePermissions('payment:log')
  @ApiOperation({ summary: 'Settle a DECIDE_LATER cancellation, or record the refund payment' })
  settleCancellation(@Param('id') id: string, @Body() body: SettleSaleCancellationDto) {
    return this.service.settleCancellation(id, body);
  }

  @Delete(':id')
  @RequirePermissions('sales:edit')
  @ApiOperation({
    summary: 'Delete sale',
    description:
      'Live CLOSED sales require Founder/SuperAdmin role. A historical (backfilled) sale '
      + 'additionally needs approval — a `unit:history:delete` holder IS the approver, so '
      + 'they delete directly and it is recorded as self-approved; everyone else goes '
      + 'through POST /sales/:id/request-deletion.',
  })
  delete(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') userRole: UserRole,
    @CurrentUser('permissions') permissions: string[] = [],
  ) {
    return this.service.delete(id, userId, userRole, (permissions ?? []).includes('unit:history:delete'));
  }

  @Post(':id/request-deletion')
  @RequirePermissions('unit:history:backfill')
  @ApiOperation({
    summary: 'Ask a Founder to approve deleting a backfilled sale',
    description:
      'Only for historical records. A backfilled sale carries a deal (price, deposit, '
      + 'commission) somebody typed in from records the system never witnessed — deleting '
      + 'it destroys data nothing can regenerate, so it takes a second person. A live sale '
      + 'needs no request.',
  })
  requestHistoricalDeletion(
    @Param('id') id: string,
    @Body() body: RequestHistoricalDeletionDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.requestHistoricalDeletion(id, body.reason, userId);
  }

  // ─────── Unit swap mid-contract (S3) ───────

  /**
   * POST /api/sales/:id/transfer-unit — the buyer switched units after signing.
   *
   * The whole deal carries: buyer, documents and broker untouched, the installment
   * schedule rebased onto the new price, the discount approval carried only if the
   * concession did not grow. Gated on sales:edit, the same permission that moves a
   * sale's stage — this is a sales-desk act, not a Finance one, and the money decisions
   * it surfaces (flagged installments) are handed to Finance rather than made here.
   */
  @Post(':id/transfer-unit')
  @RequirePermissions('sales:edit')
  @ApiOperation({
    summary:
      'Transfer a live sale to a different unit (carries payments, broker and — ' +
      'conditionally — the discount approval; releases the old unit)',
  })
  transferUnit(
    @Param('id') id: string,
    @Body() body: TransferSaleUnitDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.unitTransfers.transferUnit(id, body, userId);
  }

  /** GET /api/sales/:id/unit-transfers — every unit this sale has moved between. */
  @Get(':id/unit-transfers')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Unit-transfer history for a sale, oldest first' })
  listUnitTransfers(@Param('id') id: string) {
    return this.unitTransfers.findBySale(id);
  }

  @Post(':id/approve-discount')
  @RequirePermissions('sales:approve-discount')
  @ApiOperation({ summary: 'Founder/Co-Founder sign-off on an over-threshold discount' })
  approveDiscount(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.service.approveDiscount(id, userId);
  }

  // ─────── Sale Payment Schedule (installments) ───────

  @Get(':saleId/payments')
  @RequirePermissions('sales:view')
  @ApiOperation({ summary: 'Installment schedule for a sale' })
  listPayments(@Param('saleId') saleId: string) {
    return this.salePayments.listForSale(saleId);
  }

  @Post(':saleId/payments')
  @RequirePermissions('sales:edit')
  @ApiOperation({ summary: 'Add an installment (fixed-date or milestone-triggered)' })
  addPayment(
    @Param('saleId') saleId: string,
    @Body() body: {
      label: string;
      amount?: number;
      percentOfPrice?: number;
      trigger?: SalePaymentTrigger;
      dueDate?: string;
      milestoneId?: string;
      interiorProjectId?: string;
      sequence?: number;
      notes?: string;
    },
  ) {
    return this.salePayments.addPayment(saleId, body);
  }

  @Post(':saleId/payments/from-template')
  @RequirePermissions('sales:edit')
  @ApiOperation({ summary: 'Seed a schedule from a standard template (e.g. 10-40-50)' })
  applyTemplate(
    @Param('saleId') saleId: string,
    @Body() body: { template: keyof typeof PAYMENT_TEMPLATES },
  ) {
    return this.salePayments.applyTemplate(saleId, body.template);
  }

  @Patch('payments/:id')
  @RequirePermissions('sales:edit')
  @ApiOperation({ summary: 'Edit an installment' })
  updatePayment(
    @Param('id') id: string,
    @Body() body: { label?: string; amount?: number; dueDate?: string; milestoneId?: string; sequence?: number; notes?: string },
  ) {
    return this.salePayments.updatePayment(id, body);
  }

  @Post('payments/:id/log')
  @RequirePermissions('payment:log')
  @ApiOperation({ summary: 'Log a (partial) payment against an installment' })
  logPayment(@Param('id') id: string, @Body() body: { amount: number }) {
    return this.salePayments.logPayment(id, body.amount);
  }

  @Delete('payments/:id')
  @RequirePermissions('sales:edit')
  @ApiOperation({ summary: 'Remove an installment' })
  removePayment(@Param('id') id: string) {
    return this.salePayments.removePayment(id);
  }
}
