-- Interiors costing (2026-10-17): replaces BuilderTrend's estimate / budget / PO screens for
-- interiors. Estimate lock + original-budget snapshot, change orders, purchase orders and
-- their lines, bills on POs, a Prime/Tenant split on every line, multi-unit fit-outs, an
-- activity log, and the approval rules (OrgSettings, Super Admin edits). Additive only.

-- AlterTable
ALTER TABLE "interior_invoices" ADD COLUMN     "purchaseOrderId" TEXT;

-- AlterTable
ALTER TABLE "interior_projects" ADD COLUMN     "estimateLockedAt" TIMESTAMP(3),
ADD COLUMN     "estimateLockedById" TEXT,
ADD COLUMN     "estimateStatus" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "estimateSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "estimateSubmittedById" TEXT,
ADD COLUMN     "plansSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "poPrefix" TEXT,
ADD COLUMN     "priority" TEXT,
ADD COLUMN     "tiAllowance" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "interior_scope_items" ADD COLUMN     "costCodeId" TEXT,
ADD COLUMN     "costType" TEXT,
ADD COLUMN     "paidBy" TEXT NOT NULL DEFAULT 'PRIME',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supplier" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "org_settings" ADD COLUMN     "interiorBillApproverRoles" TEXT[] DEFAULT ARRAY['FOUNDER', 'PROJECT_MANAGER']::TEXT[],
ADD COLUMN     "interiorCoAboveLimitRoles" TEXT[] DEFAULT ARRAY['FOUNDER', 'PROJECT_MANAGER']::TEXT[],
ADD COLUMN     "interiorCoApproverRoles" TEXT[] DEFAULT ARRAY['FOUNDER', 'PROJECT_MANAGER']::TEXT[],
ADD COLUMN     "interiorCoLimit" DECIMAL(14,2) NOT NULL DEFAULT 60000,
ADD COLUMN     "interiorLockRoles" TEXT[] DEFAULT ARRAY['FOUNDER', 'PROJECT_MANAGER']::TEXT[],
ADD COLUMN     "interiorPoApproverRoles" TEXT[] DEFAULT ARRAY['FOUNDER', 'PROJECT_MANAGER']::TEXT[],
ADD COLUMN     "interiorUnlockRoles" TEXT[] DEFAULT ARRAY['FOUNDER', 'PROJECT_MANAGER']::TEXT[],
ADD COLUMN     "interiorVarianceRoles" TEXT[] DEFAULT ARRAY['FOUNDER', 'PROJECT_MANAGER']::TEXT[];

-- CreateTable
CREATE TABLE "interior_cost_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "groupCode" TEXT,
    "groupName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interior_cost_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interior_budget_snapshots" (
    "id" TEXT NOT NULL,
    "interiorProjectId" TEXT NOT NULL,
    "costCodeId" TEXT,
    "paidBy" TEXT NOT NULL DEFAULT 'PRIME',
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interior_budget_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interior_change_orders" (
    "id" TEXT NOT NULL,
    "interiorProjectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "costCodeId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "paidBy" TEXT NOT NULL DEFAULT 'PRIME',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interior_change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interior_purchase_orders" (
    "id" TEXT NOT NULL,
    "interiorProjectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "scope" TEXT,
    "scheduledCompletion" TIMESTAMP(3),
    "materialsOnly" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "variance" BOOLEAN NOT NULL DEFAULT false,
    "workCompletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interior_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interior_purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "costCodeId" TEXT,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidBy" TEXT NOT NULL DEFAULT 'PRIME',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "interior_purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interior_activity" (
    "id" TEXT NOT NULL,
    "interiorProjectId" TEXT NOT NULL,
    "actorId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interior_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interior_project_units" (
    "interiorProjectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "interior_project_units_pkey" PRIMARY KEY ("interiorProjectId","unitId")
);

-- CreateIndex
CREATE INDEX "interior_cost_codes_active_sortOrder_idx" ON "interior_cost_codes"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "interior_cost_codes_groupName_name_key" ON "interior_cost_codes"("groupName", "name");

-- CreateIndex
CREATE INDEX "interior_budget_snapshots_interiorProjectId_idx" ON "interior_budget_snapshots"("interiorProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "interior_change_orders_interiorProjectId_number_key" ON "interior_change_orders"("interiorProjectId", "number");

-- CreateIndex
CREATE INDEX "interior_purchase_orders_vendorId_idx" ON "interior_purchase_orders"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "interior_purchase_orders_interiorProjectId_number_key" ON "interior_purchase_orders"("interiorProjectId", "number");

-- CreateIndex
CREATE INDEX "interior_purchase_order_lines_purchaseOrderId_idx" ON "interior_purchase_order_lines"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "interior_purchase_order_lines_costCodeId_idx" ON "interior_purchase_order_lines"("costCodeId");

-- CreateIndex
CREATE INDEX "interior_activity_interiorProjectId_createdAt_idx" ON "interior_activity"("interiorProjectId", "createdAt");

-- CreateIndex
CREATE INDEX "interior_project_units_unitId_idx" ON "interior_project_units"("unitId");

-- CreateIndex
CREATE INDEX "interior_invoices_purchaseOrderId_idx" ON "interior_invoices"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "interior_scope_items_costCodeId_idx" ON "interior_scope_items"("costCodeId");

-- AddForeignKey
ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_estimateSubmittedById_fkey" FOREIGN KEY ("estimateSubmittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_estimateLockedById_fkey" FOREIGN KEY ("estimateLockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_scope_items" ADD CONSTRAINT "interior_scope_items_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "interior_cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_invoices" ADD CONSTRAINT "interior_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "interior_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_budget_snapshots" ADD CONSTRAINT "interior_budget_snapshots_interiorProjectId_fkey" FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_budget_snapshots" ADD CONSTRAINT "interior_budget_snapshots_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "interior_cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_change_orders" ADD CONSTRAINT "interior_change_orders_interiorProjectId_fkey" FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_change_orders" ADD CONSTRAINT "interior_change_orders_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "interior_cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_change_orders" ADD CONSTRAINT "interior_change_orders_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_change_orders" ADD CONSTRAINT "interior_change_orders_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_purchase_orders" ADD CONSTRAINT "interior_purchase_orders_interiorProjectId_fkey" FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_purchase_orders" ADD CONSTRAINT "interior_purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_purchase_orders" ADD CONSTRAINT "interior_purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_purchase_orders" ADD CONSTRAINT "interior_purchase_orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_purchase_order_lines" ADD CONSTRAINT "interior_purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "interior_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_purchase_order_lines" ADD CONSTRAINT "interior_purchase_order_lines_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "interior_cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_activity" ADD CONSTRAINT "interior_activity_interiorProjectId_fkey" FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_activity" ADD CONSTRAINT "interior_activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_project_units" ADD CONSTRAINT "interior_project_units_interiorProjectId_fkey" FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interior_project_units" ADD CONSTRAINT "interior_project_units_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- BuilderTrend's cost codes, copied exactly as they appear on the job costing screen shown
-- in the 2026-10-13 meeting — numbering quirks included ("1415", "7.50", codes with no
-- number). Kevin is sending the full list; more are added from the Interior settings page.
INSERT INTO "interior_cost_codes" ("id","code","name","groupCode","groupName","sortOrder","active","createdAt","updatedAt") VALUES
 ('btcc-0125',   '01.25', 'Equipment Rental',          '02', 'BUSINESS OPERATIONS',   10,  true, now(), now()),
 ('btcc-0220',   '02.20', 'Design/Value Engineering',  '02', 'BUSINESS OPERATIONS',   20,  true, now(), now()),
 ('btcc-0225',   '02.25', 'Jobsite Safety/Security',   '02', 'BUSINESS OPERATIONS',   30,  true, now(), now()),
 ('btcc-04-con', NULL,    'Concrete',                  '04', 'FOUNDATION & BASEMENT', 40,  true, now(), now()),
 ('btcc-0500',   '05.00', 'Framing',                   '05', 'FRAMING',               50,  true, now(), now()),
 ('btcc-1415',   '1415',  'Drop Ceiling',              '05', 'FRAMING',               60,  true, now(), now()),
 ('btcc-0705',   '07.05', 'Plumbing Material',         '07', 'PLUMBING',              70,  true, now(), now()),
 ('btcc-0710',   '07.10', 'Plumbing Labor',            '07', 'PLUMBING',              80,  true, now(), now()),
 ('btcc-0750',   '7.50',  'Fire Sprinkler/Alarm',      '07', 'PLUMBING',              90,  true, now(), now()),
 ('btcc-0800',   '08.00', 'Electrical',                '08', 'ELECTRICAL',            100, true, now(), now()),
 ('btcc-0900',   '09.00', 'HVAC',                      '09', 'HVAC',                  110, true, now(), now()),
 ('btcc-1310',   '13.10', 'Exterior Doors',            '13', 'WINDOWS & DOORS',       120, true, now(), now()),
 ('btcc-1330',   '13.30', 'Interior Doors',            '13', 'WINDOWS & DOORS',       130, true, now(), now()),
 ('btcc-1400',   '14.00', 'Paint',                     '14', 'PAINT & WALLCOVERING',  140, true, now(), now()),
 ('btcc-1500',   '15.00', 'Hardwood Materials',        '15', 'FLOORING & TILE',       150, true, now(), now()),
 ('btcc-1525',   '15.25', 'Flooring Labor/Material',   '15', 'FLOORING & TILE',       160, true, now(), now()),
 ('btcc-15-tile', NULL,   'Tile',                      '15', 'FLOORING & TILE',       170, true, now(), now()),
 ('btcc-1900',   '19.00', 'General Site Cleanup',      '19', 'CLEANUP',               180, true, now(), now()),
 ('btcc-flat',   NULL,    'Buildertrend Flat Rate',    NULL, 'Buildertrend Default',  990, true, now(), now())
ON CONFLICT DO NOTHING;
