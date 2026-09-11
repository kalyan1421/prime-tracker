-- Read-only health check for the three defects fixed on 2026-09-12.
-- Safe to run against production: SELECTs only, no writes.
--
--   psql "$DATABASE_URL" -f scripts/check-deal-data-health.sql
--
-- 1 and 3 are fixed in CODE (deploying is the whole fix — nothing to repair).
-- 2 is a DATA question: only a repair can correct rows already written.

\echo '== 1. Ghost leases/sales on soft-deleted units (fixed in code; counts should now be excluded from every view) =='
SELECT p.name AS project,
       count(*) FILTER (WHERE src = 'lease') AS ghost_leases,
       to_char(coalesce(sum(amount) FILTER (WHERE src = 'lease'), 0), 'FM999,999,990.00') AS ghost_rent_per_month,
       count(*) FILTER (WHERE src = 'sale')  AS ghost_sales,
       to_char(coalesce(sum(amount) FILTER (WHERE src = 'sale'), 0), 'FM999,999,990.00') AS ghost_sale_value
FROM (
  SELECT 'lease' AS src, l."monthlyRent" AS amount, u."buildingId"
    FROM leases l JOIN units u ON u.id = l."unitId"
   WHERE l."deletedAt" IS NULL AND l.status = 'ACTIVE' AND u."deletedAt" IS NOT NULL
  UNION ALL
  SELECT 'sale', s."salePrice", u."buildingId"
    FROM sales s JOIN units u ON u.id = s."unitId"
   WHERE s."deletedAt" IS NULL AND u."deletedAt" IS NOT NULL
) x
JOIN buildings b ON b.id = x."buildingId"
JOIN projects p ON p.id = b."projectId" AND p."deletedAt" IS NULL
GROUP BY p.name ORDER BY p.name;

\echo ''
\echo '== 2. Deposit recorded more than once across one deal (NEEDS A DATA REPAIR if any rows return) =='
-- One deal holds ONE deposit. More than one member carrying the same figure means it was
-- copied per unit, and every "deposits held" total is overstated by the repeat count.
SELECT l."combinedDealRef" AS deal,
       p.name              AS project,
       count(*)            AS members_with_a_deposit,
       to_char(max(l."securityDeposit"), 'FM999,999,990.00') AS real_deposit,
       to_char(sum(l."securityDeposit"), 'FM999,999,990.00') AS currently_recorded
FROM leases l
JOIN units u     ON u.id = l."unitId"     AND u."deletedAt" IS NULL
JOIN buildings b ON b.id = u."buildingId" AND b."deletedAt" IS NULL
JOIN projects p  ON p.id = b."projectId"  AND p."deletedAt" IS NULL
WHERE l."deletedAt" IS NULL
  AND l."combinedDealRef" IS NOT NULL
  AND l."securityDeposit" IS NOT NULL
GROUP BY 1, 2
HAVING count(*) > 1 AND count(DISTINCT l."securityDeposit") = 1
ORDER BY 2, 1;

\echo ''
\echo '== 3. Sold units whose tenancy history generated no ledger (fixed in code; re-generate to backfill) =='
SELECT p.name AS project, u."unitNumber", l."tenantName",
       to_char(l."leaseStart", 'YYYY-MM-DD') AS lease_start,
       coalesce(to_char(l."terminationDate", 'YYYY-MM-DD'), '(still running)') AS moved_out
FROM leases l
JOIN units u     ON u.id = l."unitId"     AND u."deletedAt" IS NULL
JOIN buildings b ON b.id = u."buildingId"
JOIN projects p  ON p.id = b."projectId"  AND p."deletedAt" IS NULL
WHERE l."deletedAt" IS NULL
  AND u.status = 'SOLD'
  AND l."terminationDate" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM lease_rent_invoices i WHERE i."leaseId" = l.id)
ORDER BY 1, 2;
