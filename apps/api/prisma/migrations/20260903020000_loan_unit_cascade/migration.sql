-- A unit-level Loan (loans.unitId set, no projectId/buildingId) had no cascade path to
-- Project at all, unlike the project-level and building-level anchors, which are already
-- ON DELETE CASCADE. Confirmed empirically: hard-deleting a project left a unit-anchored
-- loan (and its draw schedule / draw requests, which cascade FROM the loan) orphaned in
-- the database instead of removed.

-- DropForeignKey
ALTER TABLE "loans" DROP CONSTRAINT "loans_unitId_fkey";

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
