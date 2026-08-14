-- H0 — Unit occupancy foundation.
--
-- Three things, in order:
--   1. unit_status_events: the append-only occupancy log.
--   2. A bootstrap row per existing unit, so every unit has a history from day one
--      rather than history starting whenever it is next touched.
--   3. Replace the "one non-terminal lease per unit" partial unique index with a real
--      date-range overlap constraint, so historical leases can be entered.
--
-- Hand-written rather than `prisma migrate dev`-generated: steps 2 and 3 are data and
-- constraint semantics that Prisma cannot express.

-- ---------------------------------------------------------------------------
-- 1. The log
-- ---------------------------------------------------------------------------

CREATE TABLE "unit_status_events" (
    "id"           TEXT NOT NULL,
    "unitId"       TEXT NOT NULL,
    "fromStatus"   "UnitStatus",
    "toStatus"     "UnitStatus" NOT NULL,
    "effectiveAt"  TIMESTAMP(3) NOT NULL,
    "recordedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source"       TEXT NOT NULL,
    "leaseId"      TEXT,
    "saleId"       TEXT,
    "reason"       TEXT,
    "isHistorical" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" TEXT,

    CONSTRAINT "unit_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "unit_status_events_unitId_effectiveAt_idx"
    ON "unit_status_events"("unitId", "effectiveAt");
CREATE INDEX "unit_status_events_toStatus_effectiveAt_idx"
    ON "unit_status_events"("toStatus", "effectiveAt");

ALTER TABLE "unit_status_events"
    ADD CONSTRAINT "unit_status_events_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "unit_status_events"
    ADD CONSTRAINT "unit_status_events_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Bootstrap: one event per existing unit
--
-- fromStatus is NULL — we genuinely do not know what came before, and inventing a
-- prior state would be worse than admitting the gap.
--
-- effectiveAt prefers availableSince over createdAt because, where it is set, it is
-- the one real transition timestamp we have. It is set on only 2 of 499 units, which
-- is precisely why this table exists.
--
-- Soft-deleted units are included: their history is the reason they were kept.
-- ---------------------------------------------------------------------------

INSERT INTO "unit_status_events"
    ("id", "unitId", "fromStatus", "toStatus", "effectiveAt", "recordedAt", "source", "reason")
SELECT
    -- gen_random_uuid() is pgcrypto/PG13+ builtin; ids here are never app-generated
    -- so cuid-vs-uuid shape does not matter, only uniqueness.
    gen_random_uuid()::text,
    u."id",
    NULL,
    u."status",
    COALESCE(u."availableSince", u."createdAt"),
    CURRENT_TIMESTAMP,
    'SYSTEM',
    'Bootstrap row created by migration 20260812000000 — the unit''s state at the time '
      || 'the occupancy log was introduced. No prior transitions were recorded.'
FROM "units" u
WHERE NOT EXISTS (
    SELECT 1 FROM "unit_status_events" e WHERE e."unitId" = u."id"
);

-- ---------------------------------------------------------------------------
-- 3. Lease overlap constraint replaces the active-lease unique index
--
-- The old index allowed at most ONE lease per unit outside (EXPIRED, TERMINATED).
-- That is a proxy for "no double-booking" that breaks the moment history exists: a
-- unit with three past tenancies has three leases, and entering the second one was
-- rejected outright.
--
-- The real rule is that two leases on one unit must not overlap IN TIME. A daterange
-- exclusion constraint says exactly that and nothing more.
--
-- '[)' bounds — inclusive start, exclusive end — make back-to-back leases legal:
-- A ending 2025-06-30 and B starting 2025-06-30 do not collide. Same-day turnover is
-- real and the old index had no opinion on it either way.
--
-- Verified before writing this: zero overlapping pairs exist in live data.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP INDEX IF EXISTS "lease_unit_active_unique";

ALTER TABLE "leases"
    ADD CONSTRAINT "lease_unit_no_overlap"
    EXCLUDE USING gist (
        "unitId" WITH =,
        daterange("leaseStart"::date, "leaseEnd"::date, '[)') WITH &&
    )
    WHERE ("unitId" IS NOT NULL AND "deletedAt" IS NULL);
