import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MAX_UNITS = 8; // keep at most 8 units per building

async function main() {
  const buildings = await prisma.building.findMany({ select: { id: true, name: true } });
  let totalDeleted = 0;

  for (const building of buildings) {
    const units = await prisma.unit.findMany({
      where: { buildingId: building.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (units.length <= MAX_UNITS) {
      console.log(`✓ ${building.name}: ${units.length} units — OK`);
      continue;
    }

    const toDelete = units.slice(MAX_UNITS).map((u) => u.id);
    await prisma.unit.deleteMany({ where: { id: { in: toDelete } } });
    totalDeleted += toDelete.length;
    console.log(`✂ ${building.name}: kept ${MAX_UNITS}, deleted ${toDelete.length}`);
  }

  console.log(`\n✅ Done. Total units deleted: ${totalDeleted}`);
  const remaining = await prisma.unit.count({ where: { deletedAt: null } });
  console.log(`   Remaining units in DB: ${remaining}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
