/**
 * NNN reverts to a monthly charge on LeaseRentPeriod (client-confirmed 2026-08-21),
 * reversing the 2026-08-12 decision that moved it to a one-time LeaseObligation(kind='NNN').
 *
 * The code change (LeaseRentPeriodService.toScheduleInput) already derives every NEW or
 * regenerated schedule's monthly nnnAmount from lease.nnnTotalAmount / 12. This script
 * handles the leases that signed during the 9-day interim (2026-08-12 to 2026-08-21) and
 * therefore got a one-time NNN obligation instead: it force-regenerates their FUTURE rent
 * periods so they pick up the monthly nnnAmount going forward.
 *
 * Deliberately does NOT touch:
 *   - past/frozen periods (the "immutable history" rule this codebase uses everywhere —
 *     BudgetRevision, LeaseRentPeriodCorrection — applies here too: a period already in
 *     effect keeps whatever it was actually billed as)
 *   - the LeaseObligation(kind='NNN') rows themselves — they stay exactly as they are,
 *     the historical record of what was actually agreed as a one-time sum at the time.
 *     This is a REPORT for Finance to review each one (per the spec), not an automatic
 *     waive/delete. Decide by hand, per lease, whether the remaining unpaid balance
 *     should be waived now that NNN bills monthly instead.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 *   npx ts-node -T --compiler-options '{"module":"commonjs"}' prisma/fix-nnn-monthly-migration.ts
 *   npx ts-node -T --compiler-options '{"module":"commonjs"}' prisma/fix-nnn-monthly-migration.ts --apply
 */

import { PrismaClient } from '@prisma/client';
import {
  computeRentSchedule,
  startOfUtcDay,
  round2,
} from '../src/modules/leases/lease-rent-period.service';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? '\n*** APPLYING CHANGES ***\n' : '\n--- DRY RUN (pass --apply to write) ---\n');

  const obligations = await prisma.leaseObligation.findMany({
    where: { kind: 'NNN' },
    include: {
      lease: {
        select: {
          id: true, tenantName: true, unitId: true, buildingId: true,
          leaseStart: true, rentStartDate: true, leaseEnd: true, terminationDate: true,
          monthlyRent: true, nnnTotalAmount: true, escalationPct: true, escalationFreq: true,
          freeRentMonths: true, freeRentStartDate: true, termMonths: true, deletedAt: true,
        },
      },
    },
  });

  console.log(`Found ${obligations.length} one-time NNN obligation(s) from the 2026-08-12 – `
    + `2026-08-21 window.\n`);

  const today = startOfUtcDay(new Date());

  for (const ob of obligations) {
    const lease = ob.lease;
    const label = `${lease.tenantName} (lease ${lease.id}, unit/building ${lease.unitId ?? lease.buildingId})`;

    console.log(`--- ${label} ---`);
    console.log(
      `  NNN obligation: agreed $${Number(ob.totalAmount).toFixed(2)}, `
      + `paid $${Number(ob.paidAmount).toFixed(2)}, status ${ob.status}`,
    );

    if (lease.deletedAt) {
      console.log('  Lease is soft-deleted — skipping.');
      continue;
    }
    if (lease.terminationDate && startOfUtcDay(lease.terminationDate) <= today) {
      console.log('  Tenancy already ended — no future periods to regenerate. Skipping.');
      continue;
    }
    if (!lease.nnnTotalAmount || Number(lease.nnnTotalAmount) <= 0) {
      console.log('  Lease has no nnnTotalAmount to derive a monthly figure from — skipping.');
      continue;
    }

    const monthlyNnn = round2(Number(lease.nnnTotalAmount) / 12);
    console.log(
      `  Derived monthly NNN: $${monthlyNnn.toFixed(2)} `
      + `(nnnTotalAmount $${Number(lease.nnnTotalAmount).toFixed(2)} / 12)`,
    );

    const existing = await prisma.leaseRentPeriod.findMany({
      where: { leaseId: lease.id },
      orderBy: { sequence: 'asc' },
    });
    const frozen = existing.filter((p) => startOfUtcDay(p.startDate) <= today);
    const stale = existing.filter((p) => startOfUtcDay(p.startDate) > today);
    console.log(
      `  ${existing.length} existing period(s): ${frozen.length} frozen (untouched), `
      + `${stale.length} future (will be rewritten with the monthly NNN).`,
    );

    if (!APPLY) continue;

    const computed = computeRentSchedule({
      leaseStart: lease.rentStartDate ?? lease.leaseStart,
      leaseEnd: lease.leaseEnd,
      baseRent: lease.monthlyRent,
      nnnAmount: monthlyNnn,
      escalationPct: lease.escalationPct,
      escalationFreq: lease.escalationFreq,
      freeRentMonths: lease.freeRentMonths,
      freeRentStartDate: lease.freeRentStartDate,
    });
    const future = computed.filter((p) => p.startDate > today);
    const maxFrozenSequence = frozen.reduce((m, p) => Math.max(m, p.sequence), 0);

    await prisma.$transaction([
      ...(stale.length
        ? [prisma.leaseRentPeriod.deleteMany({ where: { id: { in: stale.map((p) => p.id) } } })]
        : []),
      ...(future.length
        ? [
            prisma.leaseRentPeriod.createMany({
              data: future.map((p, i) => ({
                leaseId: lease.id,
                sequence: maxFrozenSequence + i + 1,
                startDate: p.startDate,
                endDate: p.endDate,
                baseRent: p.baseRent,
                nnnAmount: p.nnnAmount,
                monthlyRent: p.monthlyRent,
                isFreeRent: p.isFreeRent,
                escalationPct: p.escalationPct,
                source: p.source,
              })),
            }),
          ]
        : []),
    ]);
    console.log(`  Applied: ${stale.length} future period(s) rewritten with monthly NNN.`);
  }

  console.log(
    '\nFinance action item for each lease above: decide whether the remaining unpaid '
    + 'balance on its one-time NNN obligation should be waived now that NNN bills monthly, '
    + 'or left standing as an already-agreed one-time sum. This script does not decide that.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
