import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrokersService } from './brokers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

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
  create(
    @Body() body: {
      name: string; company?: string; email?: string; phone?: string;
      commissionRate?: number; commissionFlat?: number; notes?: string;
    },
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  @RequirePermissions('broker:edit')
  update(
    @Param('id') id: string,
    @Body() body: {
      name?: string; company?: string; email?: string; phone?: string;
      commissionRate?: number; commissionFlat?: number; notes?: string; isActive?: boolean;
    },
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
  @ApiOperation({ summary: 'Mark broker commission as paid on a sale' })
  markCommissionPaid(@Param('saleId') saleId: string) {
    return this.service.markCommissionPaid(saleId);
  }
}
