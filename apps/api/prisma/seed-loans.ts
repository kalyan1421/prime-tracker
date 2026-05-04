import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Map Excel project names to DB slugs
const PROJECT_MAP: Record<string, string> = {
  'Centro Plaza': 'centro-plaza',
  'RRC1': 'rrc-phase-1',
  'RRC2': 'rrc-phase-2',
  'Prime Leander': 'leander',
  'Prime Lewisville Phase 1': 'lewisville-phase-1',
  'Lewisville Phase 1': 'lewisville-phase-1',
};

function parseTermMonths(term: string): number {
  const t = term.trim().toUpperCase();
  // Formats: "360M", "60M", "12M", "52M", "5Y+25Y"
  if (t.includes('+')) {
    // "5Y+25Y" -> total years
    const parts = t.split('+');
    let total = 0;
    for (const p of parts) {
      if (p.endsWith('Y')) total += parseInt(p) * 12;
      else if (p.endsWith('M')) total += parseInt(p);
    }
    return total || 60;
  }
  if (t.endsWith('M')) return parseInt(t) || 60;
  if (t.endsWith('Y')) return (parseInt(t) || 5) * 12;
  return parseInt(t) || 60;
}

interface LoanInput {
  company: string;
  bank: string;
  projectSlug: string;
  unitNumbers: string[];
  description: string;
  loanAmount: number;
  emi: number;
  interestRate: number;
  termMonths: number;
  loanDate: string;
  closingDate: string;
  outstanding: number;
  notes: string;
  loanType: 'PERMANENT' | 'CONSTRUCTION' | 'BRIDGE' | 'MEZZANINE' | 'SBA';
}

const LOANS: LoanInput[] = [
  // ---- Active Unit Loans ----
  {
    company: 'Texas Hazelwood Fund LLC - 300',
    bank: 'Cadence Bank',
    projectSlug: 'rrc-phase-2',
    unitNumbers: ['300'],
    description: '300-in RRC1',
    loanAmount: 867561,
    emi: 6881,
    interestRate: 7.99,
    termMonths: 360,
    loanDate: '2023-09-23',
    closingDate: '2053-09-01',
    outstanding: 849642.67,
    notes: 'Unit 300 loan',
    loanType: 'PERMANENT',
  },
  {
    company: 'Centro Plaza Texas LLC (Building 1)',
    bank: 'Security State Bank & Trust',
    projectSlug: 'centro-plaza',
    unitNumbers: ['101', '102', '103', '104', '105', '106'],
    description: 'Bldg 1 (101,102,103,104,105,106) in Centro Plaza',
    loanAmount: 2100000,
    emi: 20875.29,
    interestRate: 9.5,
    termMonths: 180,
    loanDate: '2024-06-12',
    closingDate: '2039-06-01',
    outstanding: 1988571.08,
    notes: 'Units 104,105,106 will be sold (Sangam)',
    loanType: 'PERMANENT',
  },
  {
    company: 'Centro Plaza BLDG 2 LLC (Building 2)',
    bank: 'Hancock Whitney Bank',
    projectSlug: 'centro-plaza',
    unitNumbers: ['201', '202', '203', '204'],
    description: 'Bldg 2 (201,202,203 & 204) in Centro Plaza',
    loanAmount: 1527800,
    emi: 10604.03,
    interestRate: 6.8,
    termMonths: 60,
    loanDate: '2024-09-22',
    closingDate: '2029-08-29',
    outstanding: 1495545.16,
    notes: '',
    loanType: 'PERMANENT',
  },
  {
    company: 'Prime Leander 301 LLC',
    bank: 'Hancock Whitney Bank',
    projectSlug: 'leander',
    unitNumbers: ['301'],
    description: '301-Vacant in Prime Leander',
    loanAmount: 354218,
    emi: 2531.85,
    interestRate: 7.125,
    termMonths: 60,
    loanDate: '2024-12-09',
    closingDate: '2029-12-09',
    outstanding: 348447.44,
    notes: '',
    loanType: 'PERMANENT',
  },
  {
    company: 'TPD Texas LLC - Loan against Units in 8 and 9',
    bank: 'Hornett Debt Fund LLC',
    projectSlug: 'centro-plaza',
    unitNumbers: ['805', '807', '809', '811', '813', '815'],
    description: '8 & 9 in Centro Plaza Property Loan',
    loanAmount: 2800000,
    emi: 34983.9,
    interestRate: 12.5,
    termMonths: 12,
    loanDate: '2024-12-12',
    closingDate: '2026-04-12',
    outstanding: 759699.04,
    notes: 'After partial payoff. Two 3-month extensions with 1% fee.',
    loanType: 'BRIDGE',
  },
  {
    company: 'Texas Hazelwood OP 1 LLC',
    bank: 'Texas Regional Bank',
    projectSlug: 'rrc-phase-2',
    unitNumbers: ['1001', '1002'],
    description: '1001 & 1002',
    loanAmount: 1700000,
    emi: 12969,
    interestRate: 6.75,
    termMonths: 360,
    loanDate: '2025-04-25',
    closingDate: '2055-04-01',
    outstanding: 1672580.3,
    notes: '',
    loanType: 'PERMANENT',
  },
  {
    company: 'Texas Hazelwood OP 2 LLC',
    bank: 'Hancock Whitney Bank',
    projectSlug: 'rrc-phase-2',
    unitNumbers: ['901', '902'],
    description: '901 & 902',
    loanAmount: 2038788,
    emi: 14279.53,
    interestRate: 6.8,
    termMonths: 60,
    loanDate: '2025-04-16',
    closingDate: '2030-04-16',
    outstanding: 2015660.27,
    notes: '',
    loanType: 'PERMANENT',
  },
  {
    company: 'Texas Hazelwood OP 2 LLC',
    bank: 'Hancock Whitney Bank',
    projectSlug: 'rrc-phase-1',
    unitNumbers: ['700', '701', '702'],
    description: '700, 701 & 702',
    loanAmount: 1398352,
    emi: 9744.32,
    interestRate: 6.8,
    termMonths: 60,
    loanDate: '2025-09-05',
    closingDate: '2030-09-05',
    outstanding: 1391311.01,
    notes: '',
    loanType: 'PERMANENT',
  },
  {
    company: 'Texas Hazelwood Retail Phase 2 LLC',
    bank: 'Security State Bank & Trust',
    projectSlug: 'rrc-phase-2',
    unitNumbers: ['1101', '1108', '1201'],
    description: '1101, 1108, 1201',
    loanAmount: 1971020.32,
    emi: 19983.18,
    interestRate: 8.75,
    termMonths: 180,
    loanDate: '2024-12-12',
    closingDate: '2039-10-01',
    outstanding: 1909308.77,
    notes: '',
    loanType: 'PERMANENT',
  },
  {
    company: 'Prime Lewisville GP3 LLC',
    bank: 'Hornett Debt Fund LLC',
    projectSlug: 'lewisville-phase-1',
    unitNumbers: ['401', '402', '403', '404', '501', '504', '505', '506', '507', '509', '511', '513', '515', '516'],
    description: 'Building 4 & 5 units in Prime Lewisville',
    loanAmount: 5900000,
    emi: 66705.67,
    interestRate: 12.5,
    termMonths: 12,
    loanDate: '2025-06-20',
    closingDate: '2026-06-20',
    outstanding: 5567724.44,
    notes: 'After closing 504, two 3-month extensions with 1% fee.',
    loanType: 'BRIDGE',
  },
  {
    company: 'Centro Plaza BLDG 8 LLC (Building 8)',
    bank: 'First United Bank',
    projectSlug: 'centro-plaza',
    unitNumbers: ['805', '807', '809', '811', '813', '815'],
    description: 'Bldg 8 (805,807,809,811,813,815) in Centro Plaza',
    loanAmount: 1785550,
    emi: 0,
    interestRate: 6.5,
    termMonths: 60,
    loanDate: '2025-11-26',
    closingDate: '2030-11-26',
    outstanding: 1499488.12,
    notes: '$425,230 was kept as Escrow Holdback',
    loanType: 'PERMANENT',
  },

  // ---- Construction Loans ----
  {
    company: 'TPD Texas LLC-5.25 - Refinanced',
    bank: 'Hornett Debt Fund LLC',
    projectSlug: 'centro-plaza',
    unitNumbers: [],
    description: '5,6,7 & 10 in Centro Plaza Construction Loan',
    loanAmount: 5250000,
    emi: 13488.81,
    interestRate: 12.5,
    termMonths: 12,
    loanDate: '2024-08-29',
    closingDate: '2026-02-28',
    outstanding: 729363.98,
    notes: 'Two 3-month extensions with 1% fee already taken',
    loanType: 'CONSTRUCTION',
  },
  {
    company: 'TPD Texas LLC - Refinanced 3.00',
    bank: 'Hornett Debt Fund LLC',
    projectSlug: 'centro-plaza',
    unitNumbers: [],
    description: '5,6,7 & 10 in Centro Plaza',
    loanAmount: 3000000,
    emi: 31275,
    interestRate: 12.5,
    termMonths: 12,
    loanDate: '2025-02-19',
    closingDate: '2026-06-19',
    outstanding: 3000000,
    notes: 'Two 3-month extensions with 1% fee',
    loanType: 'CONSTRUCTION',
  },
  {
    company: 'TPD Texas LLC - Refinanced 4.5',
    bank: 'Hornett Debt Fund LLC',
    projectSlug: 'centro-plaza',
    unitNumbers: [],
    description: '5,6,7 & 10 in Centro Plaza',
    loanAmount: 4500000,
    emi: 26818.5,
    interestRate: 12.5,
    termMonths: 12,
    loanDate: '2025-04-29',
    closingDate: '2026-04-29',
    outstanding: 3328015.19,
    notes: 'Remaining balance of $1,171,984.81 yet to take',
    loanType: 'CONSTRUCTION',
  },
  {
    company: 'TPD Texas LLC - Heavy Equipment 850L',
    bank: 'John Deere Financials',
    projectSlug: 'centro-plaza', // Equipment loans - assign to main project
    unitNumbers: [],
    description: 'TPD Texas Equipment Loan - 850L',
    loanAmount: 643389,
    emi: 11878.76,
    interestRate: 4.1,
    termMonths: 60,
    loanDate: '2023-01-23',
    closingDate: '2028-01-23',
    outstanding: 263175.48,
    notes: 'Equipment Loan',
    loanType: 'CONSTRUCTION',
  },
  {
    company: 'TPD Texas LLC - Heavy Equipment 350P',
    bank: 'John Deere Financials',
    projectSlug: 'centro-plaza', // Equipment loans - assign to main project
    unitNumbers: [],
    description: 'TPD Texas Equipment Loan - 350P',
    loanAmount: 510125,
    emi: 9417.74,
    interestRate: 4.1,
    termMonths: 60,
    loanDate: '2023-02-24',
    closingDate: '2028-02-24',
    outstanding: 217533.93,
    notes: 'Equipment Loan',
    loanType: 'CONSTRUCTION',
  },
  {
    company: 'Prime Office Warehouses Leander LLC (Building 2)',
    bank: 'SouthStar Bank',
    projectSlug: 'leander',
    unitNumbers: [],
    description: 'Bldg 2 in Prime Leander Construction Loan',
    loanAmount: 2400000,
    emi: 17116.95,
    interestRate: 7.5,
    termMonths: 360,
    loanDate: '2025-11-20',
    closingDate: '2032-11-20',
    outstanding: 138108.68,
    notes: 'Remaining $2,261,891.32 yet to take. $150,000 Escrow Holdback.',
    loanType: 'CONSTRUCTION',
  },
  {
    company: 'Prime Office Warehouses Leander LLC (Building 4)',
    bank: 'Texas Heritage National Bank',
    projectSlug: 'leander',
    unitNumbers: [],
    description: 'Bldg 4 in Prime Leander Construction Loan',
    loanAmount: 2426400,
    emi: 18022.63,
    interestRate: 8.75,
    termMonths: 12,
    loanDate: '2024-12-18',
    closingDate: '2026-03-18',
    outstanding: 2175164.34,
    notes: '',
    loanType: 'CONSTRUCTION',
  },
];

async function main() {
  console.log('Seeding loans from Excel data...\n');

  // Build project lookup
  const projects = await prisma.project.findMany({
    include: { buildings: { include: { units: true } } },
  });
  const projectBySlug = new Map(projects.map((p) => [p.slug, p]));

  let created = 0;
  let skipped = 0;

  for (const loan of LOANS) {
    const project = projectBySlug.get(loan.projectSlug);
    if (!project) {
      console.log(`  SKIP: No project for slug "${loan.projectSlug}" - ${loan.company}`);
      skipped++;
      continue;
    }

    // Try to find the first matching unit for linking
    let unitId: string | undefined;
    if (loan.unitNumbers.length > 0) {
      const allUnits = project.buildings.flatMap((b) => b.units);
      const firstUnit = allUnits.find((u) => loan.unitNumbers.includes(u.unitNumber));
      if (firstUnit) unitId = firstUnit.id;
    }

    // Check if loan already exists (by lender + project + principal)
    const existing = await prisma.loan.findFirst({
      where: {
        projectId: project.id,
        lender: loan.bank,
        principalAmt: loan.loanAmount,
      },
    });

    if (existing) {
      console.log(`  EXISTS: ${loan.bank} - $${loan.loanAmount.toLocaleString()} for ${project.name}`);
      skipped++;
      continue;
    }

    await prisma.loan.create({
      data: {
        projectId: project.id,
        unitId: unitId || null,
        loanType: loan.loanType,
        lender: loan.bank,
        principalAmt: loan.loanAmount,
        interestRate: loan.interestRate,
        termMonths: loan.termMonths,
        maturityDate: loan.closingDate ? new Date(loan.closingDate) : null,
        currentBalance: loan.outstanding,
        monthlyPayment: loan.emi || null,
        notes: `${loan.company}${loan.description ? ' - ' + loan.description : ''}${loan.notes ? '. ' + loan.notes : ''}`,
      },
    });

    console.log(`  OK: ${loan.bank} - ${loan.loanType} - $${loan.loanAmount.toLocaleString()} -> ${project.name}${unitId ? ' (linked to unit)' : ''}`);
    created++;
  }

  console.log(`\nDone! Created: ${created}, Skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
