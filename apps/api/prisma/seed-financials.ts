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
      // Planned (future) draws → forward cash-flow inflows on the projection.
      const plannedCount = randomBetween(2, 4);
      const plannedAmt = Math.round((principal * profile.spendPct * 0.4) / plannedCount);
      for (let i = 1; i <= plannedCount; i++) {
        await prisma.drawSchedule.create({
          data: {
            loanId: loan.id,
            drawNumber: drawCount + i,
            plannedAmount: plannedAmt + randomBetween(-30000, 30000),
            plannedDate: monthsFromNow(i * 2), // staggered every ~2 months out
            description: `Planned draw ${drawCount + i}`,
          },
        });
      }
      console.log(`   🏦 Loan: $${(principal / 1e6).toFixed(1)}M @ ${profile.loanRate}% (${profile.loanType}) + ${drawCount} draws + ${plannedCount} planned`);
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

  // ============================================================
  // MILESTONES (per project, all phases)
  // ============================================================
  console.log('\n🏁 Seeding milestones...');
  await prisma.milestone.deleteMany();

  const MILESTONE_TEMPLATES = [
    { title: 'Land Acquisition Closed', phase: 'PRE_DEVELOPMENT' as const, offsetMonths: -24, durationDays: 0 },
    { title: 'Schematic Design Complete', phase: 'PRE_DEVELOPMENT' as const, offsetMonths: -22, durationDays: 0 },
    { title: 'Building Permits Submitted', phase: 'PERMITTING' as const, offsetMonths: -20, durationDays: 0 },
    { title: 'Building Permits Approved', phase: 'PERMITTING' as const, offsetMonths: -17, durationDays: 0 },
    { title: 'GC Contract Executed', phase: 'CONSTRUCTION' as const, offsetMonths: -16, durationDays: 0 },
    { title: 'Site Work & Demo Complete', phase: 'CONSTRUCTION' as const, offsetMonths: -14, durationDays: 0 },
    { title: 'Foundation Poured', phase: 'CONSTRUCTION' as const, offsetMonths: -12, durationDays: 0 },
    { title: 'Structural Steel / Frame Complete', phase: 'CONSTRUCTION' as const, offsetMonths: -9, durationDays: 0 },
    { title: 'MEP Rough-In Complete', phase: 'CONSTRUCTION' as const, offsetMonths: -7, durationDays: 0 },
    { title: 'Roof & Envelope Closed', phase: 'CONSTRUCTION' as const, offsetMonths: -5, durationDays: 0 },
    { title: 'Certificate of Occupancy', phase: 'LEASE_UP' as const, offsetMonths: -3, durationDays: 0 },
    { title: 'Grand Opening / First Tenants', phase: 'LEASE_UP' as const, offsetMonths: -2, durationDays: 0 },
    { title: '80% Occupancy Achieved', phase: 'STABILIZED' as const, offsetMonths: 3, durationDays: 0 },
    { title: 'Stabilization / Refinance', phase: 'STABILIZED' as const, offsetMonths: 8, durationDays: 0 },
  ];

  const phaseSpendMap: Record<string, number> = {
    PRE_DEVELOPMENT: 0.0,
    PERMITTING: 0.10,
    CONSTRUCTION: 0.55,
    LEASE_UP: 0.85,
    STABILIZED: 1.0,
    SOLD_REFI: 1.0,
  };

  const allProjectsForMilestones = await prisma.project.findMany({ select: { id: true, slug: true, phase: true } });
  for (const proj of allProjectsForMilestones) {
    const profile = profiles.find((p) => p.slug === proj.slug);
    const spendPct = profile?.spendPct ?? 0.5;
    const phaseOrder = ['PRE_DEVELOPMENT', 'PERMITTING', 'CONSTRUCTION', 'LEASE_UP', 'STABILIZED', 'SOLD_REFI'];
    const currentPhaseIdx = phaseOrder.indexOf(proj.phase);

    for (let i = 0; i < MILESTONE_TEMPLATES.length; i++) {
      const tpl = MILESTONE_TEMPLATES[i];
      const dueDate = new Date();
      dueDate.setMonth(dueDate.getMonth() + tpl.offsetMonths);

      const tplPhaseIdx = phaseOrder.indexOf(tpl.phase);
      let status: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED' | 'OVERDUE';
      let completedAt: Date | null = null;

      if (tplPhaseIdx < currentPhaseIdx) {
        status = 'COMPLETED';
        completedAt = new Date(dueDate.getTime() + randomBetween(-5, 10) * 86400000);
      } else if (tplPhaseIdx === currentPhaseIdx) {
        // Some in-progress, some overdue
        const halfway = i >= Math.floor(MILESTONE_TEMPLATES.length * spendPct);
        status = halfway ? 'NOT_STARTED' : dueDate < new Date() ? 'OVERDUE' : 'IN_PROGRESS';
      } else {
        status = 'NOT_STARTED';
      }

      await prisma.milestone.create({
        data: {
          projectId: proj.id,
          title: tpl.title,
          phase: tpl.phase,
          dueDate,
          completedAt,
          status,
          sortOrder: i,
        },
      });
    }
    console.log(`   ✅ ${proj.slug}: ${MILESTONE_TEMPLATES.length} milestones`);
  }

  // ============================================================
  // VENDORS + CONTRACTS
  // ============================================================
  console.log('\n🏗️  Seeding vendors & contracts...');
  await prisma.contractPayment.deleteMany();
  await prisma.changeOrder.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.vendor.deleteMany();

  const VENDOR_DATA = [
    { name: 'Hensel Phelps Construction', trade: 'General Contractor', contactName: 'Mike Torres', email: 'mtorres@henselphelps.com', phone: '214-555-0101' },
    { name: 'Rogers-O\'Brien Construction', trade: 'General Contractor', contactName: 'Dave Kim', email: 'dkim@rogersobrien.com', phone: '972-555-0102' },
    { name: 'Manhattan Construction', trade: 'General Contractor', contactName: 'Sarah Lee', email: 'slee@manhattanconstruction.com', phone: '469-555-0103' },
    { name: 'Kimley-Horn', trade: 'Civil Engineering', contactName: 'Chris Patel', email: 'cpatel@kimley-horn.com', phone: '214-555-0201' },
    { name: 'Pacheco Koch', trade: 'Civil Engineering', contactName: 'Lisa Nguyen', email: 'lnguyen@pachecock.com', phone: '972-555-0202' },
    { name: 'Halff Associates', trade: 'Engineering', contactName: 'Tom Garcia', email: 'tgarcia@halff.com', phone: '817-555-0203' },
    { name: 'TDIndustries', trade: 'MEP / HVAC', contactName: 'James Wu', email: 'jwu@tdindustries.com', phone: '214-555-0301' },
    { name: 'Summit Commercial Roofing', trade: 'Roofing', contactName: 'Bob Smith', email: 'bsmith@summitroofing.com', phone: '972-555-0401' },
    { name: 'Studio Outside Landscape', trade: 'Landscaping', contactName: 'Amy Chen', email: 'achen@studiooutside.com', phone: '512-555-0501' },
    { name: 'BGE Inc', trade: 'Environmental', contactName: 'Sam Johnson', email: 'sjohnson@bgeinc.com', phone: '713-555-0601' },
    { name: 'Adolfson & Peterson', trade: 'General Contractor', contactName: 'Ryan Park', email: 'rpark@a-p.com', phone: '469-555-0104' },
    { name: 'JE Dunn Construction', trade: 'General Contractor', contactName: 'Maria Lopez', email: 'mlopez@jedunn.com', phone: '214-555-0105' },
  ];

  const vendorRecords = [];
  for (const v of VENDOR_DATA) {
    vendorRecords.push(await prisma.vendor.create({ data: v }));
  }
  console.log(`   🏢 ${vendorRecords.length} vendors created`);

  const allProjectsForContracts = await prisma.project.findMany({ select: { id: true, slug: true } });
  let totalContracts = 0;

  for (const proj of allProjectsForContracts) {
    const profile = profiles.find((p) => p.slug === proj.slug);
    if (!profile) continue;
    const totalBudget = profile.budgetMultiplier * 1_000_000;

    // GC contract (biggest)
    const gcVendors = vendorRecords.filter((v) => v.trade === 'General Contractor');
    const gcVendor = gcVendors[Math.floor(Math.random() * gcVendors.length)];
    const gcOriginal = Math.round(totalBudget * 0.45 * 0.9);
    const gcCurrent = Math.round(gcOriginal * (1 + Math.random() * 0.08));
    const gcStatus = profile.spendPct > 0.9 ? 'COMPLETED' : 'ACTIVE';
    const gcStart = randomDate(monthsAgo(20), monthsAgo(15));

    const gcContract = await prisma.contract.create({
      data: {
        projectId: proj.id,
        vendorId: gcVendor.id,
        description: 'General Construction Contract — Shell & Core',
        originalAmount: gcOriginal,
        currentAmount: gcCurrent,
        status: gcStatus as any,
        startDate: gcStart,
        endDate: gcStatus === 'COMPLETED' ? randomDate(monthsAgo(6), monthsAgo(1)) : monthsFromNow(6),
      },
    });

    // Change orders on GC contract
    const coCount = randomBetween(1, 4);
    for (let co = 1; co <= coCount; co++) {
      const coAmt = randomBetween(15000, 120000);
      await prisma.changeOrder.create({
        data: {
          contractId: gcContract.id,
          number: co,
          description: ['Owner-directed scope addition', 'Site condition unforeseen', 'Value engineering credit', 'Material substitution'][co % 4],
          amount: co === 3 ? -coAmt : coAmt,
          status: co < coCount ? 'APPROVED' : 'PENDING',
          approvedAt: co < coCount ? randomDate(monthsAgo(10), monthsAgo(1)) : null,
        },
      });
    }

    // Contract payments
    const paidAmt = Math.round(gcOriginal * Math.min(profile.spendPct, 0.95));
    const paymentCount = randomBetween(4, 8);
    for (let pay = 0; pay < paymentCount; pay++) {
      await prisma.contractPayment.create({
        data: {
          contractId: gcContract.id,
          amount: Math.round((paidAmt / paymentCount) * (0.8 + Math.random() * 0.4)),
          paidDate: randomDate(monthsAgo(18), monthsAgo(1)),
          notes: pay === 0 ? 'Mobilization payment' : `Progress billing #${pay + 1}`,
        },
      });
    }

    // Engineering / MEP contracts
    const engVendors = vendorRecords.filter((v) => v.trade !== 'General Contractor');
    const contractsToAdd = Math.min(randomBetween(2, 4), engVendors.length);
    for (let e = 0; e < contractsToAdd; e++) {
      const ev = engVendors[e];
      const amt = randomBetween(80000, 500000);
      await prisma.contract.create({
        data: {
          projectId: proj.id,
          vendorId: ev.id,
          description: `${ev.trade} — ${proj.slug.replace(/-/g, ' ').toUpperCase()}`,
          originalAmount: amt,
          currentAmount: amt,
          status: profile.spendPct > 0.8 ? 'COMPLETED' : 'ACTIVE',
          startDate: randomDate(monthsAgo(18), monthsAgo(12)),
          endDate: monthsFromNow(randomBetween(1, 12)),
        },
      });
    }
    totalContracts += 1 + contractsToAdd;
    console.log(`   📋 ${proj.slug}: ${1 + contractsToAdd} contracts`);
  }

  // ============================================================
  // LEADS
  // ============================================================
  console.log('\n🎯 Seeding leads...');
  await prisma.leadActivity.deleteMany();
  await prisma.lead.deleteMany();

  const adminUser = await prisma.user.findFirst({ where: { role: 'FOUNDER' } });
  const salesUserRecord = await prisma.user.findFirst({ where: { role: 'SALES' } });
  if (!adminUser) throw new Error('No founder user found — run seed.ts first');

  const LEAD_NAMES = [
    'Priya Sharma', 'Raj Patel', 'Anita Reddy', 'Suresh Nair', 'Deepa Mehta',
    'Vikram Singh', 'Kavya Iyer', 'Arjun Gupta', 'Neha Joshi', 'Rahul Verma',
    'Sunita Kapoor', 'Arun Kumar', 'Pooja Agarwal', 'Mohan Das', 'Lakshmi Devi',
    'John Mathews', 'Mary Thomas', 'David Sam', 'Anand Raj', 'Geeta Rao',
  ];

  const LEAD_SOURCES: Array<'WEBSITE' | 'SOCIAL_MEDIA' | 'REFERRAL' | 'COLD_CALL' | 'WALK_IN' | 'SIGNAGE' | 'BROKER'> =
    ['WEBSITE', 'REFERRAL', 'SIGNAGE', 'BROKER', 'WALK_IN', 'SOCIAL_MEDIA', 'COLD_CALL'];

  const LEAD_STATUSES: Array<'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL_SENT' | 'NEGOTIATING' | 'LOST'> =
    ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'LOST'];

  const allProjectsForLeads = await prisma.project.findMany({ select: { id: true, slug: true } });
  let totalLeads = 0;

  for (const proj of allProjectsForLeads) {
    const profile = profiles.find((p) => p.slug === proj.slug);
    const leadCount = randomBetween(4, 8);
    for (let i = 0; i < leadCount; i++) {
      const name = LEAD_NAMES[(totalLeads + i) % LEAD_NAMES.length];
      const firstName = name.split(' ')[0];
      const status = LEAD_STATUSES[randomBetween(0, LEAD_STATUSES.length - 1)];
      const budget = profile ? Math.round(profile.salePricePerSqft * randomBetween(1200, 3000)) : 500000;

      const lead = await prisma.lead.create({
        data: {
          projectId: proj.id,
          name,
          email: `${firstName.toLowerCase()}${i + 1}@gmail.com`,
          phone: `214-555-${String(1000 + totalLeads + i).slice(1)}`,
          source: LEAD_SOURCES[randomBetween(0, LEAD_SOURCES.length - 1)],
          status,
          budget,
          unitInterest: `${randomBetween(1000, 3000)} SF ${['retail', 'office', 'flex', 'medical'][randomBetween(0, 3)]} unit`,
          notes: `Interested in ${proj.slug.replace(/-/g, ' ')} project. ${status === 'QUALIFIED' ? 'Pre-qualified buyer.' : ''}`,
          createdBy: adminUser.id,
          assignedTo: salesUserRecord?.id ?? adminUser.id,
        },
      });

      // Add 1-3 activities per lead
      const actCount = randomBetween(1, 3);
      const ACT_TYPES: Array<'CALL' | 'EMAIL' | 'MEETING' | 'SITE_VISIT' | 'FOLLOW_UP'> = ['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'FOLLOW_UP'];
      for (let a = 0; a < actCount; a++) {
        await prisma.leadActivity.create({
          data: {
            leadId: lead.id,
            type: ACT_TYPES[randomBetween(0, ACT_TYPES.length - 1)],
            note: ['Initial inquiry call — very interested', 'Sent brochure and pricing sheet', 'Site tour completed, liked unit layout', 'Follow-up email sent', 'Discussed financing options'][randomBetween(0, 4)],
            createdBy: salesUserRecord?.id ?? adminUser.id,
          },
        });
      }
    }
    totalLeads += leadCount;
    console.log(`   🎯 ${proj.slug}: ${leadCount} leads`);
  }

  // ============================================================
  // TASKS
  // ============================================================
  console.log('\n✅ Seeding tasks...');
  await prisma.taskComment.deleteMany();
  await prisma.task.deleteMany();

  const TASK_TEMPLATES = [
    { title: 'Review and approve draw request #{{n}}', priority: 'HIGH', status: 'TODO' },
    { title: 'Follow up with lender on extension', priority: 'URGENT', status: 'IN_PROGRESS' },
    { title: 'Update construction schedule', priority: 'MEDIUM', status: 'TODO' },
    { title: 'Collect COIs from subcontractors', priority: 'HIGH', status: 'IN_PROGRESS' },
    { title: 'Prepare monthly owner\'s report', priority: 'MEDIUM', status: 'DONE' },
    { title: 'Schedule inspections for C.O.', priority: 'HIGH', status: 'TODO' },
    { title: 'Review lease abstracts', priority: 'MEDIUM', status: 'TODO' },
    { title: 'Coordinate punch list walkthrough', priority: 'HIGH', status: 'IN_PROGRESS' },
    { title: 'Update investor portal with Q2 data', priority: 'MEDIUM', status: 'TODO' },
    { title: 'Renew builder\'s risk insurance', priority: 'URGENT', status: 'TODO' },
  ];

  const pmUserRecord = await prisma.user.findFirst({ where: { role: 'PROJECT_MANAGER' } });
  const allProjectsForTasks = await prisma.project.findMany({ select: { id: true, slug: true } });
  let totalTasks = 0;

  for (const proj of allProjectsForTasks) {
    const taskCount = randomBetween(4, 6);
    for (let i = 0; i < taskCount; i++) {
      const tpl = TASK_TEMPLATES[i % TASK_TEMPLATES.length];
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + randomBetween(-7, 30));
      await prisma.task.create({
        data: {
          projectId: proj.id,
          title: tpl.title.replace('{{n}}', String(i + 1)),
          status: tpl.status as any,
          priority: tpl.priority as any,
          dueDate,
          assignedTo: pmUserRecord?.id ?? adminUser.id,
          createdBy: adminUser.id,
        },
      });
    }
    totalTasks += taskCount;
    console.log(`   ✅ ${proj.slug}: ${taskCount} tasks`);
  }

  // ---- Summary ----
  const bLines = await prisma.budgetLine.count();
  const acts = await prisma.actual.count();
  const comms = await prisma.commitment.count();
  const loans = await prisma.loan.count();
  const leases = await prisma.lease.count();
  const sales = await prisma.sale.count();
  const milestones = await prisma.milestone.count();
  const vendors = await prisma.vendor.count();
  const contracts = await prisma.contract.count();
  const leads = await prisma.lead.count();
  const tasks = await prisma.task.count();

  console.log('\n✅ All data seeded!');
  console.log(`   📊 Budget lines: ${bLines}`);
  console.log(`   💸 Actuals: ${acts}`);
  console.log(`   📝 Commitments: ${comms}`);
  console.log(`   🏦 Loans: ${loans}`);
  console.log(`   📋 Leases: ${leases}`);
  console.log(`   🤝 Sales: ${sales}`);
  console.log(`   🏁 Milestones: ${milestones}`);
  console.log(`   🏢 Vendors: ${vendors}`);
  console.log(`   📄 Contracts: ${contracts}`);
  console.log(`   🎯 Leads: ${leads}`);
  console.log(`   ✅ Tasks: ${tasks}`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
