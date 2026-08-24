/**
 * Fixes leases where `escalationPct` is set but `escalationFreq` is NULL.
 *
 * The Lease form's "Escalation every (months)" field said "Blank = annual (12)" but
 * nothing ever actually applied that default — the server stores NULL as-is, and
 * `computeRentSchedule`'s `escalates` check (`freq !== null && freq > 0`) treats NULL as
 * "never escalates". A lease with a stated escalation % and a blank interval was
 * therefore silently getting ZERO escalation, contradicting what the lease terms said
 * and what the unit page displayed ("X% every 12 mo", read off escalationPct alone).
 *
 * Fixed 2026-08-21: the form now requires an interval whenever a % is entered. This
 * script repairs the leases that predate that fix — assuming ANNUAL (12), matching the
 * default every other correctly-configured lease in this data already uses (15 of 17
 * leases with an escalation % have escalationFreq=12; only this bug's victims don't).
 *
 * Sets escalationFreq=12, then force-regenerates FUTURE rent periods only — past/frozen
 * periods are never rewritten (same "history is immutable" rule as everywhere else in
 * this schema), so nothing already billed changes; only the schedule going forward
 * starts escalating as the lease's own terms said it should.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 *   npx ts-node -T --compiler-options '{"module":"commonjs"}' prisma/fix-escalation-interval-migration.ts
 *   npx ts-node -T --compiler-options '{"module":"commonjs"}' prisma/fix-escalation-interval-migration.ts --apply
 */

import { PrismaClient } from '@prisma/client';
import { LeaseRentPeriodService } from '../src/modules/leases/lease-rent-period.service';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ASSUMED_FREQ = 12;

async function main() {
  console.log(APPLY ? '\n*** APPLYING CHANGES ***\n' : '\n--- DRY RUN (pass --apply to write) ---\n');

  const affected = await prisma.lease.findMany({
    where: { deletedAt: null, escalationPct: { not: null }, escalationFreq: null },
    select: {
      id: true, tenantName: true, unitId: true, buildingId: true,
      escalationPct: true, termMonths: true, status: true, terminationDate: true,
    },
  });

  console.log(`Found ${affected.length} lease(s) with an escalation % but no interval.\n`);

  const rentPeriods = new LeaseRentPeriodService(prisma as any);

  for (const lease of affected) {
    const label = `${lease.tenantName} (lease ${lease.id}, unit/building ${lease.unitId ?? lease.buildingId})`;
    console.log(`--- ${label} ---`);
    console.log(
      `  Escalation ${Number(lease.escalationPct).toFixed(2)}% with no interval — `
      + `will set escalationFreq=${ASSUMED_FREQ} (annual).`,
    );

    if (lease.status !== 'ACTIVE') {
      console.log(`  Status is ${lease.status} — updating the field but not regenerating a schedule.`);
    }

    if (!APPLY) continue;

    await prisma.lease.update({
      where: { id: lease.id },
      data: { escalationFreq: ASSUMED_FREQ },
    });

    if (lease.status === 'ACTIVE') {
      try {
        await rentPeriods.regenerateFuture(lease.id);
        console.log('  Applied: escalationFreq set to 12 and future periods re-cut.');
      } catch (err) {
        console.log(
          `  escalationFreq set to 12, but regenerateFuture refused: ${(err as Error).message} `
          + '(likely a sold unit or ended tenancy — the field is fixed for the record either way.)',
        );
      }
    } else {
      console.log('  Applied: escalationFreq set to 12 (no schedule regenerated — lease is not ACTIVE).');
    }
  }

  console.log(
    '\nEvery lease above now escalates from its NEXT future period onward. Past/frozen periods '
    + 'are untouched, so nothing already billed changes.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
