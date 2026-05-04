import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---- Helpers ----
function randomBetween(min: number, max: number) {
  return Math.round(min + Math.random() * (max - min));
}

function randomDate(start: Date, end: Date) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

function monthsFromNow(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d;
}

// ---- Project-specific financial profiles ----
interface ProjectProfile {
  slug: string;
  budgetMultiplier: number; // total budget in millions
  spendPct: number;         // % of budget spent
  commitPct: number;        // % of budget committed
  loanPrincipal: number;    // in millions
  loanRate: number;
  loanType: 'CONSTRUCTION' | 'PERMANENT' | 'BRIDGE' | 'MEZZANINE' | 'SBA';
  lender: string;
  loanTermMonths: number;
  maturityMonths: number;   // months from now
  rentPerUnit: number;      // monthly rent per leased unit
  salePricePerSqft: number;
}

const profiles: ProjectProfile[] = [
  {
    slug: 'centro-plaza',
    budgetMultiplier: 18.5,
    spendPct: 0.82,
    commitPct: 0.91,
    loanPrincipal: 13.2,
    loanRate: 6.75,
    loanType: 'CONSTRUCTION',
    lender: 'Frost Bank',
    loanTermMonths: 36,
    maturityMonths: 8,
    rentPerUnit: 3200,
    salePricePerSqft: 460,
  },
  {
    slug: 'lewisville-phase-1',
    budgetMultiplier: 12.8,
    spendPct: 0.95,
    commitPct: 0.97,
    loanPrincipal: 9.0,
    loanRate: 5.85,
    loanType: 'PERMANENT',
    lender: 'Veritex Community Bank',
    loanTermMonths: 120,
    maturityMonths: 84,
    rentPerUnit: 2800,
    salePricePerSqft: 420,
  },
  {
    slug: 'lewisville-phase-2',
    budgetMultiplier: 8.2,
    spendPct: 0.35,
    commitPct: 0.68,
    loanPrincipal: 6.0,
    loanRate: 7.25,
    loanType: 'CONSTRUCTION',
    lender: 'Independent Financial',
    loanTermMonths: 24,
    maturityMonths: 18,
    rentPerUnit: 2600,
    salePricePerSqft: 380,
  },
  {
    slug: 'rrc-phase-1',
    budgetMultiplier: 15.4,
    spendPct: 0.97,
    commitPct: 0.99,
    loanPrincipal: 10.8,
    loanRate: 5.50,
    loanType: 'PERMANENT',
    lender: 'Prosperity Bank',
    loanTermMonths: 120,
    maturityMonths: 96,
    rentPerUnit: 3600,
    salePricePerSqft: 500,
  },
  {
    slug: 'rrc-phase-2',
    budgetMultiplier: 10.6,
    spendPct: 0.72,
    commitPct: 0.85,
    loanPrincipal: 7.5,
    loanRate: 6.50,
    loanType: 'CONSTRUCTION',
    lender: 'Texas Capital Bank',
    loanTermMonths: 36,
    maturityMonths: 14,
    rentPerUnit: 3400,
    salePricePerSqft: 480,
  },
  {
    slug: 'spur-plaza',
    budgetMultiplier: 22.0,
    spendPct: 0.08,
    commitPct: 0.15,
    loanPrincipal: 15.5,
    loanRate: 7.50,
    loanType: 'BRIDGE',
    lender: 'Origin Bank',
    loanTermMonths: 24,
    maturityMonths: 22,
    rentPerUnit: 2900,
    salePricePerSqft: 440,
  },
  {
    slug: 'leander',
    budgetMultiplier: 14.2,
    spendPct: 0.65,
    commitPct: 0.78,
    loanPrincipal: 10.0,
    loanRate: 6.85,
    loanType: 'CONSTRUCTION',
    lender: 'Southside Bank',
    loanTermMonths: 36,
    maturityMonths: 12,
    rentPerUnit: 3100,
    salePricePerSqft: 430,
  },
];

const BUDGET_CATEGORIES = [
  { category: 'LAND_ACQUISITION', pct: 0.18, desc: 'Land purchase and closing costs' },
  { category: 'SITE_WORK', pct: 0.08, desc: 'Grading, utilities, and site preparation' },
  { category: 'HARD_COSTS', pct: 0.45, desc: 'General contractor and construction' },
  { category: 'SOFT_COSTS', pct: 0.10, desc: 'Architecture, engineering, and consulting' },
  { category: 'FINANCING', pct: 0.06, desc: 'Loan origination, interest carry, and fees' },
  { category: 'PERMITS_FEES', pct: 0.03, desc: 'Building permits and impact fees' },
  { category: 'CONTINGENCY', pct: 0.05, desc: 'Construction contingency reserve' },
  { category: 'MARKETING', pct: 0.03, desc: 'Marketing, signage, and leasing commissions' },
  { category: 'LEGAL', pct: 0.02, desc: 'Legal fees and title insurance' },
] as const;

const VENDORS = [
  'Hensel Phelps Construction', 'Rogers-O\'Brien Construction', 'Balfour Beatty',
  'Manhattan Construction', 'Pepper Construction', 'Adolfson & Peterson',
  'JE Dunn Construction', 'Whiting-Turner Contracting', 'Kimley-Horn',
  'Pacheco Koch', 'BGE Inc', 'Halff Associates', 'Pape-Dawson Engineers',
  'Studio Outside Landscape', 'Summit Commercial Roofing', 'TDIndustries',
];

async function main() {
  console.log('💰 Seeding financial data...\n');

  // Clean existing financial data
  console.log('🧹 Cleaning existing financial records...');
  await prisma.sale.deleteMany();
  await prisma.lease.deleteMany();
  await prisma.drawRequest.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.actual.deleteMany();
  await prisma.commitment.deleteMany();
  await prisma.budgetLine.deleteMany();

  const allProjects = await prisma.project.findMany({
    include: {
      buildings: {
        include: {
          units: true,
        },
      },
    },
  });

  for (const profile of profiles) {
    const project = allProjects.find((p) => p.slug === profile.slug);
    if (!project) {
      console.log(`⚠️  Skipping ${profile.slug} — not found`);
      continue;
    }

    console.log(`📦 ${project.name} (${profile.slug})`);
    const totalBudget = profile.budgetMultiplier * 1_000_000;

    // ---- 1. Budget Lines ----
    const budgetLines = [];
    for (const cat of BUDGET_CATEGORIES) {
      const baseAmt = Math.round(totalBudget * cat.pct);
      const revised = Math.random() > 0.6 ? Math.round(baseAmt * (1 + (Math.random() * 0.15 - 0.05))) : null;
      budgetLines.push({
        projectId: project.id,
        category: cat.category,
        description: cat.desc,
        baselineAmt: baseAmt,
        revisedAmt: revised,
      });
    }
    await prisma.budgetLine.createMany({ data: budgetLines });
    console.log(`   📊 ${budgetLines.length} budget lines (total: $${(totalBudget / 1e6).toFixed(1)}M)`);

    // ---- 2. Actuals (spending transactions) ----
    const totalSpend = totalBudget * profile.spendPct;
    const actuals = [];
    for (const cat of BUDGET_CATEGORIES) {
      const catBudget = totalBudget * cat.pct;
      // Distribute spend with some variance per category
      const catSpendPct = profile.spendPct + (Math.random() * 0.2 - 0.1);
      const catSpend = Math.min(catBudget * Math.max(0, catSpendPct), catBudget * 1.1);
      // Create 3-8 transactions per category
      const txnCount = randomBetween(3, 8);
      for (let i = 0; i < txnCount; i++) {
        const amount = Math.round((catSpend / txnCount) * (0.6 + Math.random() * 0.8));
        if (amount <= 0) continue;
        actuals.push({
          projectId: project.id,
          category: cat.category,
          description: `${cat.desc} - Payment ${i + 1}`,
          amount,
          txnDate: randomDate(monthsAgo(18), new Date()),
          vendor: VENDORS[randomBetween(0, VENDORS.length - 1)],
          qbSyncStatus: Math.random() > 0.2 ? 'SYNCED' as const : 'PENDING' as const,
        });
      }
    }
    await prisma.actual.createMany({ data: actuals });
    console.log(`   💸 ${actuals.length} actual transactions`);

    // ---- 3. Commitments ----
    const commitments = [];
    const usedVendors = new Set<string>();
    for (const cat of BUDGET_CATEGORIES) {
      if (Math.random() > 0.7) continue; // not all categories have commitments
      const catBudget = totalBudget * cat.pct;
      const commitAmt = Math.round(catBudget * profile.commitPct * (0.8 + Math.random() * 0.4));
      let vendor: string;
      do {
        vendor = VENDORS[randomBetween(0, VENDORS.length - 1)];
      } while (usedVendors.has(vendor) && usedVendors.size < VENDORS.length);
      usedVendors.add(vendor);

      const paidPct = Math.min(profile.spendPct / profile.commitPct, 1) * (0.7 + Math.random() * 0.3);
      commitments.push({
        projectId: project.id,
        vendor,
        description: `${cat.desc} contract`,
        contractAmt: commitAmt,
        paidToDate: Math.round(commitAmt * paidPct),
        retainage: Math.round(commitAmt * 0.05),
        category: cat.category,
        contractDate: randomDate(monthsAgo(24), monthsAgo(6)),
      });
    }
    await prisma.commitment.createMany({ data: commitments });
    console.log(`   📝 ${commitments.length} commitments`);

    // ---- 4. Loans ----
    const principal = profile.loanPrincipal * 1_000_000;
    const balancePct = 1 - (profile.spendPct * 0.3); // higher spend = more drawn down
    const currentBalance = Math.round(principal * balancePct);
    const monthlyPayment = Math.round((principal * (profile.loanRate / 100 / 12)) / (1 - Math.pow(1 + profile.loanRate / 100 / 12, -profile.loanTermMonths)));

    const loan = await prisma.loan.create({
      data: {
        projectId: project.id,
        loanType: profile.loanType,
        lender: profile.lender,
        principalAmt: principal,
        interestRate: profile.loanRate,
        termMonths: profile.loanTermMonths,
        maturityDate: monthsFromNow(profile.maturityMonths),
        currentBalance,
        monthlyPayment,
        encryptedFields: null, // seeded without encryption for dev
      },
    });

    // Add draw requests for construction loans
    if (profile.loanType === 'CONSTRUCTION' || profile.loanType === 'BRIDGE') {
      const drawCount = randomBetween(3, 6);
      const drawAmount = Math.round(principal * profile.spendPct / drawCount);
      for (let i = 1; i <= drawCount; i++) {
        const reqDate = randomDate(monthsAgo(18), monthsAgo(1));
        await prisma.drawRequest.create({
          data: {
            loanId: loan.id,
            drawNumber: i,
            amount: drawAmount + randomBetween(-50000, 50000),
            requestDate: reqDate,
            approvedAt: new Date(reqDate.getTime() + randomBetween(3, 14) * 86400000),
            fundedAt: new Date(reqDate.getTime() + randomBetween(7, 21) * 86400000),
            status: 'FUNDED',
          },
        });
      }
      console.log(`   🏦 Loan: $${(principal / 1e6).toFixed(1)}M @ ${profile.loanRate}% (${profile.loanType}) + ${drawCount} draws`);
    } else {
      console.log(`   🏦 Loan: $${(principal / 1e6).toFixed(1)}M @ ${profile.loanRate}% (${profile.loanType})`);
    }

    // Add a second smaller loan for some projects
    if (['centro-plaza', 'rrc-phase-1', 'spur-plaza'].includes(profile.slug)) {
      const mezzPrincipal = Math.round(principal * 0.15);
      await prisma.loan.create({
        data: {
          projectId: project.id,
          loanType: 'MEZZANINE',
          lender: 'Pearlmark Real Estate Finance',
          principalAmt: mezzPrincipal,
          interestRate: 9.25,
          termMonths: 60,
          maturityDate: monthsFromNow(48),
          currentBalance: mezzPrincipal,
          monthlyPayment: Math.round(mezzPrincipal * 0.00925 / 12),
          encryptedFields: null,
        },
      });
      console.log(`   🏦 Mezzanine: $${(mezzPrincipal / 1e6).toFixed(1)}M @ 9.25%`);
    }

    // ---- 5. Leases (for LEASED units) ----
    const allUnits = project.buildings.flatMap((b) => b.units);
    const leasedUnits = allUnits.filter((u) => u.status === 'LEASED');

    const tenantNames = [
      'Subway', 'Great Clips', 'H&R Block', 'State Farm Insurance',
      'Edward Jones', 'Allstate', 'Cricket Wireless', 'T-Mobile',
      'Kumon', 'Mathnasium', 'The UPS Store', 'Anytime Fitness',
      'Orange Theory', 'European Wax Center', 'Massage Envy',
      'Pho District', 'Halal Guys', 'Wingstop', 'Raising Canes',
      'Nothing Bundt Cakes', 'Crumbl Cookies', 'Tropical Smoothie',
      'Dominos', 'Papa Johns', 'MOD Pizza', 'Chipotle',
      'Dentists of North Texas', 'CityVet', 'Urgent Care Plus',
    ];

    let leaseCount = 0;
    for (const unit of leasedUnits) {
      const tenant = tenantNames[leaseCount % tenantNames.length];
      const sqft = unit.sqft ?? 1500;
      const monthlyRent = Math.round(profile.rentPerUnit * (sqft / 1500) * (0.85 + Math.random() * 0.3));
      const leaseStartMonths = randomBetween(6, 24);
      const termMonths = [36, 60, 84, 120][randomBetween(0, 3)];
      const leaseStart = monthsAgo(leaseStartMonths);
      const leaseEnd = new Date(leaseStart);
      leaseEnd.setMonth(leaseEnd.getMonth() + termMonths);

      await prisma.lease.create({
        data: {
          unitId: unit.id,
          tenantName: tenant,
          tenantContact: `${tenant.toLowerCase().replace(/[^a-z]/g, '')}@email.com`,
          monthlyRent,
          rentPerSqft: Math.round((monthlyRent / sqft) * 100) / 100,
          leaseStart,
          leaseEnd,
          termMonths,
          escalationPct: [2.0, 2.5, 3.0][randomBetween(0, 2)],
          escalationFreq: 12,
          securityDeposit: monthlyRent * 2,
          status: 'ACTIVE',
        },
      });
      leaseCount++;
    }
    if (leaseCount > 0) {
      console.log(`   📋 ${leaseCount} leases (avg $${profile.rentPerUnit}/mo)`);
    }

    // Add a few expired leases for variety
    const availableUnits = allUnits.filter((u) => u.status === 'AVAILABLE');
    const expiredCount = Math.min(randomBetween(1, 3), availableUnits.length);
    for (let i = 0; i < expiredCount; i++) {
      const unit = availableUnits[i];
      const sqft = unit.sqft ?? 1500;
      const monthlyRent = Math.round(profile.rentPerUnit * (sqft / 1500) * 0.85);
      const leaseStart = monthsAgo(randomBetween(36, 60));
      const leaseEnd = monthsAgo(randomBetween(1, 6));

      await prisma.lease.create({
        data: {
          unitId: unit.id,
          tenantName: `Former Tenant ${i + 1}`,
          monthlyRent,
          leaseStart,
          leaseEnd,
          termMonths: 36,
          status: 'EXPIRED',
        },
      });
    }

    // ---- 6. Sales (for SOLD units) ----
    const soldUnits = allUnits.filter((u) => u.status === 'SOLD');
    let saleCount = 0;
    for (const unit of soldUnits) {
      const sqft = unit.sqft ?? 1500;
      const salePrice = Math.round(sqft * profile.salePricePerSqft * (0.9 + Math.random() * 0.2));
      const depositAmt = Math.round(salePrice * 0.10);
      const createdAt = randomDate(monthsAgo(18), monthsAgo(2));
      const closingDate = new Date(createdAt.getTime() + randomBetween(30, 120) * 86400000);

      await prisma.sale.create({
        data: {
          projectId: project.id,
          unitId: unit.id,
          buyer: unit.notes?.includes('Buyer:') ? unit.notes.split('Buyer: ')[1]?.split(' | ')[0] : `Buyer ${saleCount + 1}`,
          salePrice,
          depositAmt,
          status: 'CLOSED',
          loiDate: new Date(createdAt.getTime() + randomBetween(5, 15) * 86400000),
          contractDate: new Date(createdAt.getTime() + randomBetween(15, 30) * 86400000),
          closingDate,
        },
      });
      saleCount++;
    }

    // Add pipeline deals (prospects / under contract) for available units
    const pipelineCount = Math.min(randomBetween(2, 5), availableUnits.length - expiredCount);
    for (let i = expiredCount; i < expiredCount + pipelineCount && i < availableUnits.length; i++) {
      const unit = availableUnits[i];
      const sqft = unit.sqft ?? 1500;
      const salePrice = Math.round(sqft * profile.salePricePerSqft * (0.95 + Math.random() * 0.1));
      const statuses: Array<'PROSPECT' | 'LOI_SIGNED' | 'UNDER_CONTRACT'> = ['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT'];
      const status = statuses[randomBetween(0, 2)];

      await prisma.sale.create({
        data: {
          projectId: project.id,
          unitId: unit.id,
          buyer: `Prospect ${String.fromCharCode(65 + i)}`,
          salePrice,
          depositAmt: status === 'UNDER_CONTRACT' ? Math.round(salePrice * 0.10) : null,
          status,
          loiDate: status !== 'PROSPECT' ? randomDate(monthsAgo(3), new Date()) : null,
          contractDate: status === 'UNDER_CONTRACT' ? randomDate(monthsAgo(2), new Date()) : null,
        },
      });
    }

    if (saleCount > 0 || pipelineCount > 0) {
      console.log(`   🤝 ${saleCount} closed sales + ${pipelineCount} pipeline deals`);
    }
  }

  // ---- Summary ----
  const counts = await Promise.all([
    prisma.budgetLine.count(),
    prisma.actual.count(),
    prisma.commitment.count(),
    prisma.loan.count(),
    prisma.lease.count(),
    prisma.sale.count(),
  ]);

  console.log('\n✅ Financial data seeded!');
  console.log(`   📊 Budget lines: ${counts[0]}`);
  console.log(`   💸 Actuals: ${counts[1]}`);
  console.log(`   📝 Commitments: ${counts[2]}`);
  console.log(`   🏦 Loans: ${counts[3]}`);
  console.log(`   📋 Leases: ${counts[4]}`);
  console.log(`   🤝 Sales: ${counts[5]}`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
