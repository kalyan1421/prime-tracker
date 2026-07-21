-- AlterTable
ALTER TABLE "actuals" ADD COLUMN     "buildingId" TEXT,
ADD COLUMN     "unitId" TEXT;

-- AlterTable
ALTER TABLE "commitments" ADD COLUMN     "buildingId" TEXT,
ADD COLUMN     "unitId" TEXT;

-- CreateIndex
CREATE INDEX "actuals_buildingId_idx" ON "actuals"("buildingId");

-- CreateIndex
CREATE INDEX "actuals_unitId_idx" ON "actuals"("unitId");

-- CreateIndex
CREATE INDEX "commitments_buildingId_idx" ON "commitments"("buildingId");

-- CreateIndex
CREATE INDEX "commitments_unitId_idx" ON "commitments"("unitId");

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
