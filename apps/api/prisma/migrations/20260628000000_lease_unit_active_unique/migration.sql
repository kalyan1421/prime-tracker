-- Enforce at most one non-expired, non-terminated lease per unit.
-- This is a partial unique index so it only applies when unitId is set
-- and the lease is not in a terminal state.
CREATE UNIQUE INDEX IF NOT EXISTS "lease_unit_active_unique"
  ON "Lease"("unitId")
  WHERE "unitId" IS NOT NULL
    AND "status" NOT IN ('EXPIRED', 'TERMINATED');
