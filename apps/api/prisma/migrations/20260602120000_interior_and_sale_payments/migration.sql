-- Interior / Fit-Out Module + Sale Payment Schedule (Phase 1)
-- Additive only: 6 new enums, 2 enum extensions, 5 new tables, 1 nullable column on documents,
-- and FK back-relations. No destructive changes to existing data.
-- Spec: docs/client-discovery/TDD_Interior_and_SalePayment.md

-- CreateEnum
CREATE TYPE "InteriorPhase" AS ENUM ('DESIGN', 'CLIENT_APPROVAL', 'CITY_APPROVAL', 'PROCUREMENT', 'EXECUTION', 'SNAGGING', 'HANDOVER');

-- CreateEnum
CREATE TYPE "InteriorStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InteriorContractType" AS ENUM ('PER_SQFT', 'FIXED', 'COST_PLUS');

-- CreateEnum
CREATE TYPE "SnagStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SalePaymentStatus" AS ENUM ('SCHEDULED', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "SalePaymentTrigger" AS ENUM ('ON_SIGNING', 'ON_MILESTONE', 'FIXED_DATE', 'ON_HANDOVER');

-- AlterEnum: DocCategory (interior phase gates)
ALTER TYPE "DocCategory" ADD VALUE 'CITY_APPROVAL';
ALTER TYPE "DocCategory" ADD VALUE 'HANDOVER_CERTIFICATE';

-- AlterEnum: NotificationType (interior + sale-payment triggers)
ALTER TYPE "NotificationType" ADD VALUE 'INTERIOR_PHASE_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'INTERIOR_HANDOVER_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'SNAG_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_DUE_7';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_OVERDUE';

-- AlterTable: documents gains an optional interior-project attachment
ALTER TABLE "documents" ADD COLUMN "interiorProjectId" TEXT;

-- CreateTable
CREATE TABLE "interior_projects" (
    "id" TEXT NOT NULL,
    "unitId" TEXT,
    "buildingId" TEXT,
    "saleId" TEXT,
    "leaseId" TEXT,
    "name" TEXT NOT NULL,
    "status" "InteriorStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "phase" "InteriorPhase" NOT NULL DEFAULT 'DESIGN',
    "pmId" TEXT,
    "contractType" "InteriorContractType" NOT NULL DEFAULT 'PER_SQFT',
    "ratePerSqft" DECIMAL(12,2),
    "area" DECIMAL(10,2),
    "contractValue" DECIMAL(14,2),
    "encryptedFields" TEXT,
    "packageTemplateId" TEXT,
    "startDate" TIMESTAMP(3),
    "targetEnd" TIMESTAMP(3),
    "handoverAt" TIMESTAMP(3),
    "clientApprovedAt" TIMESTAMP(3),
    "cityApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "interior_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interior_scope_items" (
    "id" TEXT NOT NULL,
    "interiorProjectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "quantity" DECIMAL(12,2),
    "unit" TEXT,
    "unitPrice" DECIMAL(12,2),
    "total" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interior_scope_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interior_invoices" (
    "id" TEXT NOT NULL,
    "interiorProjectId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "invoiceNo" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "actualId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interior_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snag_items" (
    "id" TEXT NOT NULL,
    "interiorProjectId" TEXT,
    "milestoneId" TEXT,
    "description" TEXT NOT NULL,
    "room" TEXT,
    "assigneeId" TEXT,
    "status" "SnagStatus" NOT NULL DEFAULT 'OPEN',
    "photoPath" TEXT,
    "dueDate" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snag_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "trigger" "SalePaymentTrigger" NOT NULL DEFAULT 'FIXED_DATE',
    "dueDate" TIMESTAMP(3),
    "milestoneId" TEXT,
    "effectiveDueDate" TIMESTAMP(3),
    "amount" DECIMAL(14,2) NOT NULL,
    "percentOfPrice" DECIMAL(5,2),
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "status" "SalePaymentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "interiorProjectId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interior_projects_unitId_idx" ON "interior_projects"("unitId");
CREATE INDEX "interior_projects_buildingId_idx" ON "interior_projects"("buildingId");
CREATE INDEX "interior_projects_saleId_idx" ON "interior_projects"("saleId");
CREATE INDEX "interior_projects_status_phase_idx" ON "interior_projects"("status", "phase");
CREATE INDEX "interior_projects_deletedAt_idx" ON "interior_projects"("deletedAt");
CREATE INDEX "interior_scope_items_interiorProjectId_idx" ON "interior_scope_items"("interiorProjectId");
CREATE INDEX "interior_invoices_interiorProjectId_idx" ON "interior_invoices"("interiorProjectId");
CREATE INDEX "interior_invoices_vendorId_idx" ON "interior_invoices"("vendorId");
CREATE INDEX "snag_items_interiorProjectId_status_idx" ON "snag_items"("interiorProjectId", "status");
CREATE INDEX "snag_items_milestoneId_idx" ON "snag_items"("milestoneId");
CREATE INDEX "sale_payments_saleId_sequence_idx" ON "sale_payments"("saleId", "sequence");
CREATE INDEX "sale_payments_milestoneId_idx" ON "sale_payments"("milestoneId");
CREATE INDEX "sale_payments_status_effectiveDueDate_idx" ON "sale_payments"("status", "effectiveDueDate");
CREATE INDEX "documents_interiorProjectId_idx" ON "documents"("interiorProjectId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_interiorProjectId_fkey" FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_pmId_fkey" FOREIGN KEY ("pmId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "interior_scope_items" ADD CONSTRAINT "interior_scope_items_interiorProjectId_fkey" FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interior_invoices" ADD CONSTRAINT "interior_invoices_interiorProjectId_fkey" FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interior_invoices" ADD CONSTRAINT "interior_invoices_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "snag_items" ADD CONSTRAINT "snag_items_interiorProjectId_fkey" FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "snag_items" ADD CONSTRAINT "snag_items_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "snag_items" ADD CONSTRAINT "snag_items_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
