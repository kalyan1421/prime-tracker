-- Site update threading and stage pinning. Phase 3.
--
-- Hand-written, as with every migration in this series: `migrate diff` still wants to sweep
-- in pre-existing drift unrelated to this change (see the note in
-- 20260827000000_site_tracker_and_versioned_templates).
ALTER TABLE "daily_logs"
  ADD COLUMN "parentId" TEXT,
  ADD COLUMN "stageId"  TEXT;

-- Reading a thread means "all replies to this update", which is the only access pattern.
CREATE INDEX "daily_logs_parentId_idx" ON "daily_logs"("parentId");
CREATE INDEX "daily_logs_stageId_idx"  ON "daily_logs"("stageId");

-- A reply dies with the update it answers; an orphaned "yes, agreed" is noise.
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A pinned stage being deleted must NOT delete the update — the note is the record, the pin
-- is only a filing decision.
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "unit_construction_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
