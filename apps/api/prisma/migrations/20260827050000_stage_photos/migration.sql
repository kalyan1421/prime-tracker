-- Photos on a checklist stage. Evidence for a step ("here is the rough electrical"), as
-- distinct from DailyLogPhoto which belongs to a dated site update.
CREATE TABLE "unit_construction_stage_photos" (
    "id"           TEXT NOT NULL,
    "stageId"      TEXT NOT NULL,
    "storagePath"  TEXT NOT NULL,
    "caption"      TEXT,
    "uploadedById" TEXT,
    "uploadedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "unit_construction_stage_photos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "unit_construction_stage_photos_stageId_idx" ON "unit_construction_stage_photos"("stageId");

-- A stage's photos die with the stage; an orphaned image of a step that no longer exists is
-- storage nobody can reach.
ALTER TABLE "unit_construction_stage_photos" ADD CONSTRAINT "unit_construction_stage_photos_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "unit_construction_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "unit_construction_stage_photos" ADD CONSTRAINT "unit_construction_stage_photos_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
