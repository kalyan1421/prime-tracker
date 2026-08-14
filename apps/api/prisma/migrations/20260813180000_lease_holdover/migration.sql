-- Holdover — occupancy past the contracted end.
--
-- `terminationDate` could already RECORD a holdover (the CHECK deliberately has no upper
-- bound) and the unit timeline reported "held over N days". What was missing is that no
-- rent was generated for those months, at any rate — a tenant overstaying produced zero
-- revenue in the system.
--
-- Client decision 2026-08-13: notify Founder/Super Admin, and bill the SAME rent.

-- Percentage of the last paying rent, applied to months after leaseEnd.
-- 100 = same rent, per the decision. Stored as a rate rather than a flag so the commoner
-- commercial practice (125-150%, charged to discourage overstaying) is later data entry
-- on the lease rather than a schema change.
ALTER TABLE "leases"
    ADD COLUMN "holdoverRatePct" DECIMAL(6,2) DEFAULT 100;

-- A negative or zero holdover rate is not a discount, it is a mistake: it would generate
-- zero-rent months indistinguishable from free rent.
ALTER TABLE "leases"
    ADD CONSTRAINT "lease_holdover_rate_positive"
    CHECK ("holdoverRatePct" IS NULL OR "holdoverRatePct" > 0);

-- Must be added here AND in schema.prisma. A value present in the DB but missing from the
-- enum is invisible to Object.values(NotificationType), so it never appears in
-- getPreferences() and nobody can mute it — the lesson recorded on
-- 20260729120000_add_notification_types_l3.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEASE_HOLDOVER';
