-- Sale discount-approval gate (Phase 3)
-- Additive only: 2 nullable columns + 1 FK on sales, 1 column on org_settings.

-- AlterTable: sales gains discount-approval audit fields
ALTER TABLE "sales" ADD COLUMN "discountApprovedById" TEXT;
ALTER TABLE "sales" ADD COLUMN "discountApprovedAt" TIMESTAMP(3);

-- AlterTable: org-level discount threshold (% below asking that requires Founder approval)
ALTER TABLE "org_settings" ADD COLUMN "discountApprovalThresholdPct" DECIMAL(5,2) NOT NULL DEFAULT 5;

-- CreateIndex
CREATE INDEX "sales_discountApprovedById_idx" ON "sales"("discountApprovedById");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_discountApprovedById_fkey" FOREIGN KEY ("discountApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
