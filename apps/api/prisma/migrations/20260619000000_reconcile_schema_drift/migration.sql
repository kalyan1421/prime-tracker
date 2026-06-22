-- DropForeignKey
ALTER TABLE "budget_revisions" DROP CONSTRAINT "budget_revisions_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "budget_revisions" DROP CONSTRAINT "budget_revisions_budgetLineId_fkey";

-- DropForeignKey
ALTER TABLE "budget_revisions" DROP CONSTRAINT "budget_revisions_createdById_fkey";

-- DropForeignKey
ALTER TABLE "campaign_spend" DROP CONSTRAINT "campaign_spend_recordedBy_fkey";

-- DropForeignKey
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "draw_approvals" DROP CONSTRAINT "draw_approvals_actorId_fkey";

-- DropForeignKey
ALTER TABLE "draw_approvals" DROP CONSTRAINT "draw_approvals_drawRequestId_fkey";

-- DropForeignKey
ALTER TABLE "draw_documents" DROP CONSTRAINT "draw_documents_drawRequestId_fkey";

-- DropForeignKey
ALTER TABLE "draw_documents" DROP CONSTRAINT "draw_documents_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "leases" DROP CONSTRAINT "leases_buildingId_fkey";

-- DropForeignKey
ALTER TABLE "leases" DROP CONSTRAINT "leases_unitId_fkey";

-- DropForeignKey
ALTER TABLE "milestone_photos" DROP CONSTRAINT "milestone_photos_milestoneId_fkey";

-- DropForeignKey
ALTER TABLE "milestone_photos" DROP CONSTRAINT "milestone_photos_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "milestones" DROP CONSTRAINT "milestones_dependsOnId_fkey";

-- DropForeignKey
ALTER TABLE "milestones" DROP CONSTRAINT "milestones_linkedDrawScheduleId_fkey";

-- DropForeignKey
ALTER TABLE "org_settings" DROP CONSTRAINT "org_settings_orgId_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_buildingId_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_unitId_fkey";

-- DropIndex
DROP INDEX "sales_discountApprovedById_idx";

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordHash" TEXT;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_linkedDrawScheduleId_fkey" FOREIGN KEY ("linkedDrawScheduleId") REFERENCES "draw_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_photos" ADD CONSTRAINT "milestone_photos_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_photos" ADD CONSTRAINT "milestone_photos_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "budget_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_approvals" ADD CONSTRAINT "draw_approvals_drawRequestId_fkey" FOREIGN KEY ("drawRequestId") REFERENCES "draw_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_approvals" ADD CONSTRAINT "draw_approvals_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_documents" ADD CONSTRAINT "draw_documents_drawRequestId_fkey" FOREIGN KEY ("drawRequestId") REFERENCES "draw_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_documents" ADD CONSTRAINT "draw_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_spend" ADD CONSTRAINT "campaign_spend_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


