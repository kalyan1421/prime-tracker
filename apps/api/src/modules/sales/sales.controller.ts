import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { SalesForecastService } from './sales-forecast.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { UserRole, SalePaymentTrigger } from '@prisma/client';
import { SalePaymentsService, PAYMENT_TEMPLATES } from './sale-payments.service';

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
  @RequirePermissions('interior:finance')
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
  create(@Body() body: CreateSaleDto) { return this.service.create(body as any); }

  @Put(':id')
  @RequirePermissions('sales:edit')
  @ApiOperation({ summary: 'Update sale (atomically updates unit status on CLOSED)' })
  update(@Param('id') id: string, @Body() body: UpdateSaleDto) { return this.service.update(id, body as any); }

  @Delete(':id')
  @RequirePermissions('sales:edit')
  @ApiOperation({ summary: 'Delete sale (CLOSED sales require Founder/SuperAdmin role)' })
  delete(@Param('id') id: string, @CurrentUser('role') userRole: UserRole) {
    return this.service.delete(id, userRole);
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
