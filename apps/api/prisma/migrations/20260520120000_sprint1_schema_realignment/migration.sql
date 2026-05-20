-- Sprint 1 — Schema realignment to match real client data shape
--
-- Surfaced by analyzing the client's project spreadsheet (Prime Developers.xlsx):
--   * Rio Ranch has no buildings — only lots sized in acres.
--   * Leander Building 1 is one tenant occupying the whole building.
--   * Centro Plaza loans attach per-building (different rates + closing dates).
--   * Lewisville P1 uses "Owner Occupied" as a leased state.
--   * Units carry separate floor + mezzanine areas.
--   * Spreadsheet legend includes a "🔵 Lease Pending" unit status.
--
-- This migration is ADDITIVE:
--   * All new columns are nullable. No data loss possible.
--   * Existing NOT NULL columns relaxed: `sales.unitId`, `leases.unitId`,
--     `loans.projectId` become nullable so the polymorphic FK pattern works.
--     Every existing row still has the original value populated; only NEW rows
--     can use the new path (building-level instead of unit-level).
--   * Service-layer code (LeadsService etc.) enforces that exactly one of
--     (unitId, buildingId) is set per row.

-- ── Enum additions ────────────────────────────────────────────────────────
ALTER TYPE "BuildingType" ADD VALUE 'LOT';
ALTER TYPE "UnitType"     ADD VALUE 'COMMERCIAL_LOT';
ALTER TYPE "UnitStatus"   ADD VALUE 'LEASE_PENDING';
ALTER TYPE "LeaseStatus"  ADD VALUE 'OWNER_OCCUPIED';

-- ── buildings: acreage for LOT-type buildings ─────────────────────────────
ALTER TABLE "buildings"
    ADD COLUMN "acreage" DECIMAL(10, 3);

-- ── units: floor + mezzanine areas ────────────────────────────────────────
ALTER TABLE "units"
    ADD COLUMN "floorArea"     DECIMAL(10, 2),
    ADD COLUMN "mezzanineArea" DECIMAL(10, 2);

-- ── leases: polymorphic asset link + tenant legal name / brand ────────────
-- Drop NOT NULL on unitId (FK constraint preserved). Add buildingId FK.
ALTER TABLE "leases"
    ALTER COLUMN "unitId" DROP NOT NULL,
    ADD COLUMN "buildingId"      TEXT,
    ADD COLUMN "tenantLegalName" TEXT,
    ADD COLUMN "tenantBrand"     TEXT;

ALTER TABLE "leases"
    ADD CONSTRAINT "leases_buildingId_fkey"
    FOREIGN KEY ("buildingId") REFERENCES "buildings"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE INDEX "leases_buildingId_idx" ON "leases"("buildingId");

-- ── sales: polymorphic asset link ─────────────────────────────────────────
ALTER TABLE "sales"
    ALTER COLUMN "unitId" DROP NOT NULL,
    ADD COLUMN "buildingId" TEXT;

ALTER TABLE "sales"
    ADD CONSTRAINT "sales_buildingId_fkey"
    FOREIGN KEY ("buildingId") REFERENCES "buildings"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE INDEX "sales_buildingId_idx" ON "sales"("buildingId");

-- ── leads: building-level lead support ────────────────────────────────────
ALTER TABLE "leads"
    ADD COLUMN "buildingId" TEXT;

ALTER TABLE "leads"
    ADD CONSTRAINT "leads_buildingId_fkey"
    FOREIGN KEY ("buildingId") REFERENCES "buildings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "leads_buildingId_idx" ON "leads"("buildingId");

-- ── loans: per-building loans + optional project link ─────────────────────
ALTER TABLE "loans"
    ALTER COLUMN "projectId" DROP NOT NULL,
    ADD COLUMN "buildingId" TEXT;

ALTER TABLE "loans"
    ADD CONSTRAINT "loans_buildingId_fkey"
    FOREIGN KEY ("buildingId") REFERENCES "buildings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "loans_buildingId_idx" ON "loans"("buildingId");
