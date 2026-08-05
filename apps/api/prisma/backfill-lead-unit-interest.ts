/**
 * Backfill: mirror each lead's primary unit into its units-of-interest list.
 *
 * `LeadsService.mirrorPrimaryUnitAsInterest` keeps Lead.unitId and LeadUnitInterest in
 * step, but only from the moment it shipped. Leads created before that still have a
 * primary unit and an empty interest list, so their detail panel reads "Not on any unit
 * waitlist yet" while the card right next to it shows the unit. This closes that gap
 * once for existing rows; new writes are handled by the service.
 *
 * Idempotent — the join is unique on (leadId, unitId) and this only ever inserts, so
 * re-running is a no-op. (Lead has no soft-delete column; deletes are hard.)
 *
 *   npx tsx prisma/backfill-lead-unit-interest.ts            # report only
 *   npx tsx prisma/backfill-lead-unit-interest.ts --apply    # write
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');

  const leads = await prisma.lead.findMany({
    where: { unitId: { not: null } },
    select: {
      id: true,
      name: true,
      unitId: true,
      unit: { select: { unitNumber: true } },
      unitInterests: { select: { unitId: true } },
    },
  });

  const missing = leads.filter((l) => !l.unitInterests.some((i) => i.unitId === l.unitId));

  console.log(`leads with a primary unit : ${leads.length}`);
  console.log(`missing the mirror row    : ${missing.length}`);
  if (missing.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  for (const l of missing) {
    console.log(`  ${(l.name || '(unnamed)').padEnd(28)} -> unit ${l.unit?.unitNumber ?? l.unitId}`);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write these rows.');
    return;
  }

  let written = 0;
  for (const l of missing) {
    await prisma.leadUnitInterest.upsert({
      where: { leadId_unitId: { leadId: l.id, unitId: l.unitId! } },
      create: { leadId: l.id, unitId: l.unitId! },
      update: {},
    });
    written++;
  }
  console.log(`\nWrote ${written} interest rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
