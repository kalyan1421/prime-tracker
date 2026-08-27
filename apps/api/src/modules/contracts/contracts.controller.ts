import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import {
  CreateContractDto, UpdateContractDto, CreateChangeOrderDto,
  CreateContractPaymentDto, UpdateChangeOrderStatusDto,
} from './dto/create-contract.dto';

@ApiTags('Contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('contracts')
export class ContractsController {
  constructor(private service: ContractsService) {}

  @Get()
  @RequirePermissions('vendor:view')
  @ApiOperation({ summary: 'List contracts for a project' })
  findByProject(@Query('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get('summary')
  @RequirePermissions('vendor:view')
  @ApiOperation({ summary: 'Get contract summary for a project' })
  getSummary(@Query('projectId') projectId: string) {
    return this.service.getProjectSummary(projectId);
  }

  @Post()
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Create contract' })
  create(@Body() body: CreateContractDto) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Update contract' })
  update(@Param('id') id: string, @Body() body: UpdateContractDto) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Delete contract' })
  delete(@Param('id') id: string) { return this.service.delete(id); }

  @Post(':id/change-orders')
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Add change order to contract' })
  addChangeOrder(@Param('id') id: string, @Body() body: CreateChangeOrderDto) {
    return this.service.addChangeOrder(id, body);
  }

  @Patch('change-orders/:id/status')
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Update change order status' })
  updateChangeOrderStatus(@Param('id') id: string, @Body() body: UpdateChangeOrderStatusDto) {
    return this.service.updateChangeOrderStatus(id, body.status);
  }

  @Post(':id/payments')
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Record payment on contract' })
  addPayment(@Param('id') id: string, @Body() body: CreateContractPaymentDto) {
    return this.service.addPayment(id, body);
  }
}
