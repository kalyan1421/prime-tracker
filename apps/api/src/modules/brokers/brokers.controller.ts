import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrokersService } from './brokers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { CreateBrokerDto, UpdateBrokerDto } from './dto/create-broker.dto';

@ApiTags('Brokers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('brokers')
export class BrokersController {
  constructor(private service: BrokersService) {}

  @Get('report')
  @RequirePermissions('broker:view')
  @ApiOperation({ summary: 'Broker performance report (leads, closed sales, value, commission, conversion)' })
  report() {
    return this.service.report();
  }

  @Get()
  @RequirePermissions('broker:view')
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermissions('broker:view')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @RequirePermissions('broker:edit')
  create(@Body() body: CreateBrokerDto) {
    return this.service.create(body);
  }

  @Patch(':id')
  @RequirePermissions('broker:edit')
  update(
    @Param('id') id: string,
    @Body() body: UpdateBrokerDto,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('broker:edit')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get(':id/sales')
  @RequirePermissions('broker:view')
  @ApiOperation({ summary: 'List sales attributed to a broker (up to 100, with unit context)' })
  getSalesByBroker(@Param('id') id: string) {
    return this.service.getSalesByBroker(id);
  }

  @Get(':id/leases')
  @RequirePermissions('broker:view')
  @ApiOperation({ summary: 'Leases attributed to a broker (leasing commission drilldown)' })
  leasesByBroker(@Param('id') id: string) {
    return this.service.getLeasesByBroker(id);
  }

  @Patch('leases/:leaseId/mark-commission-paid')
  @RequirePermissions('broker:edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a leasing commission as paid' })
  markLeaseCommissionPaid(@Param('leaseId') leaseId: string) {
    return this.service.markLeaseCommissionPaid(leaseId);
  }

  @Patch('sales/:saleId/mark-commission-paid')
  @RequirePermissions('broker:edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Settle a sale\'s broker commission in full (pays off every outstanding installment)' })
  markCommissionPaid(@Param('saleId') saleId: string) {
    return this.service.markCommissionPaid(saleId);
  }

  // ─────── Commission installments (R7) ───────

  @Get('sales/:saleId/commission-installments')
  @RequirePermissions('broker:view')
  @ApiOperation({ summary: "List a sale's broker commission installments" })
  listSaleCommissionInstallments(@Param('saleId') saleId: string) {
    return this.service.getCommissionInstallments({ saleId });
  }

  @Post('sales/:saleId/commission-installments')
  @RequirePermissions('broker:edit')
  @ApiOperation({ summary: "Record a new commission installment on a sale (e.g. a 2nd payment)" })
  addSaleCommissionInstallment(
    @Param('saleId') saleId: string,
    @Body() body: { amount: number; paidAt?: string; notes?: string },
  ) {
    return this.service.addCommissionInstallment(
      { saleId },
      { amount: body.amount, paidAt: body.paidAt ? new Date(body.paidAt) : null, notes: body.notes },
    );
  }

  @Get('leases/:leaseId/commission-installments')
  @RequirePermissions('broker:view')
  @ApiOperation({ summary: "List a lease's broker commission installments" })
  listLeaseCommissionInstallments(@Param('leaseId') leaseId: string) {
    return this.service.getCommissionInstallments({ leaseId });
  }

  @Post('leases/:leaseId/commission-installments')
  @RequirePermissions('broker:edit')
  @ApiOperation({ summary: "Record a new commission installment on a lease (e.g. a 2nd payment)" })
  addLeaseCommissionInstallment(
    @Param('leaseId') leaseId: string,
    @Body() body: { amount: number; paidAt?: string; notes?: string },
  ) {
    return this.service.addCommissionInstallment(
      { leaseId },
      { amount: body.amount, paidAt: body.paidAt ? new Date(body.paidAt) : null, notes: body.notes },
    );
  }

  @Patch('commission-installments/:id/mark-paid')
  @RequirePermissions('broker:edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a single commission installment as paid' })
  markCommissionInstallmentPaid(@Param('id') id: string, @Body() body: { paidAt?: string }) {
    return this.service.markCommissionInstallmentPaid(id, body?.paidAt ? new Date(body.paidAt) : undefined);
  }

  @Delete('commission-installments/:id')
  @RequirePermissions('broker:edit')
  @ApiOperation({ summary: 'Remove a commission installment (e.g. entered by mistake)' })
  removeCommissionInstallment(@Param('id') id: string) {
    return this.service.removeCommissionInstallment(id);
  }
}
