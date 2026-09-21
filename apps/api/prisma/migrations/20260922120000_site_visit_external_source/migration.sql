-- Externally-booked site visits (Calendly first).
--
-- Import-only by design (client, 2026-09-22): the tracker stays the scheduler and the
-- source of truth for availability. A Calendly booking arrives as an already-CONFIRMED
-- visit, because Calendly checked availability and told the lead it was happening —
-- routing it through the Founder's confirm gate would be asking permission for something
-- already promised.
--
-- Because it lands CONFIRMED it also occupies its slot against the existing partial unique
-- index on (hostId, startsAt), so the tracker will not go on to offer the same hour.
ALTER TABLE "site_visits" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalUrl" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'INTERNAL';

-- UNIQUE is what makes webhook delivery idempotent. Providers retry on any non-2xx (and
-- sometimes on success), so a duplicate delivery must collide rather than create a second
-- visit for the same booking.
CREATE UNIQUE INDEX "site_visits_externalId_key" ON "site_visits"("externalId");

CREATE INDEX "site_visits_source_startsAt_idx" ON "site_visits"("source", "startsAt");
