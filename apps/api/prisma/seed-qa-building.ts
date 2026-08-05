/**
 * QA fixture project — exercises every section of the building detail page.
 *
 * A SEPARATE project ("QA — Building Fixtures"), not extra rows bolted onto the demo
 * data, so a deliberately odd fixture (a building with no units, a half-paid deposit)
 * can never be mistaken for real client data when someone is reading the demo projects.
 * Deleting the project removes every row this script creates.
 *
 * What it covers, and why each case is here rather than "some plausible data":
 *
 *   B-ALPHA   cover photo set, 4 units across 4 statuses, a building-level loan,
 *             a unit-level lease with a PARTLY PAID security deposit, documents.
 *             The four statuses make the Unit Status Mix show an actual mix; the
 *             partly-paid deposit is the only state where the "Partly paid" chip and
 *             the outstanding figure both render.
 *   B-BRAVO   NO cover photo — the regression guard for the card-alignment fix. Alpha
 *             and Bravo sit in the same grid row, so if the cover band ever goes back to
 *             being conditional, their titles visibly stop lining up.
 *             Has a building-level lease (not unit-level), which the Deposits card
 *             renders as a separate row from unit leases.
 *   B-CHARLIE zero units — the empty state and its "Add the first unit" call to action.
 *
 * Plus one PROJECT-level loan, so the building page can be checked to show only its own
 * (the project view legitimately shows both).
 *
 * Idempotent: keyed on a fixed slug and deterministic building names, and it deletes its
 * own project before rebuilding, so re-running gives the same result rather than
 * accumulating duplicates.
 *
 *   npx tsx prisma/seed-qa-building.ts
 *   npx tsx prisma/seed-qa-building.ts --reset   # delete the fixture project and stop
 */
import { PrismaClient, UnitStatus, BuildingType, DocCategory } from '@prisma/client';
import { EncryptionService } from '../src/common/encryption/encryption.service';

const prisma = new PrismaClient();
const SLUG = 'qa-building-fixtures';

// Deliberately an unresolvable host: the fixtures are rows to look at, not files to
// fetch, and a working URL would make a reviewer think a real upload had happened.
const FIXTURE_DOC_URL = 'https://example.invalid/qa-fixture.pdf';

/** Same list LoansService encrypts. Kept in step deliberately — see the note there. */
const SENSITIVE_LOAN_FIELDS = ['lender', 'principalAmt', 'interestRate', 'currentBalance'];

/** Dates relative to "now" so the lease-expiry timeline and overdue states stay live. */
const monthsFromNow = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d;
};

async function main() {
  const reset = process.argv.includes('--reset');

  // Loans are AES-256-GCM encrypted at the application layer. Seeding the plaintext
  // columns directly would recreate exactly the situation the encryption work removed —
  // readable lender/principal sitting next to an empty blob — so the seed encrypts the
  // same way the service does.
  const encryption = new EncryptionService({
    getOrThrow: (k: string) => {
      const v = process.env[k];
      if (!v) throw new Error(`${k} must be set to seed loans (it encrypts them)`);
      return v;
    },
    // Must honour the DEFAULT argument: the service reads ENCRYPTION_KEY_RETIRED with a
    // '' default and immediately calls .split() on it, so returning undefined here
    // crashes the constructor before it ever touches a loan.
    get: (k: string, fallback?: any) => process.env[k] ?? fallback,
  } as any);

  const existing = await prisma.project.findUnique({ where: { slug: SLUG } });
  if (existing) {
    await prisma.project.delete({ where: { id: existing.id } });
    console.log(`removed previous fixture project (${existing.id})`);
  }
  if (reset) {
    console.log('--reset: fixture removed, nothing rebuilt.');
    return;
  }

  const owner = await prisma.user.findFirst({
    where: { isActive: true, role: { in: ['SUPER_ADMIN', 'FOUNDER'] } },
    select: { id: true, email: true },
  });
  if (!owner) throw new Error('No active SUPER_ADMIN/FOUNDER to own the fixture documents');

  const project = await prisma.project.create({
    data: {
      name: 'QA — Building Fixtures',
      slug: SLUG,
      location: 'Test Harness',
      address: '1 Fixture Way',
      acreage: 4.5,
      status: 'ACTIVE',
      phase: 'CONSTRUCTION',
      projectType: 'MIXED_USE',
      description:
        'Synthetic fixtures for the building detail page. Safe to delete: '
        + 'npx tsx prisma/seed-qa-building.ts --reset',
    },
  });

  // ---- B-ALPHA: the fully populated case ------------------------------------
  const alpha = await prisma.building.create({
    data: {
      projectId: project.id,
      name: 'B-ALPHA — Fully Populated',
      llcName: 'QA Fixtures Alpha LLC',
      buildingType: BuildingType.MIXED_USE,
      phase: 'CONSTRUCTION',
      totalSqft: 24000,
      stories: 3,
      // A path that will not resolve to a real object. That is intentional: it exercises
      // the <img> onError path, which must fall through to the typed placeholder rather
      // than leaving an empty band.
      coverPhotoPath: 'buildings/qa-fixture-cover.jpg',
    },
  });

  // Four statuses so the mix bar has four segments rather than one block.
  const alphaUnits = await Promise.all(
    ([
      ['A-101', UnitStatus.AVAILABLE, 1200],
      ['A-102', UnitStatus.LEASED, 1400],
      ['A-103', UnitStatus.SOLD, 1100],
      ['A-104', UnitStatus.UNDER_CONSTRUCTION, 1600],
    ] as const).map(([unitNumber, status, sqft]) =>
      prisma.unit.create({
        data: {
          buildingId: alpha.id,
          unitNumber,
          unitType: 'RETAIL',
          status,
          sqft,
          askingRent: 3200,
          askingPrice: 480000,
          availableSince: status === UnitStatus.AVAILABLE ? new Date() : null,
        },
      }),
    ),
  );

  // Unit-level lease + a PARTLY PAID security deposit.
  const leasedUnit = alphaUnits.find((u) => u.status === UnitStatus.LEASED)!;
  const unitLease = await prisma.lease.create({
    data: {
      // Lease has no projectId — the project is reached through the unit's building.
      unitId: leasedUnit.id,
      tenantName: 'Fixture Tenant Co',
      tenantLegalName: 'Fixture Tenant Company LLC',
      monthlyRent: 4800,
      leaseStart: monthsFromNow(-6),
      leaseEnd: monthsFromNow(14),      // inside the 24-month expiry timeline
      termMonths: 20,
      status: 'ACTIVE',
    },
  });
  const deposit = await prisma.leaseObligation.create({
    data: {
      leaseId: unitLease.id,
      kind: 'SECURITY_DEPOSIT',
      direction: 'FROM_TENANT',
      totalAmount: 9600,
      paidAmount: 3600,                 // deliberately partial
      status: 'PARTIAL',
      dueDate: monthsFromNow(-5),
      notes: 'QA fixture: partially settled, so the outstanding figure renders.',
    },
  });
  await prisma.leaseObligationPayment.create({
    data: { obligationId: deposit.id, amount: 3600, paidAt: monthsFromNow(-5) },
  });

  // Building-level loan on Alpha.
  await prisma.loan.create({
    data: encryption.encryptFields({
      projectId: project.id,
      buildingId: alpha.id,
      loanType: 'CONSTRUCTION',
      lender: 'QA Fixture Bank',
      principalAmt: 3_200_000,
      interestRate: 7.25,
      termMonths: 36,
      maturityDate: monthsFromNow(30),
      currentBalance: 2_450_000,
      monthlyPayment: 24_500,
      notes: 'QA fixture: building-level loan (must NOT appear on B-BRAVO).',
    } as any, SENSITIVE_LOAN_FIELDS as any) as any,
  });

  await prisma.document.createMany({
    data: ([
      ['alpha-permit.pdf', DocCategory.PERMIT],
      ['alpha-site-plan.pdf', DocCategory.DRAWING],
      ['alpha-deed.pdf', DocCategory.DEED],
      ['alpha-loan-agreement.pdf', DocCategory.FINANCIAL],
    ] as const).map(([fileName, category]) => ({
      projectId: project.id,
      buildingId: alpha.id,
      fileName,
      category,
      mimeType: 'application/pdf',
      fileSize: 128_000,
      fileUrl: FIXTURE_DOC_URL,
      externalUrl: FIXTURE_DOC_URL,
      uploadedById: owner.id,
    })),
  });

  // ---- B-BRAVO: no cover photo, building-level lease -------------------------
  const bravo = await prisma.building.create({
    data: {
      projectId: project.id,
      name: 'B-BRAVO — No Cover Photo',
      buildingType: BuildingType.COMMERCIAL,
      phase: 'LEASE_UP',
      totalSqft: 12000,
      stories: 2,
      coverPhotoPath: null,             // the alignment regression guard
    },
  });
  await prisma.unit.createMany({
    data: [
      { buildingId: bravo.id, unitNumber: 'B-201', unitType: 'OFFICE', status: UnitStatus.OCCUPIED, sqft: 900 },
      { buildingId: bravo.id, unitNumber: 'B-202', unitType: 'OFFICE', status: UnitStatus.LEASE_PENDING, sqft: 950 },
    ],
  });

  const buildingLease = await prisma.lease.create({
    data: {
      buildingId: bravo.id,             // building-level, NOT unit-level
      tenantName: 'Whole-Building Tenant Ltd',
      monthlyRent: 15_000,
      leaseStart: monthsFromNow(-12),
      leaseEnd: monthsFromNow(5),       // expires soon — shows in the timeline
      termMonths: 17,
      status: 'ACTIVE',
    },
  });
  await prisma.leaseObligation.create({
    data: {
      leaseId: buildingLease.id,
      kind: 'TI_ALLOWANCE',
      direction: 'TO_TENANT',           // the other direction, so both render
      totalAmount: 45_000,
      paidAmount: 45_000,
      status: 'SETTLED',
      dueDate: monthsFromNow(-10),
    },
  });
  await prisma.document.create({
    data: {
      projectId: project.id,
      buildingId: bravo.id,
      fileName: 'bravo-lease.pdf',
      category: DocCategory.LEGAL,
      mimeType: 'application/pdf',
      fileSize: 64_000,
      fileUrl: FIXTURE_DOC_URL,
      externalUrl: FIXTURE_DOC_URL,
      uploadedById: owner.id,
    },
  });

  // ---- B-CHARLIE: the empty case --------------------------------------------
  await prisma.building.create({
    data: {
      projectId: project.id,
      name: 'B-CHARLIE — Zero Units',
      buildingType: BuildingType.LOT,
      phase: 'PRE_DEVELOPMENT',
      acreage: 2.1,
      coverPhotoPath: null,
    },
  });

  // ---- a PROJECT-level loan, to prove building scoping excludes it -----------
  await prisma.loan.create({
    data: encryption.encryptFields({
      projectId: project.id,
      loanType: 'BRIDGE',
      lender: 'QA Portfolio Lender',
      principalAmt: 1_000_000,
      interestRate: 9.5,
      termMonths: 12,
      maturityDate: monthsFromNow(9),
      currentBalance: 850_000,
      monthlyPayment: 9_800,
      notes: 'QA fixture: project-level loan (must NOT appear on any building page).',
    } as any, SENSITIVE_LOAN_FIELDS as any) as any,
  });

  console.log(`\nSeeded "${project.name}"  (/projects/${project.id})`);
  console.log('  B-ALPHA    cover photo · 4 units in 4 statuses · building loan · unit lease + partly-paid deposit · 4 docs');
  console.log('  B-BRAVO    NO cover photo · 2 units · building-level lease + settled TI allowance · 1 doc');
  console.log('  B-CHARLIE  zero units (empty state)');
  console.log('  + 1 project-level loan, which must NOT show on a building page');
  console.log('\nRemove with: npx tsx prisma/seed-qa-building.ts --reset');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
