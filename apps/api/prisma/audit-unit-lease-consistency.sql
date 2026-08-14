-- ============================================================================
-- Unit status vs. lease reality — READ-ONLY audit.
--
-- Run this against PRODUCTION before running the repair script. It is the same
-- classification as prisma/fix-unit-lease-consistency.ts, expressed as plain SQL so it
-- needs no Node, no Prisma client and no deploy — just psql and a read-only connection.
--
--   psql "$DATABASE_URL" -f prisma/audit-unit-lease-consistency.sql
--
-- Nothing here writes. Every statement is a SELECT; there is no transaction to
-- accidentally leave open and nothing to roll back.
--
-- WHY IT EXISTS: until 2026-08-13 nothing ever set Unit.status from a lease, so the
-- field drifted. The code fix stops new drift; this measures what the old drift left
-- behind, on the only dataset whose answer matters.
--
-- The four buckets, and which one can be fixed mechanically:
--   B — AVAILABLE with a live ACTIVE lease   → SAFE TO FIX. A signed active lease is
--       positive evidence somebody is in there; the status is the field with nothing
--       behind it.
--   A — tenanted with NO live lease          → NEEDS A HUMAN. Either the unit is empty
--       and the status is stale, or a real tenancy was never entered. The second costs
--       money: an un-entered tenancy is un-billed rent.
--   C — SOLD with a live lease               → NEEDS A HUMAN. Either the sale is wrong
--       or the lease should have been terminated at closing. Both are real events with
--       money attached.
--   D — term expired but still ACTIVE        → NEEDS A HUMAN. Did they leave, or are
--       they holding over? Only somebody who called the tenant knows.
--
-- Soft-deleted projects, buildings, units and leases are excluded THROUGHOUT. Leaving
-- them in inflated an early count by roughly ten times — 471 of 529 units sat under
-- soft-deleted projects — and every one of those rows is a unit nobody will ever open.
-- ============================================================================

\echo ''
\echo '=== Unit status vs. lease reality ================================='
\echo ''

-- A lease that is live RIGHT NOW: not expired, not terminated, no move-out recorded,
-- not soft-deleted. Defined once so every bucket below asks the same question.
WITH live_lease AS (
    SELECT l.*
    FROM leases l
    WHERE l."deletedAt" IS NULL
      AND l.status NOT IN ('EXPIRED', 'TERMINATED')
      AND l."terminationDate" IS NULL
),
portfolio_unit AS (
    SELECT
        u.id,
        u."unitNumber",
        u.status,
        b.name  AS building_name,
        p.name  AS project_name
    FROM units u
    JOIN buildings b ON b.id = u."buildingId" AND b."deletedAt" IS NULL
    JOIN projects  p ON p.id = b."projectId"  AND p."deletedAt" IS NULL
    WHERE u."deletedAt" IS NULL
),
classified AS (
    SELECT
        pu.*,
        (SELECT count(*) FROM live_lease ll WHERE ll."unitId" = pu.id) AS live_leases,
        (SELECT count(*) FROM live_lease ll WHERE ll."unitId" = pu.id AND ll.status = 'ACTIVE') AS active_leases
    FROM portfolio_unit pu
)
SELECT
    CASE
        WHEN status = 'AVAILABLE' AND active_leases > 0                          THEN 'B — fixable: AVAILABLE with an ACTIVE lease'
        WHEN status IN ('LEASED', 'OCCUPIED', 'LEASE_PENDING') AND live_leases = 0 THEN 'A — decision: tenanted, no live lease'
        WHEN status = 'SOLD' AND live_leases > 0                                 THEN 'C — decision: SOLD with a live lease'
        ELSE 'consistent'
    END AS bucket,
    count(*) AS units
FROM classified
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '--- B. AVAILABLE with a live ACTIVE lease (safe to fix) -----------'

SELECT p.name AS project, b.name AS building, u."unitNumber" AS unit,
       l."tenantName", l."leaseEnd"::date
FROM units u
JOIN buildings b ON b.id = u."buildingId" AND b."deletedAt" IS NULL
JOIN projects  p ON p.id = b."projectId"  AND p."deletedAt" IS NULL
JOIN leases    l ON l."unitId" = u.id
                AND l."deletedAt" IS NULL
                AND l.status = 'ACTIVE'
                AND l."terminationDate" IS NULL
WHERE u."deletedAt" IS NULL AND u.status = 'AVAILABLE'
ORDER BY p.name, b.name, u."unitNumber";

\echo ''
\echo '--- A. tenanted with NO live lease (needs a human) ----------------'
\echo '    Stale status, or a tenancy nobody entered? The second is un-billed rent.'

SELECT p.name AS project, b.name AS building, u."unitNumber" AS unit, u.status
FROM units u
JOIN buildings b ON b.id = u."buildingId" AND b."deletedAt" IS NULL
JOIN projects  p ON p.id = b."projectId"  AND p."deletedAt" IS NULL
WHERE u."deletedAt" IS NULL
  AND u.status IN ('LEASED', 'OCCUPIED', 'LEASE_PENDING')
  AND NOT EXISTS (
      SELECT 1 FROM leases l
      WHERE l."unitId" = u.id
        AND l."deletedAt" IS NULL
        AND l.status NOT IN ('EXPIRED', 'TERMINATED')
        AND l."terminationDate" IS NULL
  )
ORDER BY p.name, b.name, u."unitNumber";

\echo ''
\echo '--- C. SOLD with a live lease (needs a human) ---------------------'
\echo '    Wrong sale, or a lease never closed at completion? Money either way.'

SELECT p.name AS project, b.name AS building, u."unitNumber" AS unit,
       l."tenantName", l.status AS lease_status, l."leaseEnd"::date,
       s."closingDate"::date AS sale_closed
FROM units u
JOIN buildings b ON b.id = u."buildingId" AND b."deletedAt" IS NULL
JOIN projects  p ON p.id = b."projectId"  AND p."deletedAt" IS NULL
JOIN leases    l ON l."unitId" = u.id
                AND l."deletedAt" IS NULL
                AND l.status NOT IN ('EXPIRED', 'TERMINATED')
                AND l."terminationDate" IS NULL
LEFT JOIN LATERAL (
    SELECT s."closingDate" FROM sales s
    WHERE s."unitId" = u.id AND s.status = 'CLOSED' AND s."deletedAt" IS NULL
    ORDER BY s."closingDate" DESC LIMIT 1
) s ON true
WHERE u."deletedAt" IS NULL AND u.status = 'SOLD'
ORDER BY p.name, b.name, u."unitNumber";

\echo ''
\echo '--- D. term expired but the lease is still ACTIVE (needs a human) -'
\echo '    Holdover, or a move-out nobody recorded? Only a phone call settles it.'

SELECT p.name AS project, b.name AS building, u."unitNumber" AS unit,
       l."tenantName", l."leaseEnd"::date,
       (CURRENT_DATE - l."leaseEnd"::date) AS days_over
FROM leases l
JOIN units     u ON u.id = l."unitId"      AND u."deletedAt" IS NULL
JOIN buildings b ON b.id = u."buildingId"  AND b."deletedAt" IS NULL
JOIN projects  p ON p.id = b."projectId"   AND p."deletedAt" IS NULL
WHERE l."deletedAt" IS NULL
  AND l.status = 'ACTIVE'
  AND l."terminationDate" IS NULL
  AND l."leaseEnd" < CURRENT_DATE
ORDER BY (CURRENT_DATE - l."leaseEnd"::date) DESC;

\echo ''
\echo '=== end ==========================================================='
\echo ''
