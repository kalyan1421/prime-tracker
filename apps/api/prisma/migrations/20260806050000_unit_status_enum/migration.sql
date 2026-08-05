-- Unit.status: text -> UnitStatus enum.
--
-- Every value currently in the column is already one of these seven (audited:
-- AVAILABLE 207, SOLD 185, LEASED 65, OCCUPIED 33, UNDER_CONTRACT 3), so the USING cast
-- cannot fail. LEASE_PENDING and UNDER_CONSTRUCTION are unused in data but are rendered
-- by the UI, so they are part of the type.
--
-- The default has to be dropped before the type change: a text default cannot be cast
-- implicitly, and Postgres rejects ALTER TYPE while it is attached.
CREATE TYPE "UnitStatus" AS ENUM (
  'AVAILABLE', 'UNDER_CONTRACT', 'LEASE_PENDING', 'LEASED',
  'OCCUPIED', 'SOLD', 'UNDER_CONSTRUCTION'
);

ALTER TABLE "units" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "units" ALTER COLUMN "status" TYPE "UnitStatus" USING "status"::"UnitStatus";
ALTER TABLE "units" ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';
