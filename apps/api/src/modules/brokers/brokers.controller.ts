import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors,
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
}
