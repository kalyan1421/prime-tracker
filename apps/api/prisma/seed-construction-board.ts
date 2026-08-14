/**
 * Seed the PRIME LEWISVILLE construction board, reproducing the client's Monday board.
 *
 * The point is not demo data for its own sake. Every row below is one the client
 * actually keeps, and between them they exercise the four things Phase 2 added:
 *
 *   UNIT 506            single unit, HIGH        — the ordinary case
 *   UNIT 501, 503       TWO units, one item      — non-adjacent multi-unit
 *   UNIT 509            single unit, HIGH
 *   UNIT 511            single unit, LOW
 *   BUILDING 7          no units at all          — a building-level item (SHELL)
 *   UNITS 402,403,404   THREE units, one item    — status left BLANK on their board,
 *                                                  which is why BLOCKED now exists
 *
 * The two multi-unit rows are the ones worth keeping: they are what a scalar
 * `Task.unitId` could never express, and they must NOT be confused with
 * UnitsService.combine() — these units stay separate and keep their own leases and
 * rent history. Only the WORK is shared.
 *
 * Idempotent: deletes and rebuilds its own project by name, so it can be re-run.
 *
 * Run with ts-node, NOT tsx — tsx exits silently on scripts that import from src/:
 *   npx ts-node -T --compiler-options '{"module":"commonjs"}' prisma/seed-construction-board.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PROJECT_NAME = 'Prime Lewisville';
// Keyed on the slug, not the name: slug is @unique, so this is what makes a re-run
// replace the fixture instead of stacking a second copy beside it.
const PROJECT_SLUG = 'prime-lewisville-board';
const BUILDING_NAME = 'Lewisville Retail';

/** One row of the client's board. `units` are unit numbers, not ids. */
const BOARD: Array<{
  units: string[];
  buildingLevel?: boolean;
  title: string;
  status: string;
  priority: string;
}> = [
  { units: ['506'], title: 'INTERIOR FINISHOUT', status: 'IN_PROGRESS', priority: 'HIGH' },
  { units: ['501', '503'], title: 'PERMIT / INTERIOR FINISHOUT', status: 'IN_PROGRESS', priority: 'MEDIUM' },
  { units: ['509'], title: 'INTERIOR FINISHOUT', status: 'IN_PROGRESS', priority: 'HIGH' },
  { units: ['511'], title: 'INTERIOR FINISHOUT', status: 'IN_PROGRESS', priority: 'LOW' },
  { units: [], buildingLevel: true, title: 'SHELL', status: 'IN_PROGRESS', priority: 'MEDIUM' },
  // The blank status cell on the client's board. BLOCKED is the value that was missing:
  // without it people leave the field empty or overload CANCELLED.
  { units: ['402', '403', '404'], title: 'INTERIOR FINISHOUT', status: 'BLOCKED', priority: 'MEDIUM' },
];

async function main() {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) throw new Error('No organization — run the base seed first.');

  const owner =
    (await prisma.user.findFirst({ where: { role: 'PROJECT_MANAGER', isActive: true } })) ??
    (await prisma.user.findFirst({ where: { isActive: true } }));
  if (!owner) throw new Error('No active user to own the board — run seed-demo-users.ts first.');

  // Rebuild from scratch so a re-run does not stack duplicate items.
  const existing = await prisma.project.findUnique({ where: { slug: PROJECT_SLUG } });
  if (existing) {
    await prisma.project.delete({ where: { id: existing.id } });
    console.log(`  removed the previous "${PROJECT_NAME}" project`);
  }

  const project = await prisma.project.create({
    data: {
      name: PROJECT_NAME,
      slug: PROJECT_SLUG,
      org: { connect: { id: org.id } },
      location: 'Lewisville, TX',
      status: 'ACTIVE',
      phase: 'CONSTRUCTION',
      projectType: 'COMMERCIAL',
      description: 'Reproduction of the client\'s Monday board. Safe to delete.',
    },
  });

  const building = await prisma.building.create({
    data: {
      projectId: project.id,
      name: BUILDING_NAME,
      buildingType: 'RETAIL',
      phase: 'CONSTRUCTION',
    },
  });

  // Every unit named anywhere on the board, deduplicated.
  const unitNumbers = [...new Set(BOARD.flatMap((r) => r.units))].sort();
  const units = new Map<string, string>();
  for (const unitNumber of unitNumbers) {
    const unit = await prisma.unit.create({
      data: {
        buildingId: building.id,
        unitNumber,
        unitType: 'RETAIL',
        status: 'UNDER_CONSTRUCTION',
        sqft: 1200,
      },
    });
    units.set(unitNumber, unit.id);
  }

  let created = 0;
  for (const row of BOARD) {
    const unitIds = row.units.map((n) => units.get(n)!).filter(Boolean);
    await prisma.task.create({
      data: {
        projectId: project.id,
        buildingId: building.id,
        kind: 'CONSTRUCTION',
        title: row.title,
        status: row.status,
        priority: row.priority,
        assignedTo: owner.id,
        createdBy: owner.id,
        // The scalar mirrors the join table ONLY for a single-unit item — the same rule
        // TasksService.create follows. A multi-unit item leaves it null rather than
        // nominating a "primary" unit that does not exist.
        unitId: unitIds.length === 1 ? unitIds[0] : null,
        units: unitIds.length ? { create: unitIds.map((unitId) => ({ unitId })) } : undefined,
        updates: {
          create: [
            {
              // Backdated on purpose: updateDate is the day being REPORTED, and the
              // fixture should not imply every update was typed the day it happened.
              updateDate: new Date(Date.UTC(2026, 7, 10)),
              authorId: owner.id,
              content:
                row.units.length > 1
                  ? `Framing inspection passed on ${row.units.join(', ')}.`
                  : 'Framing inspection passed.',
            },
          ],
        },
      },
    });
    created++;
  }

  console.log(`\n✔ ${PROJECT_NAME} board seeded`);
  console.log(`  project   ${project.id}`);
  console.log(`  units     ${unitNumbers.length} (${unitNumbers.join(', ')})`);
  console.log(`  items     ${created} — including 2 multi-unit and 1 building-level`);
  console.log(`\n  Open: /projects/${project.id}/board\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
