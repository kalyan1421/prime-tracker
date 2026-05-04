import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Vendors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('vendors')
export class VendorsController {
  constructor(private service: VendorsService) {}

  @Get()
  @RequirePermissions('vendor:view')
  @ApiOperation({ summary: 'List all vendors' })
  findAll() { return this.service.findAll(); }

  @Post()
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Create vendor' })
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Update vendor' })
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Delete vendor' })
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
