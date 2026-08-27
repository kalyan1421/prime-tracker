import { Controller, Get, Post, Put, Patch, Param, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InvestorsService } from './investors.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';
import {
  CreateInvestorDto, UpdateInvestorDto, AddEquityPositionDto,
  CreateCapitalCallDto, CreateDistributionDto,
} from './dto/create-investor.dto';

@ApiTags('Investors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('investors')
export class InvestorsController {
  constructor(private service: InvestorsService) {}

  @Get()
  @RequirePermissions('investor:view')
  @ApiOperation({ summary: 'List all investors' })
  findAll() { return this.service.findAll(); }

  @Get('summary')
  @RequirePermissions('investor:view')
  @ApiOperation({ summary: 'Get investor portfolio summary' })
  getSummary() { return this.service.getPortfolioSummary(); }

  @Get('capital-calls')
  @RequirePermissions('investor:view')
  @ApiOperation({ summary: 'List all capital calls' })
  findCapitalCalls() {
    return this.service['prisma'].capitalCall.findMany({
      include: {
        investor: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: 'desc' },
    });
  }

  @Get(':id')
  @RequirePermissions('investor:view')
  @ApiOperation({ summary: 'Get investor detail' })
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('investor:manage')
  @ApiOperation({ summary: 'Create investor' })
  create(@Body() body: CreateInvestorDto) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('investor:manage')
  @ApiOperation({ summary: 'Update investor' })
  update(@Param('id') id: string, @Body() body: UpdateInvestorDto) { return this.service.update(id, body); }

  @Post(':id/positions')
  @RequirePermissions('investor:manage')
  @ApiOperation({ summary: 'Add equity position' })
  addPosition(@Param('id') id: string, @Body() body: AddEquityPositionDto) {
    return this.service.addPosition(id, body);
  }

  @Post('capital-calls')
  @RequirePermissions('investor:manage')
  @ApiOperation({ summary: 'Create capital call' })
  createCapitalCall(@Body() body: CreateCapitalCallDto) { return this.service.createCapitalCall(body); }

  @Patch('capital-calls/:id/paid')
  @RequirePermissions('investor:manage')
  @ApiOperation({ summary: 'Mark capital call as paid' })
  markPaid(@Param('id') id: string) { return this.service.markCapitalCallPaid(id); }

  @Post('distributions')
  @RequirePermissions('investor:manage')
  @ApiOperation({ summary: 'Record distribution' })
  createDistribution(@Body() body: CreateDistributionDto) { return this.service.createDistribution(body); }
}
