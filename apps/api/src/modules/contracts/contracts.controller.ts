import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, CurrentUser } from '../../common/decorators/index';
import { ProjectAccessService, ScopedUser } from '../../common/access/project-access.service';
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
  constructor(
    private service: ContractsService,
    private access: ProjectAccessService,
  ) {}

  // An omitted projectId reaches the guard as "no project" and passes, so it is narrowed
  // here to the caller's member projects rather than meaning every contract.
  @Get()
  @RequirePermissions('vendor:view')
  @ApiOperation({ summary: 'List contracts for a project' })
  async findByProject(@Query('projectId') projectId: string, @CurrentUser() user: ScopedUser) {
    return this.service.findByProject(await this.access.projectIdFilter(user, projectId));
  }

  @Get('summary')
  @RequirePermissions('vendor:view')
  @ApiOperation({ summary: 'Get contract summary for a project' })
  async getSummary(@Query('projectId') projectId: string, @CurrentUser() user: ScopedUser) {
    return this.service.getProjectSummary(await this.access.projectIdFilter(user, projectId));
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

  // ':changeOrderId', not ':id' — this controller maps a bare ':id' to a CONTRACT, so a
  // change-order id resolved to nothing and ProjectAccessGuard checked no project.
  @Patch('change-orders/:changeOrderId/status')
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Update change order status' })
  updateChangeOrderStatus(@Param('changeOrderId') id: string, @Body() body: UpdateChangeOrderStatusDto) {
    return this.service.updateChangeOrderStatus(id, body.status);
  }

  @Post(':id/payments')
  @RequirePermissions('vendor:edit')
  @ApiOperation({ summary: 'Record payment on contract' })
  addPayment(@Param('id') id: string, @Body() body: CreateContractPaymentDto) {
    return this.service.addPayment(id, body);
  }
}
