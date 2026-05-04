#!/usr/bin/env node
// Generate all remaining NestJS feature modules
const fs = require('fs');
const path = require('path');

const BASE = '/home/claude/prime-tracker/apps/api/src/modules';

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.trimStart());
  console.log(`Created: ${filePath}`);
}

// ===== BUILDINGS MODULE =====
writeFile(`${BASE}/buildings/buildings.module.ts`, `
import { Module } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { BuildingsController } from './buildings.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [BuildingsController],
  providers: [BuildingsService, AuditService],
  exports: [BuildingsService],
})
export class BuildingsModule {}
`);

// ===== UNITS =====
writeFile(`${BASE}/units/units.service.ts`, `
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class UnitsService {
  constructor(private prisma: PrismaService) {}

  async findByBuilding(buildingId: string) {
    return this.prisma.unit.findMany({
      where: { buildingId },
      include: { leases: { where: { status: 'ACTIVE' } }, sales: true },
      orderBy: { unitNumber: 'asc' },
    });
  }

  async findByProject(projectId: string) {
    return this.prisma.unit.findMany({
      where: { building: { projectId } },
      include: {
        building: { select: { id: true, name: true } },
        leases: { where: { status: 'ACTIVE' } },
        sales: true,
      },
      orderBy: { unitNumber: 'asc' },
    });
  }

  async findById(id: string) {
    const unit = await this.prisma.unit.findUnique({
      where: { id },
      include: { building: true, leases: true, sales: true },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  async create(data: Prisma.UnitUncheckedCreateInput) {
    return this.prisma.unit.create({ data });
  }

  async update(id: string, data: Prisma.UnitUncheckedUpdateInput) {
    await this.findById(id);
    return this.prisma.unit.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.unit.delete({ where: { id } });
  }
}
`);

writeFile(`${BASE}/units/units.controller.ts`, `
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UnitsService } from './units.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Units')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('units')
export class UnitsController {
  constructor(private service: UnitsService) {}

  @Get()
  @RequirePermissions('unit:view')
  findByProject(@Query('projectId') projectId: string, @Query('buildingId') buildingId?: string) {
    if (buildingId) return this.service.findByBuilding(buildingId);
    return this.service.findByProject(projectId);
  }

  @Get(':id')
  @RequirePermissions('unit:view')
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('unit:edit')
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('unit:edit')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('unit:edit')
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
`);

writeFile(`${BASE}/units/units.module.ts`, `
import { Module } from '@nestjs/common';
import { UnitsService } from './units.service';
import { UnitsController } from './units.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [UnitsController],
  providers: [UnitsService, AuditService],
  exports: [UnitsService],
})
export class UnitsModule {}
`);

// ===== BUDGETS =====
writeFile(`${BASE}/budgets/budgets.service.ts`, `
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.budgetLine.findMany({
      where: { projectId },
      orderBy: { category: 'asc' },
    });
  }

  async getFinancialSummary(projectId: string) {
    const [budgets, actuals, commitments] = await Promise.all([
      this.prisma.budgetLine.findMany({ where: { projectId } }),
      this.prisma.actual.findMany({ where: { projectId } }),
      this.prisma.commitment.findMany({ where: { projectId } }),
    ]);

    const budgetTotal = budgets.reduce((s, b) => s + Number(b.revisedAmt ?? b.baselineAmt), 0);
    const actualTotal = actuals.reduce((s, a) => s + Number(a.amount), 0);
    const committedTotal = commitments.reduce((s, c) => s + Number(c.contractAmt), 0);
    const forecastTotal = Math.max(committedTotal, actualTotal) + (budgetTotal - committedTotal) * 0.1;

    const byCategory = budgets.map((b) => {
      const catActuals = actuals.filter((a) => a.category === b.category).reduce((s, a) => s + Number(a.amount), 0);
      const catCommitted = commitments.filter((c) => c.category === b.category).reduce((s, c) => s + Number(c.contractAmt), 0);
      const budget = Number(b.revisedAmt ?? b.baselineAmt);
      return {
        category: b.category,
        description: b.description,
        budget,
        actual: catActuals,
        committed: catCommitted,
        forecast: Math.max(catCommitted, catActuals),
        variance: budget - catActuals,
      };
    });

    return {
      projectId,
      budgetTotal,
      actualTotal,
      committedTotal,
      forecastTotal,
      variance: budgetTotal - actualTotal,
      variancePercent: budgetTotal > 0 ? (budgetTotal - actualTotal) / budgetTotal : 0,
      byCategory,
    };
  }

  async create(data: Prisma.BudgetLineUncheckedCreateInput) {
    return this.prisma.budgetLine.create({ data });
  }

  async update(id: string, data: Prisma.BudgetLineUncheckedUpdateInput) {
    return this.prisma.budgetLine.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.budgetLine.delete({ where: { id } });
  }
}
`);

writeFile(`${BASE}/budgets/budgets.controller.ts`, `
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, RequireMfa } from '../../common/decorators/index';

@ApiTags('Budgets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, MfaGuard)
@UseInterceptors(AuditInterceptor)
@Controller('budgets')
export class BudgetsController {
  constructor(private service: BudgetsService) {}

  @Get()
  @RequirePermissions('financial:view')
  findByProject(@Query('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get('summary')
  @RequirePermissions('financial:view')
  getFinancialSummary(@Query('projectId') projectId: string) {
    return this.service.getFinancialSummary(projectId);
  }

  @Post()
  @RequirePermissions('financial:edit')
  @RequireMfa()
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('financial:edit')
  @RequireMfa()
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('financial:edit')
  @RequireMfa()
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
`);

writeFile(`${BASE}/budgets/budgets.module.ts`, `
import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService, AuditService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
`);

// ===== ACTUALS =====
writeFile(`${BASE}/actuals/actuals.service.ts`, `
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ActualsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.actual.findMany({
      where: { projectId },
      orderBy: { txnDate: 'desc' },
    });
  }

  async findUnmapped() {
    return this.prisma.actual.findMany({
      where: { qbSyncStatus: 'UNMAPPED' },
      orderBy: { txnDate: 'desc' },
    });
  }

  async create(data: Prisma.ActualUncheckedCreateInput) {
    return this.prisma.actual.create({ data });
  }

  async update(id: string, data: Prisma.ActualUncheckedUpdateInput) {
    return this.prisma.actual.update({ where: { id }, data });
  }

  async bulkCreate(data: Prisma.ActualUncheckedCreateInput[]) {
    return this.prisma.actual.createMany({ data, skipDuplicates: true });
  }
}
`);

writeFile(`${BASE}/actuals/actuals.controller.ts`, `
import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ActualsService } from './actuals.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Actuals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('actuals')
export class ActualsController {
  constructor(private service: ActualsService) {}

  @Get()
  @RequirePermissions('financial:view')
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get('unmapped')
  @RequirePermissions('financial:view')
  findUnmapped() { return this.service.findUnmapped(); }

  @Post()
  @RequirePermissions('financial:edit')
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('financial:edit')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }
}
`);

writeFile(`${BASE}/actuals/actuals.module.ts`, `
import { Module } from '@nestjs/common';
import { ActualsService } from './actuals.service';
import { ActualsController } from './actuals.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [ActualsController],
  providers: [ActualsService, AuditService],
  exports: [ActualsService],
})
export class ActualsModule {}
`);

// ===== LOANS =====
writeFile(`${BASE}/loans/loans.service.ts`, `
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async findByProject(projectId: string) {
    const loans = await this.prisma.loan.findMany({
      where: { projectId },
      include: { drawRequests: { orderBy: { drawNumber: 'asc' } } },
    });
    return loans.map((l) => this.decryptLoan(l));
  }

  async findById(id: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: { drawRequests: { orderBy: { drawNumber: 'asc' } } },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    return this.decryptLoan(loan);
  }

  async create(data: Prisma.LoanUncheckedCreateInput) {
    const encrypted = this.encryption.encryptFields(data as any, ['lender', 'principalAmt', 'interestRate', 'currentBalance']);
    return this.prisma.loan.create({ data: { ...data, encryptedFields: encrypted.encryptedFields } });
  }

  async update(id: string, data: Prisma.LoanUncheckedUpdateInput) {
    await this.findById(id);
    return this.prisma.loan.update({ where: { id }, data });
  }

  private decryptLoan(loan: any) {
    if (loan.encryptedFields) {
      return this.encryption.decryptFields(loan);
    }
    return loan;
  }
}
`);

writeFile(`${BASE}/loans/loans.controller.ts`, `
import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions, RequireMfa } from '../../common/decorators/index';

@ApiTags('Loans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, MfaGuard)
@UseInterceptors(AuditInterceptor)
@Controller('loans')
export class LoansController {
  constructor(private service: LoansService) {}

  @Get()
  @RequirePermissions('loan:view')
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get(':id')
  @RequirePermissions('loan:view')
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('loan:edit')
  @RequireMfa()
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('loan:edit')
  @RequireMfa()
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }
}
`);

writeFile(`${BASE}/loans/loans.module.ts`, `
import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { EncryptionModule } from '../../common/encryption/encryption.module';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  imports: [EncryptionModule],
  controllers: [LoansController],
  providers: [LoansService, AuditService],
  exports: [LoansService],
})
export class LoansModule {}
`);

// ===== LEASES =====
writeFile(`${BASE}/leases/leases.service.ts`, `
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class LeasesService {
  constructor(private prisma: PrismaService) {}

  async findByUnit(unitId: string) {
    return this.prisma.lease.findMany({ where: { unitId }, orderBy: { leaseStart: 'desc' } });
  }

  async findByProject(projectId: string) {
    return this.prisma.lease.findMany({
      where: { unit: { building: { projectId } } },
      include: { unit: { include: { building: { select: { name: true } } } } },
      orderBy: { leaseStart: 'desc' },
    });
  }

  async getRentRoll(projectId: string) {
    const leases = await this.prisma.lease.findMany({
      where: { unit: { building: { projectId } }, status: 'ACTIVE' },
      include: { unit: { include: { building: { select: { name: true } } } } },
    });
    const totalRent = leases.reduce((s, l) => s + Number(l.monthlyRent), 0);
    return { leases, totalMonthlyRent: totalRent, leaseCount: leases.length };
  }

  async findById(id: string) {
    const lease = await this.prisma.lease.findUnique({ where: { id }, include: { unit: true } });
    if (!lease) throw new NotFoundException('Lease not found');
    return lease;
  }

  async create(data: Prisma.LeaseUncheckedCreateInput) {
    return this.prisma.lease.create({ data });
  }

  async update(id: string, data: Prisma.LeaseUncheckedUpdateInput) {
    await this.findById(id);
    return this.prisma.lease.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.lease.delete({ where: { id } });
  }
}
`);

writeFile(`${BASE}/leases/leases.controller.ts`, `
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LeasesService } from './leases.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Leases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('leases')
export class LeasesController {
  constructor(private service: LeasesService) {}

  @Get()
  @RequirePermissions('lease:view')
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get('rent-roll')
  @RequirePermissions('lease:view')
  getRentRoll(@Query('projectId') projectId: string) { return this.service.getRentRoll(projectId); }

  @Get(':id')
  @RequirePermissions('lease:view')
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('lease:edit')
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('lease:edit')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('lease:edit')
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
`);

writeFile(`${BASE}/leases/leases.module.ts`, `
import { Module } from '@nestjs/common';
import { LeasesService } from './leases.service';
import { LeasesController } from './leases.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [LeasesController],
  providers: [LeasesService, AuditService],
  exports: [LeasesService],
})
export class LeasesModule {}
`);

// ===== MILESTONES =====
writeFile(`${BASE}/milestones/milestones.service.ts`, `
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class MilestonesService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.milestone.findMany({
      where: { projectId },
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findById(id: string) {
    const m = await this.prisma.milestone.findUnique({ where: { id }, include: { owner: true } });
    if (!m) throw new NotFoundException('Milestone not found');
    return m;
  }

  async create(data: Prisma.MilestoneUncheckedCreateInput) {
    return this.prisma.milestone.create({ data });
  }

  async update(id: string, data: Prisma.MilestoneUncheckedUpdateInput) {
    await this.findById(id);
    return this.prisma.milestone.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.milestone.delete({ where: { id } });
  }
}
`);

writeFile(`${BASE}/milestones/milestones.controller.ts`, `
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MilestonesService } from './milestones.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Milestones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('milestones')
export class MilestonesController {
  constructor(private service: MilestonesService) {}

  @Get()
  @RequirePermissions('milestone:view')
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get(':id')
  @RequirePermissions('milestone:view')
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('milestone:edit')
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('milestone:edit')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('milestone:edit')
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
`);

writeFile(`${BASE}/milestones/milestones.module.ts`, `
import { Module } from '@nestjs/common';
import { MilestonesService } from './milestones.service';
import { MilestonesController } from './milestones.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [MilestonesController],
  providers: [MilestonesService, AuditService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
`);

// ===== COMMITMENTS =====
writeFile(`${BASE}/commitments/commitments.service.ts`, `
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CommitmentsService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.commitment.findMany({ where: { projectId }, orderBy: { vendor: 'asc' } });
  }

  async findById(id: string) {
    const c = await this.prisma.commitment.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Commitment not found');
    return c;
  }

  async create(data: Prisma.CommitmentUncheckedCreateInput) {
    return this.prisma.commitment.create({ data });
  }

  async update(id: string, data: Prisma.CommitmentUncheckedUpdateInput) {
    await this.findById(id);
    return this.prisma.commitment.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.commitment.delete({ where: { id } });
  }
}
`);

writeFile(`${BASE}/commitments/commitments.controller.ts`, `
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CommitmentsService } from './commitments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Commitments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('commitments')
export class CommitmentsController {
  constructor(private service: CommitmentsService) {}

  @Get()
  @RequirePermissions('financial:view')
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get(':id')
  @RequirePermissions('financial:view')
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('financial:edit')
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('financial:edit')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('financial:edit')
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
`);

writeFile(`${BASE}/commitments/commitments.module.ts`, `
import { Module } from '@nestjs/common';
import { CommitmentsService } from './commitments.service';
import { CommitmentsController } from './commitments.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [CommitmentsController],
  providers: [CommitmentsService, AuditService],
  exports: [CommitmentsService],
})
export class CommitmentsModule {}
`);

// ===== SALES =====
writeFile(`${BASE}/sales/sales.service.ts`, `
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string) {
    return this.prisma.sale.findMany({
      where: { projectId },
      include: { unit: { include: { building: { select: { name: true } } } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getPipeline(projectId: string) {
    const sales = await this.findByProject(projectId);
    const byStatus: Record<string, any[]> = {};
    for (const s of sales) {
      (byStatus[s.status] ??= []).push(s);
    }
    return byStatus;
  }

  async findById(id: string) {
    const s = await this.prisma.sale.findUnique({ where: { id }, include: { unit: true } });
    if (!s) throw new NotFoundException('Sale not found');
    return s;
  }

  async create(data: Prisma.SaleUncheckedCreateInput) {
    return this.prisma.sale.create({ data });
  }

  async update(id: string, data: Prisma.SaleUncheckedUpdateInput) {
    await this.findById(id);
    return this.prisma.sale.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.sale.delete({ where: { id } });
  }
}
`);

writeFile(`${BASE}/sales/sales.controller.ts`, `
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
@Controller('sales')
export class SalesController {
  constructor(private service: SalesService) {}

  @Get()
  @RequirePermissions('sales:view')
  findByProject(@Query('projectId') projectId: string) { return this.service.findByProject(projectId); }

  @Get('pipeline')
  @RequirePermissions('sales:view')
  getPipeline(@Query('projectId') projectId: string) { return this.service.getPipeline(projectId); }

  @Get(':id')
  @RequirePermissions('sales:view')
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @RequirePermissions('sales:edit')
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @RequirePermissions('sales:edit')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermissions('sales:edit')
  delete(@Param('id') id: string) { return this.service.delete(id); }
}
`);

writeFile(`${BASE}/sales/sales.module.ts`, `
import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [SalesController],
  providers: [SalesService, AuditService],
  exports: [SalesService],
})
export class SalesModule {}
`);

// ===== KPI =====
writeFile(`${BASE}/kpi/kpi.service.ts`, `
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class KpiService {
  constructor(private prisma: PrismaService) {}

  async getLatest(projectId: string) {
    return this.prisma.kpiSnapshot.findFirst({
      where: { projectId },
      orderBy: { snapshotDate: 'desc' },
    });
  }

  async getHistory(projectId: string, months = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    return this.prisma.kpiSnapshot.findMany({
      where: { projectId, snapshotDate: { gte: since } },
      orderBy: { snapshotDate: 'asc' },
    });
  }

  async createSnapshot(projectId: string) {
    const [budgets, actuals, commitments, leases, units] = await Promise.all([
      this.prisma.budgetLine.findMany({ where: { projectId } }),
      this.prisma.actual.findMany({ where: { projectId } }),
      this.prisma.commitment.findMany({ where: { projectId } }),
      this.prisma.lease.findMany({ where: { unit: { building: { projectId } }, status: 'ACTIVE' } }),
      this.prisma.unit.findMany({ where: { building: { projectId } } }),
    ]);

    const budgetTotal = budgets.reduce((s, b) => s + Number(b.revisedAmt ?? b.baselineAmt), 0);
    const actualTotal = actuals.reduce((s, a) => s + Number(a.amount), 0);
    const committedTotal = commitments.reduce((s, c) => s + Number(c.contractAmt), 0);
    const leasedSqft = leases.reduce((s, l) => {
      const unit = units.find(u => u.id === l.unitId);
      return s + (unit?.sqft ?? 0);
    }, 0);
    const totalSqft = units.reduce((s, u) => s + (u.sqft ?? 0), 0);
    const soldUnits = units.filter(u => u.status === 'SOLD').length;

    return this.prisma.kpiSnapshot.create({
      data: {
        projectId,
        snapshotDate: new Date(),
        budgetTotal,
        actualTotal,
        committedTotal,
        forecastTotal: Math.max(committedTotal, actualTotal),
        variance: budgetTotal - actualTotal,
        occupancyPct: totalSqft > 0 ? (leasedSqft / totalSqft) * 100 : 0,
        leasedSqft,
        soldUnits,
      },
    });
  }
}
`);

writeFile(`${BASE}/kpi/kpi.controller.ts`, `
import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { KpiService } from './kpi.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('KPI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('kpi')
export class KpiController {
  constructor(private service: KpiService) {}

  @Get('latest')
  @RequirePermissions('financial:view')
  getLatest(@Query('projectId') projectId: string) { return this.service.getLatest(projectId); }

  @Get('history')
  @RequirePermissions('financial:view')
  getHistory(@Query('projectId') projectId: string, @Query('months') months?: number) {
    return this.service.getHistory(projectId, months);
  }

  @Post('snapshot')
  @RequirePermissions('financial:edit')
  createSnapshot(@Query('projectId') projectId: string) { return this.service.createSnapshot(projectId); }
}
`);

writeFile(`${BASE}/kpi/kpi.module.ts`, `
import { Module } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { KpiController } from './kpi.controller';

@Module({
  controllers: [KpiController],
  providers: [KpiService],
  exports: [KpiService],
})
export class KpiModule {}
`);

// ===== AUDIT MODULE (viewer) =====
writeFile(`${BASE}/audit/audit.controller.ts`, `
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from '../../common/utils/audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/index';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  @RequirePermissions('audit:view')
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('userId') userId?: string,
    @Query('entity') entity?: string,
    @Query('action') action?: string,
  ) {
    return this.auditService.findAll({ page, limit, userId, entity, action });
  }
}
`);

writeFile(`${BASE}/audit/audit.module.ts`, `
import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
`);

console.log('All modules generated!');
