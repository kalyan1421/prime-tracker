-- Unit combine (merge into one legal unit) — additive only.
ALTER TABLE "units" ADD COLUMN "mergedIntoId" TEXT;
CREATE INDEX "units_mergedIntoId_idx" ON "units"("mergedIntoId");
ALTER TABLE "units" ADD CONSTRAINT "units_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
