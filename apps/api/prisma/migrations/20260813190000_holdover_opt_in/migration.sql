-- Holdover billing is OPT-IN per lease. Corrects 20260813180000, which defaulted the
-- rate to 100 and would therefore have billed automatically.
--
-- Why this matters more than it looks:
--
--   The system cannot tell "this tenant is genuinely holding over" from "nobody
--   remembered to close this lease". Both look identical — ACTIVE, past leaseEnd, no
--   terminationDate. With a default of 100, the nightly cron would have started
--   generating real invoices against every stale lease in the database, and because
--   generation is idempotent on (leaseId, periodMonth) those invoices are PERMANENT.
--
--   The client asked to bill the same rent, and that is what a rate of 100 does. It did
--   NOT ask to bill every lease somebody forgot to close.
--
-- So: the NOTIFICATION fires for every holdover (leadership always learns about it), and
-- the BILLING happens only where a person has set a rate on that lease. Setting it to
-- 100 is one click and means "same rent", exactly as asked.
--
-- If Prime later wants every lease to bill holdover automatically:
--   UPDATE "leases" SET "holdoverRatePct" = 100 WHERE "holdoverRatePct" IS NULL;

ALTER TABLE "leases" ALTER COLUMN "holdoverRatePct" DROP DEFAULT;

-- Every current value came from that default seconds ago, not from a person, so there is
-- no deliberate setting to preserve.
UPDATE "leases" SET "holdoverRatePct" = NULL;
