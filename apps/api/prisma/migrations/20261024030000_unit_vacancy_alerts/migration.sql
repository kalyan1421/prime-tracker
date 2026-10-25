-- Dedupe record for the stale-vacancy alert (StaleUnitsCron).
--
-- The cron used to alert only when a unit's vacancy age fell in the exact 24-hour window
-- after a 90/120/180/365-day bucket, so a run that did not happen (a deploy at 08:00, a
-- day of downtime) lost that bucket's alert for good. It now records, per unit, the
-- vacancy it alerted for and the highest bucket alerted, and alerts on any bucket crossed
-- since. One row per unit; a new vacancy (different start) starts the buckets over.
-- Starts empty: the first run alerts each currently-stale unit once, at its current bucket.
CREATE TABLE "unit_vacancy_alerts" (
    "unitId" TEXT NOT NULL,
    "vacancyStart" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "alertedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_vacancy_alerts_pkey" PRIMARY KEY ("unitId")
);

ALTER TABLE "unit_vacancy_alerts"
  ADD CONSTRAINT "unit_vacancy_alerts_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
