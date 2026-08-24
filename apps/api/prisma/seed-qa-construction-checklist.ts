/**
 * QA fixtures for the Construction Checklist rollup — 3 units per building, across all
 * 4 buildings of the existing "QA — Building Fixtures" project, so the redesigned
 * per-building stage-progress strip (ConstructionChecklistRollup.tsx) has something to
 * show on every building, not just B-ALPHA.
 *
 * ADDITIVE, not destructive: B-ALPHA/B-BRAVO/B-CHARLIE (seed-qa-building.ts) and B-DELTA
 * (seed-qa-unit-history.ts) each already carry deliberate, single-purpose fixture units —
 * e.g. B-CHARLIE's units are held at ZERO on purpose, to exercise the empty-building
 * state. This script never touches those. It only creates/removes units whose number
 * starts with "CK-" (checklist-fixture units), so it layers cleanly on top and never
 * collides with what those other scripts assert. Re-running seed-qa-building.ts (which
 * deletes and rebuilds the whole project) will also wipe this script's units — run this
 * one again afterward if you need the checklist demo data back.
 *
 * Templates deliberately differ in LENGTH and LABELS per building (18 / 8 / 5 / 10
 * stages) — the rollup strip is built per-unit from that unit's own stage list, with no
 * shared column assumption, and this is the fixture that proves it.
 *
 * Two units also get a real InteriorProject (the already-built Interior module — see
 * apps/api/src/modules/interior/), to cover "interiors" too: a SEPARATE system from the
 * construction checklist, not a second checklist track bolted onto it.
 *
 * Run seed-qa-building.ts first.
 *
 *   npx tsx prisma/seed-qa-construction-checklist.ts
 *   npx tsx prisma/seed-qa-construction-checklist.ts --reset
 */
import { PrismaClient, UnitStatus } from '@prisma/client';

const prisma = new PrismaClient();
const PROJECT_SLUG = 'qa-building-fixtures';
const UNIT_PREFIX = 'CK-';

type StageSpec = { label: string; status: 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' };

// The client's own shell-construction board (screenshot), used verbatim for B-ALPHA.
const SHELL_STAGES = [
  '01 - Soil Compaction', '02 - Rebar Laying', '03 - Plumbing – Underground',
  '04 - Concrete Pour / Foundation', '05 - Columns', '06 - Roof Decking',
  '07 - Truss Installation', '08 - Shell Framing', '09 - Dense Glass / Glazing',
  '10 - Fire Sprinklers', '11 - Electrical – Rough-In', '12 - Plumbing – Rough-In',
  '13 - Masonry', '14 - Electrical Wire Pulling', '15 - Heater Installation',
  '16 - Final Building / Finish-Out', '17 - Store front glass', '18 - garage doors',
];
const SITE_STAGES = [
  '01 - Grading', '02 - Utilities Tie-In', '03 - Slab Pour',
  '04 - Framing', '05 - MEP Rough-In', '06 - Drywall', '07 - Paint', '08 - Final Walk',
];
const PUNCH_STAGES = ['01 - Permits', '02 - Site Prep', '03 - Foundation', '04 - Framing', '05 - Close-In'];
const FINISH_STAGES = [
  '01 - Contracts', '02 - Timeline Calendar', '03 - Rough Plumbing', '04 - Rough Electrical',
  '05 - Insulation', '06 - Drywall', '07 - Flooring', '08 - Paint',
  '09 - Punch List', '10 - Final Inspection',
];

// Marks the first N as DONE, the next as IN_PROGRESS (or BLOCKED), rest NOT_STARTED —
// so three units in the same building land at visibly different points on the strip.
function progressStages(labels: string[], doneCount: number, nextStatus: StageSpec['status'] = 'IN_PROGRESS'): StageSpec[] {
  return labels.map((label, i) => ({
    label,
    status: i < doneCount ? 'DONE' : i === doneCount ? nextStatus : 'NOT_STARTED',
  }));
}

async function main() {
  const reset = process.argv.includes('--reset');

  const project = await prisma.project.findUnique({ where: { slug: PROJECT_SLUG } });
  if (!project) throw new Error(`Run seed-qa-building.ts first — no project with slug "${PROJECT_SLUG}"`);

  // InteriorProject.unitId is ON DELETE SET NULL, not CASCADE — deleting the unit first
  // would leave an orphaned, un-owned fixture row behind instead of removing it, so the
  // InteriorProject rows (named after the units they're attached to) go first.
  const staleInterior = await prisma.interiorProject.deleteMany({ where: { name: { startsWith: UNIT_PREFIX } } });
  if (staleInterior.count > 0) console.log(`removed ${staleInterior.count} previous checklist-fixture interior project(s)`);

  const staleUnits = await prisma.unit.findMany({
    where: { building: { projectId: project.id }, unitNumber: { startsWith: UNIT_PREFIX } },
    select: { id: true },
  });
  if (staleUnits.length > 0) {
    await prisma.unit.deleteMany({ where: { id: { in: staleUnits.map((u) => u.id) } } });
    console.log(`removed ${staleUnits.length} previous checklist-fixture unit(s)`);
  }
  if (reset) {
    console.log('--reset: checklist fixtures removed, nothing rebuilt.');
    return;
  }

  const buildings = await prisma.building.findMany({ where: { projectId: project.id } });
  const byPrefix = (p: string) => buildings.find((b) => b.name.startsWith(p));
  const alpha = byPrefix('B-ALPHA');
  const bravo = byPrefix('B-BRAVO');
  const charlie = byPrefix('B-CHARLIE');
  const delta = byPrefix('B-DELTA');
  if (!alpha || !bravo || !charlie || !delta) {
    throw new Error('Expected B-ALPHA/B-BRAVO/B-CHARLIE/B-DELTA — run seed-qa-building.ts and seed-qa-unit-history.ts first.');
  }

  const plans: { buildingId: string; code: string; stageLabels: string[]; done: number; next?: StageSpec['status'] }[][] = [
    [
      { buildingId: alpha.id, code: 'CK-A-1', stageLabels: SHELL_STAGES, done: 8, next: 'IN_PROGRESS' },
      { buildingId: alpha.id, code: 'CK-A-2', stageLabels: SHELL_STAGES, done: 3, next: 'BLOCKED' },
      { buildingId: alpha.id, code: 'CK-A-3', stageLabels: SHELL_STAGES, done: SHELL_STAGES.length },
    ],
    [
      { buildingId: bravo.id, code: 'CK-B-1', stageLabels: SITE_STAGES, done: 2, next: 'IN_PROGRESS' },
      { buildingId: bravo.id, code: 'CK-B-2', stageLabels: SITE_STAGES, done: 6, next: 'IN_PROGRESS' },
      { buildingId: bravo.id, code: 'CK-B-3', stageLabels: SITE_STAGES, done: 0, next: 'NOT_STARTED' },
    ],
    [
      { buildingId: charlie.id, code: 'CK-C-1', stageLabels: PUNCH_STAGES, done: 1, next: 'IN_PROGRESS' },
      { buildingId: charlie.id, code: 'CK-C-2', stageLabels: PUNCH_STAGES, done: 4, next: 'BLOCKED' },
      { buildingId: charlie.id, code: 'CK-C-3', stageLabels: PUNCH_STAGES, done: PUNCH_STAGES.length },
    ],
    [
      { buildingId: delta.id, code: 'CK-D-1', stageLabels: FINISH_STAGES, done: 5, next: 'IN_PROGRESS' },
      { buildingId: delta.id, code: 'CK-D-2', stageLabels: FINISH_STAGES, done: 9, next: 'IN_PROGRESS' },
      { buildingId: delta.id, code: 'CK-D-3', stageLabels: FINISH_STAGES, done: 0, next: 'NOT_STARTED' },
    ],
  ];

  let unitCount = 0;
  let stageCount = 0;
  for (const buildingPlan of plans) {
    for (const p of buildingPlan) {
      const unit = await prisma.unit.create({
        data: {
          buildingId: p.buildingId,
          unitNumber: p.code,
          unitType: 'RETAIL',
          status: UnitStatus.UNDER_CONSTRUCTION,
          sqft: 1000,
        },
      });
      unitCount += 1;

      const stages = progressStages(p.stageLabels, p.done, p.next ?? 'IN_PROGRESS');
      await prisma.unitConstructionStage.createMany({
        data: stages.map((s, i) => ({
          unitId: unit.id,
          sortOrder: i,
          label: s.label,
          status: s.status,
        })),
      });
      stageCount += stages.length;
    }
  }

  // "Interiors also" — the real, already-built Interior module (InteriorProject), a
  // separate system from the construction checklist above. Two units, two different
  // phases, so the Interior portfolio isn't a single-row demo either.
  const alphaUnit1 = await prisma.unit.findFirstOrThrow({ where: { buildingId: alpha.id, unitNumber: 'CK-A-1' } });
  const bravoUnit1 = await prisma.unit.findFirstOrThrow({ where: { buildingId: bravo.id, unitNumber: 'CK-B-1' } });
  await prisma.interiorProject.create({
    data: {
      unitId: alphaUnit1.id,
      name: 'CK-A-1 Fit-Out',
      status: 'IN_PROGRESS',
      phase: 'EXECUTION',
      contractType: 'PER_SQFT',
      ratePerSqft: 45,
      area: 1000,
      contractValue: 45_000,
    },
  });
  await prisma.interiorProject.create({
    data: {
      unitId: bravoUnit1.id,
      name: 'CK-B-1 Fit-Out',
      status: 'NOT_STARTED',
      phase: 'DESIGN',
      contractType: 'PER_SQFT',
      ratePerSqft: 38,
      area: 1000,
      contractValue: 38_000,
    },
  });

  console.log(`\nSeeded ${unitCount} checklist-fixture units (${stageCount} stages) across B-ALPHA/B-BRAVO/B-CHARLIE/B-DELTA`);
  console.log('  B-ALPHA   18-stage shell template (client\'s own board) · 3 units at different points, one BLOCKED');
  console.log('  B-BRAVO    8-stage site template   · 3 units at different points');
  console.log('  B-CHARLIE  5-stage punch template  · 3 units at different points, one BLOCKED');
  console.log('  B-DELTA   10-stage finish template · 3 units at different points');
  console.log('  + 2 InteriorProject rows (CK-A-1 in EXECUTION, CK-B-1 in DESIGN) — the real Interior module');
  console.log(`\nView: /projects/${project.id}/construction`);
  console.log('Remove with: npx tsx prisma/seed-qa-construction-checklist.ts --reset');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
