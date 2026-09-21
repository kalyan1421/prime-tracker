-- LeadActivity.occurredAt — WHEN IT HAPPENED, vs createdAt = when it was typed in.
--
-- Without this, a rep catching up on Friday records three calls made across the week as
-- all having happened on Friday, and the per-lead calendar (client 2026-09-21) — tap a
-- past date, log the call that happened on it — is impossible to build.
--
-- createdAt stays untouched so the audit trail still says when the row was written.
ALTER TABLE "lead_activities" ADD COLUMN     "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: for every row that already exists, it happened when it was written. This is
-- the only defensible value, and leaving them at CURRENT_TIMESTAMP would stamp the whole
-- existing history with the migration date.
UPDATE "lead_activities" SET "occurredAt" = "createdAt";

-- Call count, last-call lookup and the calendar's per-date roll-up all filter by type
-- and order by occurredAt.
CREATE INDEX "lead_activities_leadId_type_occurredAt_idx" ON "lead_activities"("leadId", "type", "occurredAt");
