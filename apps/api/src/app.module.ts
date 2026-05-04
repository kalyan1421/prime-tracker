import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
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
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CashFlowModule } from './modules/cashflow/cashflow.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { InvestorsModule } from './modules/investors/investors.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    ScheduleModule.forRoot(),
    PrismaModule,
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
    DashboardModule,
    CashFlowModule,
    VendorsModule,
    ContractsModule,
    DocumentsModule,
    InvestorsModule,
    TasksModule,
    OrganizationsModule,
  ],
})
export class AppModule { }
