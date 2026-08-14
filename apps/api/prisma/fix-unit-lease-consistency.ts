/**
 * Reconcile `Unit.status` with the lease that actually sits on the unit.
 *
 * Context: nothing ever set a unit's status from a lease until 2026-08-13, so the field
 * drifted. Measured that day: of 113 units that either claimed to be tenanted or held a
 * live lease, only 12 agreed with themselves.
 *
 * The code fix (LeasesService.syncUnitFromLease) stops NEW drift. This repairs the
 * existing rows — but only where the data itself settles the question.
 *
 * ┌ FIXED AUTOMATICALLY ────────────────────────────────────────────────────────────┐
 * │ B. unit AVAILABLE, live ACTIVE lease  → LEASED                                  │
 * │    A signed, active lease is positive evidence somebody is in there. The unit   │
 * │    status is the field with nothing behind it.                                  │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 * ┌ REPORTED, NEVER TOUCHED ────────────────────────────────────────────────────────┐
 * │ A. unit tenanted, NO live lease                                                 │
 * │    Two readings, and the data cannot tell them apart: the unit is genuinely      │
 * │    empty and the status is stale, OR a real tenancy was never entered. Flipping  │
 * │    these to AVAILABLE would erase the second case silently — and it is the one   │
 * │    that costs money, because an un-entered tenancy is un-billed rent.            │
 * │                                                                                  │
 * │ C. unit SOLD, live lease                                                        │
 * │    Either the sale is wrong or the lease should have been terminated at closing. │
 * │    Both are real events with money attached. endTenancy already refuses some of  │
 * │    these outright where rent was collected past the closing date.                │
 * │                                                                                  │
 * │ D. lease term expired, still ACTIVE                                             │
 * │    Closing it is a business decision (did they leave, or hold over?), and        │
 * │    holdover cannot currently be billed at all.                                   │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 *   npx ts-node -T --compiler-options '{"module":"commonjs"}' prisma/fix-unit-lease-consistency.ts
 *   npx ts-node -T --compiler-options '{"module":"commonjs"}' prisma/fix-unit-lease-consistency.ts --apply
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** A lease that is live right now: not draft-ended, not terminated, not soft-deleted. */
const LIVE_LEASE = {
  deletedAt: null,
  status: { notIn: ['EXPIRED', 'TERMINATED'] },
  terminationDate: null,
} as const;

const TENANTED = ['LEASED', 'OCCUPIED', 'LEASE_PENDING'];

async function main() {
  console.log(APPLY ? '\n*** APPLYING CHANGES ***\n' : '\n--- DRY RUN (pass --apply to write) ---\n');

  const units = await prisma.unit.findMany({
    // Soft-deleted projects and buildings are excluded: their units are not part of the
    // portfolio, and counting them inflates the problem with rows nobody will ever open.
    // (Caught by this script's own first run, which reported an E2E fixture.)
    where: {
      deletedAt: null,
      building: { deletedAt: null, project: { deletedAt: null } },
    },
    select: {
      id: true,
      unitNumber: true,
      status: true,
      building: { select: { name: true, project: { select: { name: true } } } },
      leases: {
        where: LIVE_LEASE,
        select: { id: true, tenantName: true, status: true, leaseStart: true, leaseEnd: true },
        orderBy: { leaseStart: 'desc' },
      },
    },
  });

  const label = (u: (typeof units)[number]) =>
    `${u.building?.project?.name ?? '?'} · ${u.building?.name ?? '?'} · Unit ${u.unitNumber}`;

  // ---- B: fixable ---------------------------------------------------------
  const fixable = units.filter(
    (u) => u.status === 'AVAILABLE' && u.leases.some((l) => l.status === 'ACTIVE'),
  );

  console.log(`B. AVAILABLE with a live ACTIVE lease — FIXABLE: ${fixable.length}`);
  for (const u of fixable) {
    const lease = u.leases.find((l) => l.status === 'ACTIVE')!;
    console.log(`   ${label(u)}  →  LEASED   (${lease.tenantName}, to ${lease.leaseEnd.toISOString().slice(0, 10)})`);

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.unit.update({
          where: { id: u.id },
          data: { status: 'LEASED', availableSince: null },
        });
        await tx.unitStatusEvent.create({
          data: {
            unitId: u.id,
            fromStatus: u.status,
            toStatus: 'LEASED',
            // Dated by the LEASE — the unit has been occupied since the tenancy began,
            // not since this script ran. Backdating is the whole point of the log.
            effectiveAt: lease.leaseStart,
            source: 'BACKFILL',
            leaseId: lease.id,
            isHistorical: true,
            reason:
              'Reconciled by fix-unit-lease-consistency: the unit read AVAILABLE while '
              + 'this lease was live. Nothing set unit status from a lease before 2026-08-13.',
          },
        });
      });
    }
  }

  // ---- A / C / D: reported only -------------------------------------------
  const tenantedNoLease = units.filter((u) => TENANTED.includes(u.status) && u.leases.length === 0);
  const soldWithLease = units.filter((u) => u.status === 'SOLD' && u.leases.length > 0);

  const expiredStillActive = await prisma.lease.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      terminationDate: null,
      leaseEnd: { lt: new Date() },
      OR: [
        { unit: { deletedAt: null, building: { deletedAt: null, project: { deletedAt: null } } } },
        { building: { deletedAt: null, project: { deletedAt: null } } },
      ],
    },
    select: { id: true, tenantName: true, leaseEnd: true, unit: { select: { unitNumber: true } } },
    orderBy: { leaseEnd: 'asc' },
  });

  console.log(`\nA. marked tenanted with NO live lease — NEEDS A DECISION: ${tenantedNoLease.length}`);
  console.log('   Either the unit is empty and the status is stale, OR a real tenancy was never');
  console.log('   entered. The second costs money — un-entered tenancies are un-billed rent.');
  for (const u of tenantedNoLease.slice(0, 15)) console.log(`   ${label(u)}  (${u.status})`);
  if (tenantedNoLease.length > 15) console.log(`   … and ${tenantedNoLease.length - 15} more`);

  console.log(`\nC. SOLD with a live lease — NEEDS A DECISION: ${soldWithLease.length}`);
  for (const u of soldWithLease) {
    console.log(`   ${label(u)}  (${u.leases.map((l) => l.tenantName).join(', ')})`);
  }

  console.log(`\nD. lease term expired but still ACTIVE — NEEDS A DECISION: ${expiredStillActive.length}`);
  for (const l of expiredStillActive) {
    console.log(`   Unit ${l.unit?.unitNumber ?? '—'}  ${l.tenantName}  ran out ${l.leaseEnd.toISOString().slice(0, 10)}`);
  }

  const consistent = units.length - fixable.length - tenantedNoLease.length - soldWithLease.length;
  console.log(`\n${'-'.repeat(70)}`);
  console.log(`units scanned      ${units.length}`);
  console.log(`auto-fixed (B)     ${fixable.length}${APPLY ? '' : '  (dry run — nothing written)'}`);
  console.log(`need a decision    ${tenantedNoLease.length + soldWithLease.length + expiredStillActive.length}`);
  console.log(`already consistent ${consistent}`);
  if (!APPLY && fixable.length) console.log('\nRe-run with --apply to write the B fixes.');
  console.log();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
