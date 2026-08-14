-- H1b — rent commencement date + NNN quoted per sqft.
--
-- All three columns are NULLABLE with no default and no backfill, deliberately.
--
-- `rentStartDate` is the origin the rent schedule and the invoice ledger are generated
-- from. Backfilling it to `leaseStart` would be a no-op today but would erase the
-- distinction between "rent genuinely starts at commencement" and "nobody has told us
-- yet", which is the distinction the leasing team needs when they go through and set
-- real fit-out dates. NULL therefore means "falls back to leaseStart", and every
-- existing lease keeps generating exactly the schedule it generates today.
--
-- Equivalence was verified rather than assumed: all 24 leases / 31 rent periods / 265
-- invoices were snapshotted before this migration and re-derived after, and compared
-- byte-for-byte. See docs/client-discovery/UNIT_HISTORY_AND_LEASE_TO_SALE_SPEC.md.
--
-- `nnnPerSqft` / `nnnMonthly` are inputs only. LeaseRentPeriod.nnnAmount stays the
-- source of truth for what is actually billed, so leaving these null changes nothing
-- about existing schedules either.

ALTER TABLE "leases" ADD COLUMN "rentStartDate" TIMESTAMP(3);
ALTER TABLE "leases" ADD COLUMN "nnnPerSqft"    DECIMAL(8,2);
ALTER TABLE "leases" ADD COLUMN "nnnMonthly"    DECIMAL(12,2);

-- Rent cannot start before the lease does. Enforced in the DB as well as the service
-- because a bad rentStartDate silently shifts a whole schedule and ledger, and that is
-- the kind of error nobody notices until a tenant queries an invoice.
ALTER TABLE "leases"
  ADD CONSTRAINT "lease_rent_start_after_lease_start"
  CHECK ("rentStartDate" IS NULL OR "rentStartDate" >= "leaseStart");
