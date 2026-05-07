import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { SalesForecastService } from './sales-forecast.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { UserRole } from '@prisma/client';

@ApiTags('Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('sales')
export class SalesController {
  constructor(
    private service: SalesService,
    private forecast: SalesForecastService,
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
}
