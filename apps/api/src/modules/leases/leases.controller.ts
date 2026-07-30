import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LeasesService } from './leases.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index';
import { CreateLeaseDto, UpdateLeaseDto } from './dto/create-lease.dto';
import { LeaseRentPeriodService } from './lease-rent-period.service';
import { LeaseObligationService } from './lease-obligation.service';
import { LeaseRentInvoiceService } from './lease-rent-invoice.service';
import {
  AddManualRentPeriodDto,
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
    return this.service.create(body, userId);
  }

  @Put(':id')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Update lease' })
  // Changing rent/escalation/free-rent terms re-derives the FUTURE rent periods;
  // userId is stamped onto the regenerated rows.
  update(@Param('id') id: string, @Body() body: UpdateLeaseDto, @CurrentUser('sub') userId: string) {
    return this.service.update(id, body, userId);
  }

  @Delete(':id')
  @RequirePermissions('lease:edit')
  @ApiOperation({ summary: 'Delete lease' })
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
