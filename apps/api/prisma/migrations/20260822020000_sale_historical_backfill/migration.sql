-- R4: historical sale entry (manual backfill for closed sales), mirroring Lease.isHistorical.
ALTER TABLE "sales" ADD COLUMN "isHistorical" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sales" ADD COLUMN "seller" TEXT;
