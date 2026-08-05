-- Stable per-condition key for re-notification suppression.
--
-- The suppression added alongside this column originally matched on `title`, which does
-- not work for the seven recurring types whose title embeds a live day counter
-- ("Rent overdue (29d): …" -> "(30d)" the next morning). Those are exactly the types
-- that produced the backlog, so the dedupe has to key on something age-invariant.
ALTER TABLE "notifications" ADD COLUMN "dedupeKey" TEXT;

CREATE INDEX "notifications_userId_type_dedupeKey_idx"
  ON "notifications" ("userId", "type", "dedupeKey");
