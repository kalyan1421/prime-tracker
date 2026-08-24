-- NNN reverts to a monthly component of rent (client-confirmed 2026-08-21), reversing
-- migration 20260812160000_nnn_one_time. Restores the `nnnAmount` column removed there;
-- existing rows default to 0, which is corrected by prisma/fix-nnn-monthly-migration.ts
-- for the handful of leases that got a one-time NNN obligation in the 9-day interim.
ALTER TABLE "lease_rent_periods" ADD COLUMN "nnnAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
