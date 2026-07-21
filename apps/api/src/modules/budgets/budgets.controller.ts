import {
  Controller, Get, Post, Put, Delete, Param, Body, Query,
  UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import { CreateBudgetLineDto } from './dto/create-budget-line.dto';
import { UpdateBudgetLineDto } from './dto/update-budget-line.dto';

@ApiTags('Budgets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('budgets')
export class BudgetsController {
  constructor(private service: BudgetsService) {}

  @Get()
  @RequirePermissions('budget:view')
  @ApiOperation({ summary: 'List budget lines by projectId, buildingId, or unitId' })
  findByProject(
    @Query('projectId') projectId: string,
    @Query('buildingId') buildingId?: string,
    @Query('unitId') unitId?: string,
  ) {
    if (unitId) return this.service.findByUnit(unitId);
    if (buildingId) return this.service.findByBuilding(buildingId);
    return this.service.findByProject(projectId);
  }

  @Get('summary')
  @RequirePermissions('budget:view')
  @ApiOperation({ summary: 'Financial summary: budget vs actual vs committed vs forecast by category — by project, building, or unit' })
  getFinancialSummary(
    @Query('projectId') projectId: string,
    @Query('buildingId') buildingId?: string,
    @Query('unitId') unitId?: string,
  ) {
    if (unitId) return this.service.getUnitSummary(unitId);
    if (buildingId) return this.service.getBuildingSummary(buildingId);
    return this.service.getFinancialSummary(projectId);
  }

  @Post()
  @RequirePermissions('budget:edit')
  @ApiOperation({ summary: 'Create budget line' })
  create(@Body() body: CreateBudgetLineDto) {
    return this.service.create(body);
  }

  @Put(':id')
  @RequirePermissions('budget:edit')
  @ApiOperation({ summary: 'Update budget line' })
  update(@Param('id') id: string, @Body() body: UpdateBudgetLineDto) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('budget:edit')
  @ApiOperation({ summary: 'Delete budget line' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
