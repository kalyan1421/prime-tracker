-- Tag interior/TI Actuals so the main project's budget/variance/KPI views can exclude them. Additive only.
ALTER TABLE "actuals" ADD COLUMN "interiorProjectId" TEXT;
CREATE INDEX "actuals_interiorProjectId_idx" ON "actuals"("interiorProjectId");
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_interiorProjectId_fkey" FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
