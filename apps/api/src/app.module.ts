import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './common/config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectAccessModule } from './common/access/project-access.module';
import { CacheModule } from './common/cache/cache.module';
import { EventBusModule } from './common/events/event-bus.module';
import { HealthModule } from './common/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { BuildingsModule } from './modules/buildings/buildings.module';
import { UnitsModule } from './modules/units/units.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { ActualsModule } from './modules/actuals/actuals.module';
import { LoansModule } from './modules/loans/loans.module';
import { LeasesModule } from './modules/leases/leases.module';
import { MilestonesModule } from './modules/milestones/milestones.module';
import { CommitmentsModule } from './modules/commitments/commitments.module';
import { SalesModule } from './modules/sales/sales.module';
import { KpiModule } from './modules/kpi/kpi.module';
import { QuickbooksModule } from './modules/quickbooks/quickbooks.module';
import { AuditModule } from './modules/audit/audit.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CommentsModule } from './modules/comments/comments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { LeadsModule } from './modules/leads/leads.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CashFlowModule } from './modules/cashflow/cashflow.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { InvestorsModule } from './modules/investors/investors.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProjectHealthModule } from './modules/project-health/project-health.module';
import { DrawsModule } from './modules/draws/draws.module';
import { ExceptionsModule } from './modules/exceptions/exceptions.module';
import { InteriorModule } from './modules/interior/interior.module';
import { DailyLogsModule } from './modules/daily-logs/daily-logs.module';
import { BrokersModule } from './modules/brokers/brokers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Tiered throttling: short-burst (10/sec), medium (60/min), long (1k/15min).
    // The tightest matching limit applies. Override per route with @Throttle().
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 60_000, limit: 100 },
      { name: 'long', ttl: 900_000, limit: 1000 },
    ]),
    ScheduleModule.forRoot(),
    CacheModule,
    EventBusModule,
    HealthModule,
    PrismaModule,
    ProjectAccessModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    BuildingsModule,
    UnitsModule,
    BudgetsModule,
    ActualsModule,
    LoansModule,
    LeasesModule,
    MilestonesModule,
    CommitmentsModule,
    SalesModule,
    KpiModule,
    QuickbooksModule,
    AuditModule,
    ReportsModule,
    CommentsModule,
    NotificationsModule,
    LeadsModule,
    CampaignsModule,
    DashboardModule,
    CashFlowModule,
    VendorsModule,
    ContractsModule,
    DocumentsModule,
    InvestorsModule,
    TasksModule,
    OrganizationsModule,
    ProjectHealthModule,
    DrawsModule,
    ExceptionsModule,
    InteriorModule,
    DailyLogsModule,
    BrokersModule,
  ],
  providers: [
    // Enforces ThrottlerModule limits across every controller.
    // Without this, the module is loaded but doesn't actually apply limits.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule { }
