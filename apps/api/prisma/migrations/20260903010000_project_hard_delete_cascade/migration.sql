-- Widens ON DELETE CASCADE to the handful of FKs that had no other cascade path back to
-- Project, so a true hard-delete of a Project (ProjectsService.hardDelete) can rely on a
-- single `prisma.project.delete()` instead of a hand-rolled per-table cleanup script.
--
-- Every other FK under Project already cascades (directly, or via Building/Unit/Sale/Loan,
-- which themselves cascade from Project) — only these eight had no such path:
--   - Lease has no projectId at all (only unitId/buildingId), so its own FKs had to carry
--     the cascade.
--   - InteriorProject is anchored on unit/building only (no projectId), same reason.
--   - Client, CapitalCall, Distribution have a REQUIRED projectId with no onDelete, which
--     Prisma defaults to RESTRICT (a NOT NULL column can't be defaulted to SET NULL) —
--     that would have blocked deleting the Project outright.

-- DropForeignKey
ALTER TABLE "leases" DROP CONSTRAINT "leases_unitId_fkey";
ALTER TABLE "leases" DROP CONSTRAINT "leases_buildingId_fkey";
ALTER TABLE "clients" DROP CONSTRAINT "clients_projectId_fkey";
ALTER TABLE "clients" DROP CONSTRAINT "clients_unitId_fkey";
ALTER TABLE "capital_calls" DROP CONSTRAINT "capital_calls_projectId_fkey";
ALTER TABLE "distributions" DROP CONSTRAINT "distributions_projectId_fkey";
ALTER TABLE "interior_projects" DROP CONSTRAINT "interior_projects_unitId_fkey";
ALTER TABLE "interior_projects" DROP CONSTRAINT "interior_projects_buildingId_fkey";

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leases" ADD CONSTRAINT "leases_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clients" ADD CONSTRAINT "clients_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clients" ADD CONSTRAINT "clients_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capital_calls" ADD CONSTRAINT "capital_calls_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
