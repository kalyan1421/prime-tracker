/**
 * QA fixtures for UNIT OCCUPANCY HISTORY — one building, one unit per edge case.
 *
 * Attaches a "B-DELTA — Unit History" building to the existing "QA — Building Fixtures"
 * project (seed-qa-building.ts), so everything synthetic still lives under one project
 * that can be deleted whole. Run the building seed first.
 *
 * Every unit here exists to make ONE claim falsifiable. The unit number encodes the
 * case so a failing assertion names the scenario:
 *
 *   H-01  bootstrap only — never leased, never sold. The "history starts here" case.
 *   H-02  vacant then leased — the vacancy BEFORE the first lease, which the old
 *         client-side derivation could not see at all.
 *   H-03  re-let with a gap — vacancy BETWEEN two tenancies.
 *   H-04  back-to-back — lease B starts the day lease A ends. Must be allowed by the
 *         overlap constraint and must NOT invent a zero-day vacancy.
 *   H-05  fit-out gap — rent commences 3 months after the lease does. No period and no
 *         invoice may exist before rent commencement.
 *   H-06  free rent — 2 abated months inside the term. ONE free_rent entry, never a
 *         $X -> $0 -> $X pair.
 *   H-07  escalations — a schedule running years out. Future rows must read as upcoming.
 *   H-08  manual rent change — a mid-term renegotiation with a reason and an author.
 *   H-09  sold cleanly — lease TERMINATED at the sale. No warning, no suppression.
 *   H-10  sold with the lease left ACTIVE — the live defect. Warning + suppression.
 *   H-11  cancelled sale — the unit must be released back to AVAILABLE.
 *   H-12  under construction — a window narrated by neither a lease nor a sale.
 *   H-13  backfilled out of order — effectiveAt long before recordedAt. Must sort by
 *         real-world date, not write order.
 *   H-14  same-instant flips — a zero-length window that must collapse.
 *   H-15  future-dated event — must clamp to 0 days, never negative.
 *   H-16  soft-deleted lease — must be absent from the history entirely.
 *   H-17  zero-sqft unit — the NNN-per-sqft divisor edge.
 *
 * Idempotent: deletes and rebuilds its own building.
 *
 *   npx tsx prisma/seed-qa-unit-history.ts
 *   npx tsx prisma/seed-qa-unit-history.ts --reset
 */
import { PrismaClient, UnitStatus } from '@prisma/client';

const prisma = new PrismaClient();
const PROJECT_SLUG = 'qa-building-fixtures';
const BUILDING_NAME = 'B-DELTA — Unit History';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Anchored to a fixed date so assertions are stable, not "whatever today is". */
const T0 = day('2026-08-12');
const daysFrom = (base: Date, n: number) => new Date(base.getTime() + n * 86_400_000);

type EventSpec = {
  from: UnitStatus | null;
  to: UnitStatus;
  at: Date;
  source?: string;
  recordedAt?: Date;
};

async function main() {
  const reset = process.argv.includes('--reset');

  const project = await prisma.project.findUnique({ where: { slug: PROJECT_SLUG } });
  if (!project) {
    throw new Error(
      `Project "${PROJECT_SLUG}" not found. Run: npx tsx prisma/seed-qa-building.ts`,
    );
  }

  const prior = await prisma.building.findFirst({
    where: { projectId: project.id, name: BUILDING_NAME },
  });
  if (prior) {
    // Units cascade from the building; leases/sales/events cascade or FK-null from units.
    await prisma.lease.deleteMany({ where: { unit: { buildingId: prior.id } } });
    await prisma.sale.deleteMany({ where: { unit: { buildingId: prior.id } } });
    await prisma.building.delete({ where: { id: prior.id } });
    console.log('removed previous B-DELTA fixture');
  }
  if (reset) {
    console.log('--reset: history fixtures removed, nothing rebuilt.');
    return;
  }

  const author = await prisma.user.findFirst({
    where: { isActive: true, role: { in: ['SUPER_ADMIN', 'FOUNDER'] } },
    select: { id: true },
  });

  const building = await prisma.building.create({
    data: {
      projectId: project.id,
      name: BUILDING_NAME,
      buildingType: 'RETAIL',
      stories: 1,
      totalSqft: 20_000,
      phase: 'STABILIZED',
    },
  });

  /** A unit plus its occupancy log, written directly — this seeds history, not live flips. */
  async function unit(
    unitNumber: string,
    status: UnitStatus,
    events: EventSpec[],
    sqft: number | null = 1_000,
  ) {
    const u = await prisma.unit.create({
      data: {
        buildingId: building.id,
        unitNumber,
        unitType: 'RETAIL',
        status,
        sqft: sqft ?? undefined,
        // Left null on purpose across the board: the point of the occupancy log is that
        // this column cannot answer the question, and a populated value here would let a
        // fallback path pass a test the log is supposed to own.
        availableSince: null,
      },
    });
    for (const e of events) {
      await prisma.unitStatusEvent.create({
        data: {
          unitId: u.id,
          fromStatus: e.from,
          toStatus: e.to,
          effectiveAt: e.at,
          recordedAt: e.recordedAt ?? e.at,
          source: e.source ?? 'MANUAL',
        },
      });
    }
    return u;
  }

  const leaseBase = (unitId: string, tenantName: string) => ({
    unitId,
    tenantName,
    tenantLegalName: `${tenantName} LLC`,
    tenantBrand: tenantName,
    rentDueDay: 1,
  });

  // ---- H-01 bootstrap only --------------------------------------------------
  await unit('H-01', 'AVAILABLE', [
    { from: null, to: 'AVAILABLE', at: day('2026-06-01'), source: 'SYSTEM' },
  ]);

  // ---- H-02 vacancy before the first lease ----------------------------------
  {
    const u = await unit('H-02', 'LEASED', [
      { from: null, to: 'AVAILABLE', at: day('2025-01-01'), source: 'SYSTEM' },
      { from: 'AVAILABLE', to: 'LEASED', at: day('2025-07-01'), source: 'LEASE_ACTIVATED' },
    ]);
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Northwind Coffee'),
        monthlyRent: 4_000, leaseStart: day('2025-07-01'), leaseEnd: day('2028-07-01'),
        termMonths: 36, status: 'ACTIVE',
      },
    });
  }

  // ---- H-03 re-let with a vacancy between tenancies --------------------------
  {
    const u = await unit('H-03', 'LEASED', [
      { from: null, to: 'AVAILABLE', at: day('2023-01-01'), source: 'SYSTEM' },
      { from: 'AVAILABLE', to: 'LEASED', at: day('2023-03-01'), source: 'LEASE_ACTIVATED' },
      { from: 'LEASED', to: 'AVAILABLE', at: day('2025-03-01'), source: 'LEASE_ENDED' },
      { from: 'AVAILABLE', to: 'LEASED', at: day('2025-09-01'), source: 'LEASE_ACTIVATED' },
    ]);
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'First Tenant'),
        monthlyRent: 3_000, leaseStart: day('2023-03-01'), leaseEnd: day('2025-03-01'),
        termMonths: 24, status: 'EXPIRED',
      },
    });
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Second Tenant'),
        monthlyRent: 3_600, leaseStart: day('2025-09-01'), leaseEnd: day('2028-09-01'),
        termMonths: 36, status: 'ACTIVE',
      },
    });
  }

  // ---- H-04 back-to-back, no turnover gap ------------------------------------
  {
    const u = await unit('H-04', 'LEASED', [
      { from: null, to: 'LEASED', at: day('2024-01-01'), source: 'SYSTEM' },
    ]);
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Outgoing Tenant'),
        monthlyRent: 2_500, leaseStart: day('2024-01-01'), leaseEnd: day('2026-01-01'),
        termMonths: 24, status: 'EXPIRED',
      },
    });
    // Starts the exact day the previous one ends — legal under the '[)' exclusion
    // constraint, and the case a naive lte/gte overlap check would wrongly reject.
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Incoming Tenant'),
        monthlyRent: 2_800, leaseStart: day('2026-01-01'), leaseEnd: day('2029-01-01'),
        termMonths: 36, status: 'ACTIVE',
      },
    });
  }

  // ---- H-05 fit-out gap ------------------------------------------------------
  {
    const u = await unit('H-05', 'LEASED', [
      { from: null, to: 'AVAILABLE', at: day('2025-10-01'), source: 'SYSTEM' },
      { from: 'AVAILABLE', to: 'LEASE_PENDING', at: day('2026-01-01'), source: 'MANUAL' },
      { from: 'LEASE_PENDING', to: 'LEASED', at: day('2026-04-01'), source: 'LEASE_ACTIVATED' },
    ]);
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Fitout Tenant'),
        monthlyRent: 5_000,
        leaseStart: day('2026-01-01'),
        rentStartDate: day('2026-04-01'), // 90 days of fit-out
        leaseEnd: day('2029-01-01'),
        termMonths: 33, status: 'ACTIVE',
      },
    });
  }

  // ---- H-06 free rent inside the term ---------------------------------------
  {
    const u = await unit('H-06', 'LEASED', [
      { from: null, to: 'LEASED', at: day('2026-01-01'), source: 'SYSTEM' },
    ]);
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Abated Tenant'),
        monthlyRent: 6_000, leaseStart: day('2026-01-01'), leaseEnd: day('2029-01-01'),
        termMonths: 36, status: 'ACTIVE',
        freeRentMonths: 2, freeRentStartDate: day('2026-01-01'),
      },
    });
  }

  // ---- H-07 escalating schedule ---------------------------------------------
  {
    const u = await unit('H-07', 'LEASED', [
      { from: null, to: 'LEASED', at: day('2025-01-01'), source: 'SYSTEM' },
    ]);
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Escalating Tenant'),
        monthlyRent: 10_000, leaseStart: day('2025-01-01'), leaseEnd: day('2030-01-01'),
        termMonths: 60, status: 'ACTIVE',
        escalationPct: 3, escalationFreq: 12,
      },
    });
  }

  // ---- H-08 manual mid-term renegotiation ------------------------------------
  {
    const u = await unit('H-08', 'LEASED', [
      { from: null, to: 'LEASED', at: day('2025-01-01'), source: 'SYSTEM' },
    ]);
    const l = await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Renegotiated Tenant'),
        monthlyRent: 8_000, leaseStart: day('2025-01-01'), leaseEnd: day('2028-01-01'),
        termMonths: 36, status: 'ACTIVE',
      },
    });
    await prisma.leaseRentPeriod.createMany({
      data: [
        {
          leaseId: l.id, sequence: 1, startDate: day('2025-01-01'), endDate: day('2025-12-31'),
          baseRent: 8_000, monthlyRent: 8_000, isFreeRent: false, source: 'INITIAL',
        },
        {
          leaseId: l.id, sequence: 2, startDate: day('2026-01-01'), endDate: null,
          baseRent: 7_200, monthlyRent: 7_200, isFreeRent: false, source: 'MANUAL',
          reason: 'Rent reduced — tenant hardship, agreed with Founder',
          createdById: author?.id ?? null,
        },
      ],
    });
  }

  // ---- H-09 sold cleanly: lease terminated at the sale ------------------------
  {
    const u = await unit('H-09', 'SOLD', [
      { from: null, to: 'LEASED', at: day('2024-01-01'), source: 'SYSTEM' },
      { from: 'LEASED', to: 'SOLD', at: day('2026-03-01'), source: 'SALE_CLOSED' },
    ]);
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Tenant Who Bought'),
        monthlyRent: 4_500, leaseStart: day('2024-01-01'), leaseEnd: day('2026-03-01'),
        termMonths: 26, status: 'TERMINATED',
      },
    });
    await prisma.sale.create({
      data: {
        projectId: project.id, unitId: u.id, buyer: 'Tenant Who Bought LLC',
        salePrice: 900_000, status: 'CLOSED', closingDate: day('2026-03-01'),
      },
    });
  }

  // ---- H-10 sold with the lease left ACTIVE (the live defect) -----------------
  {
    const u = await unit('H-10', 'SOLD', [
      { from: null, to: 'LEASED', at: day('2024-01-01'), source: 'SYSTEM' },
      { from: 'LEASED', to: 'SOLD', at: day('2026-03-01'), source: 'SALE_CLOSED' },
    ]);
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Still Billing Tenant'),
        monthlyRent: 5_000, leaseStart: day('2024-01-01'), leaseEnd: day('2030-01-01'),
        termMonths: 72, status: 'ACTIVE',          // <- never terminated
        escalationPct: 3, escalationFreq: 12,      // escalations run years past the sale
      },
    });
    await prisma.sale.create({
      data: {
        projectId: project.id, unitId: u.id, buyer: 'Investor Buyer',
        salePrice: 1_100_000, status: 'CLOSED', closingDate: day('2026-03-01'),
      },
    });
  }

  // ---- H-11 cancelled sale releases the unit ---------------------------------
  {
    const u = await unit('H-11', 'AVAILABLE', [
      { from: null, to: 'AVAILABLE', at: day('2026-01-01'), source: 'SYSTEM' },
      { from: 'AVAILABLE', to: 'UNDER_CONTRACT', at: day('2026-04-01'), source: 'MANUAL' },
      { from: 'UNDER_CONTRACT', to: 'AVAILABLE', at: day('2026-06-01'), source: 'SALE_CANCELLED' },
    ]);
    await prisma.sale.create({
      data: {
        projectId: project.id, unitId: u.id, buyer: 'Buyer Who Walked',
        salePrice: 800_000, status: 'CANCELLED', lostReason: 'FINANCING_FELL_THROUGH',
        contractDate: day('2026-04-01'),
      },
    });
  }

  // ---- H-12 construction window ----------------------------------------------
  await unit('H-12', 'AVAILABLE', [
    { from: null, to: 'UNDER_CONSTRUCTION', at: day('2025-01-01'), source: 'SYSTEM' },
    { from: 'UNDER_CONSTRUCTION', to: 'AVAILABLE', at: day('2026-02-01'), source: 'MANUAL' },
  ]);

  // ---- H-13 backfilled out of order ------------------------------------------
  // The 2024 vacancy was entered TODAY, long after the 2025 tenancy it precedes. The
  // timeline must order by effectiveAt, or backfilled history lands at the bottom.
  await unit('H-13', 'LEASED', [
    { from: null, to: 'LEASED', at: day('2025-01-01'), source: 'SYSTEM', recordedAt: day('2025-01-01') },
    { from: null, to: 'AVAILABLE', at: day('2024-01-01'), source: 'BACKFILL', recordedAt: T0 },
  ]);

  // ---- H-14 same-instant flips ------------------------------------------------
  await unit('H-14', 'LEASED', [
    { from: null, to: 'AVAILABLE', at: day('2026-01-01'), source: 'SYSTEM', recordedAt: day('2026-01-01') },
    { from: 'AVAILABLE', to: 'UNDER_CONTRACT', at: day('2026-05-01'), source: 'MANUAL', recordedAt: day('2026-05-01') },
    // Same effectiveAt, later write: the UNDER_CONTRACT window has zero length.
    { from: 'UNDER_CONTRACT', to: 'LEASED', at: day('2026-05-01'), source: 'MANUAL', recordedAt: day('2026-05-02') },
  ]);

  // ---- H-15 future-dated event ------------------------------------------------
  await unit('H-15', 'AVAILABLE', [
    { from: null, to: 'AVAILABLE', at: daysFrom(T0, 400), source: 'SYSTEM' },
  ]);

  // ---- H-16 soft-deleted lease --------------------------------------------------
  {
    const u = await unit('H-16', 'AVAILABLE', [
      { from: null, to: 'AVAILABLE', at: day('2026-01-01'), source: 'SYSTEM' },
    ]);
    await prisma.lease.create({
      data: {
        ...leaseBase(u.id, 'Deleted Tenant'),
        monthlyRent: 1_000, leaseStart: day('2025-01-01'), leaseEnd: day('2026-01-01'),
        termMonths: 12, status: 'TERMINATED',
        deletedAt: T0,
      },
    });
  }

  // ---- H-17 zero-sqft unit ------------------------------------------------------
  await unit('H-17', 'AVAILABLE', [
    { from: null, to: 'AVAILABLE', at: day('2026-01-01'), source: 'SYSTEM' },
  ], 0);

  const count = await prisma.unit.count({ where: { buildingId: building.id } });
  console.log(`\nSeeded "${BUILDING_NAME}" in ${project.name} — ${count} units`);
  console.log(`  /projects/${project.id}/buildings/${building.id}`);
  console.log('\nRemove with: npx tsx prisma/seed-qa-unit-history.ts --reset');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
