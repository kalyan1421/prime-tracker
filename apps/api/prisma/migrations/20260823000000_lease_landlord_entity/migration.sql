-- R9 field-gap audit (2026-08-23): the client's real rent-roll sheet names a different
-- owning LLC per lease ("Texas Hazelwood OP 2 LLC" etc.) — mirrors Sale.seller, added the
-- same day for the same reason (free text, no structured owning-entity model in v1).
ALTER TABLE "leases" ADD COLUMN "landlordEntity" TEXT;
