-- NNN becomes a ONE-TIME charge at lease signing, not a monthly component of rent.
--
-- Client-confirmed 2026-08-12, reversing the rule recorded on 2026-07-29. NNN was a
-- column on every rent period, folded into `monthlyRent` under the invariant
-- `monthlyRent = baseRent + nnnAmount`, and therefore billed every month by the invoice
-- generator. Prime charges it once, up front.
--
-- A one-time agreed sum settled by one or more payments is exactly what LeaseObligation
-- already models (the same shape as a security deposit), so NNN moves there rather than
-- getting a parallel mechanism of its own. `Lease.nnnPerSqft` / `nnnTotalAmount` remain
-- as the headline TERMS, mirroring how `securityDeposit` sits beside its obligation.
--
-- Safe to do now precisely because it is early: ONE rent period in the database carried
-- a non-zero NNN ($150, on a QA fixture lease) and NO lease used nnnPerSqft. Waiting
-- until real leases carried NNN would have made this a reconciliation exercise instead
-- of a rename.

-- ---------------------------------------------------------------------------
-- 1. Preserve the money before dropping the column that holds it.
--
-- The surviving figure was a MONTHLY rate, and a one-time total is not derivable from
-- it — 150/month could mean 1,800 a year or a 150 one-off, and guessing would put an
-- invented number in a ledger. The amount is carried across as-is with a note saying
-- exactly that, so a human corrects it rather than inheriting a fabrication.
-- ---------------------------------------------------------------------------

INSERT INTO "lease_obligations"
  ("id", "leaseId", "kind", "direction", "totalAmount", "paidAmount", "status", "notes", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."leaseId",
  'NNN',
  'FROM_TENANT',
  p."nnnAmount",
  0,
  'PENDING',
  'Migrated from a monthly NNN of ' || to_char(p."nnnAmount", 'FM999999990.00')
    || ' on the rent schedule (migration 20260812160000). NNN is now charged once at '
    || 'signing — VERIFY this total is the correct one-time amount, not the monthly rate.',
  now(),
  now()
FROM "lease_rent_periods" p
WHERE p."nnnAmount" > 0
  -- One NNN obligation per lease even when several periods carried the figure.
  AND NOT EXISTS (
    SELECT 1 FROM "lease_obligations" o WHERE o."leaseId" = p."leaseId" AND o."kind" = 'NNN'
  );

-- ---------------------------------------------------------------------------
-- 2. Rent is base rent alone from here on.
--
-- monthlyRent is rewritten to baseRent so the new invariant holds for every existing
-- row. Rows where NNN was already zero are unaffected — the vast majority.
-- ---------------------------------------------------------------------------

UPDATE "lease_rent_periods" SET "monthlyRent" = "baseRent" WHERE "monthlyRent" <> "baseRent";

ALTER TABLE "lease_rent_periods" DROP COLUMN "nnnAmount";

-- ---------------------------------------------------------------------------
-- 3. `nnnMonthly` no longer describes what it holds.
--
-- Renamed rather than dropped-and-recreated so that if anything ever does land in it,
-- the value travels with the column instead of being silently discarded.
-- ---------------------------------------------------------------------------

ALTER TABLE "leases" RENAME COLUMN "nnnMonthly" TO "nnnTotalAmount";
