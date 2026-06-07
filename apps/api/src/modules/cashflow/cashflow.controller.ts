import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CashFlowService } from './cashflow.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../../common/access/project-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('CashFlow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ProjectAccessGuard)
@UseInterceptors(AuditInterceptor)
@Controller('cashflow')
export class CashFlowController {
  constructor(private service: CashFlowService) {}

  @Get()
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'List cash flow entries for a project' })
  findByProject(@Query('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get('forecast')
  @RequirePermissions('financial:view')
  @ApiOperation({ summary: 'Get cash flow forecast for a project' })
  getForecast(@Query('projectId') projectId: string) {
    return this.service.getForecast(projectId);
  }

  @Post()
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Create cash flow entry' })
  create(@Body() body: any, @Request() req: any) {
    return this.service.create(body, req.user.sub);
  }

  @Put(':id')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Update cash flow entry' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('financial:edit')
  @ApiOperation({ summary: 'Delete cash flow entry' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
