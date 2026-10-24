-- At most one UNREAD copy of a recurring alert per person — enforced by the database.
--
-- NotificationsService.suppressAlreadyPending() reads "does this user already have this
-- alert pending?" and then a separate INSERT writes it. Two runs at once (a second API
-- instance, or a cron overlapping a manual trigger) could both read "no" and both insert,
-- which is exactly the duplicate bell entry and duplicate email the dedupe exists to
-- prevent. The plain index on (userId, type, dedupeKey) made the lookup fast but promised
-- nothing. This partial unique index does; the service treats the loser's unique
-- violation (P2002) as "already sent".
--
-- Why "AND readAt IS NULL": read rows must stay outside it. A standing condition is
-- deliberately re-raised once the recipient has read it and the cooldown has passed
-- (RENOTIFY_COOLDOWN_HOURS) — that is a second row with the same key, and a unique index
-- over every row would refuse it.
--
-- Prisma's schema language cannot express a partial index, so it is created here and
-- documented on the Notification model; the plain index stays for queries.

-- 1. Collapse duplicates that the race has already produced, or the index cannot build.
--    Non-destructive: the NEWEST unread copy keeps its key; older unread copies only lose
--    their dedupeKey. Every row stays exactly as visible (and as unread) as it was — they
--    simply stop counting as "the pending one", which the newest copy already is.
UPDATE "notifications" AS n
SET "dedupeKey" = NULL
FROM (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "userId", "type", "dedupeKey"
           ORDER BY "createdAt" DESC, "id" DESC
         ) AS rn
  FROM "notifications"
  WHERE "dedupeKey" IS NOT NULL AND "readAt" IS NULL
) AS d
WHERE n."id" = d."id" AND d.rn > 1;

-- 2. The guarantee.
CREATE UNIQUE INDEX "notifications_pending_dedupe_key"
  ON "notifications" ("userId", "type", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL AND "readAt" IS NULL;
