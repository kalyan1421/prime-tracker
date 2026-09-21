-- Lead board parity (2026-09-21).
--
-- followUpDate: the day we next owe this lead a touch. DATE not TIMESTAMP — a follow-up
-- is a day in the rep's calendar; an instant would drift across timezones for no benefit.
-- "Overdue" is computed (followUpDate < today) and never stored, so it cannot go stale.
--
-- via: the ENGAGEMENT SIGNAL that produced the lead (Favorited / Downloaded OM / Viewed
-- listing / Phone / Email lead). Deliberately separate from `source`, which is the portal
-- (LOOPNET, CREXI) — the two vary independently. Backed by CustomOption category
-- "lead_via" so the option list stays admin-editable rather than being a hardcoded enum.
ALTER TABLE "leads" ADD COLUMN     "followUpDate" DATE,
ADD COLUMN     "via" TEXT;

-- Drives the "follow-ups due" queue and the calendar view's date-range scan.
CREATE INDEX "leads_followUpDate_idx" ON "leads"("followUpDate");
