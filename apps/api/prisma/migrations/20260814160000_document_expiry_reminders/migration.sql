-- D2 — permits, NOCs and possession certificates need expiry dates with reminders.
--
-- Client decision 2026-08-14. Nothing in the system tracked document validity: a permit
-- could lapse mid-build and the first anyone knew was an inspector on site.
--
-- Purely additive: one nullable column, one index, two enum values. No drops, no
-- alterations, no backfill — every existing row keeps a NULL expiry and is silent.

-- Validity end. NULL means "no expiry / not known", which is the correct state for the
-- overwhelming majority of documents (photos, drawings, brochures) and for back-filled
-- permits whose paper copy nobody has dug out yet. Expiry is therefore never required at
-- the API either — refusing the upload would just mean the document is not filed at all.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

-- Supports the daily cron's exact predicate:
--   WHERE "deletedAt" IS NULL AND "expiresAt" <= <far horizon>
-- Equality-ish column first, ranged column second.
CREATE INDEX IF NOT EXISTS "documents_deletedAt_expiresAt_idx"
    ON "documents" ("deletedAt", "expiresAt");

-- Must be added HERE and in schema.prisma. A value present in the DB but missing from the
-- Prisma enum is invisible to Object.values(NotificationType), so it never appears in
-- getPreferences() and nobody can mute it — the lesson recorded on
-- 20260729120000_add_notification_types_l3.
--
-- TWO types, not one escalating type, because muting is per-type: an early warning that
-- fires 60 days out across every permit in the portfolio is exactly the sort of thing
-- somebody turns off, and turning it off must not also silence the alert that says a
-- permit has actually LAPSED.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPIRED';
