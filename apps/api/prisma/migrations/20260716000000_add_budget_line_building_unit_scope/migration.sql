-- AlterTable
ALTER TABLE "budget_lines" ADD COLUMN     "buildingId" TEXT,
ADD COLUMN     "unitId" TEXT;

-- CreateIndex
CREATE INDEX "budget_lines_buildingId_idx" ON "budget_lines"("buildingId");

-- CreateIndex
CREATE INDEX "budget_lines_unitId_idx" ON "budget_lines"("unitId");

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
