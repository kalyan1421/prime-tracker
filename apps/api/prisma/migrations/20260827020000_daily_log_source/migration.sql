-- Site update provenance. See docs/client-discovery/SITE_TRACKER_UPDATE_SECTION_PLAN.md §Phase 3.
--
-- Hand-written, like the two migrations before it: `migrate diff` still wants to sweep in
-- pre-existing drift (dropping defaults on users.roles / project_members.roles /
-- custom_options.updatedAt, and dropping leases_brokerId_idx), none of which belongs here.
--
-- Existing rows default to WEB, which is accurate — every log to date was posted through
-- the web composer, the only path that existed.
ALTER TABLE "daily_logs" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'WEB';

-- Phase 6 will want "show me everything that came in by email today" across a project.
CREATE INDEX "daily_logs_source_idx" ON "daily_logs"("source");
