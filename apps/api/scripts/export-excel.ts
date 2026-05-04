/**
 * Export all database data to an Excel workbook.
 * Each sheet = one table, columns = database fields, existing rows pre-filled.
 * Run:  npx tsx scripts/export-excel.ts
 */
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import path from 'path';

const prisma = new PrismaClient();

// ---------- helpers ----------
const toStr = (v: any) => (v == null ? '' : String(v));
const toDate = (v: any) => (v instanceof Date ? v : v ? new Date(v) : null);

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, size: 11 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A56DB' } };
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.alignment = { vertical: 'middle' };
  row.height = 24;
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };
}

function addEnumValidation(sheet: ExcelJS.Worksheet, col: string, values: string[], rowCount: number) {
  for (let r = 2; r <= rowCount + 50; r++) {
    sheet.getCell(`${col}${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${values.join(',')}"`],
    };
  }
}

// ---------- main ----------
async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Prime Tracker';
  wb.created = new Date();

  // ===== 1. Projects =====
  const projects = await prisma.project.findMany({ orderBy: { name: 'asc' } });
  const projSheet = wb.addWorksheet('Projects');
  projSheet.columns = [
    { header: 'id', key: 'id', width: 28 },
    { header: 'name', key: 'name', width: 30 },
    { header: 'slug', key: 'slug', width: 24 },
    { header: 'location', key: 'location', width: 22 },
    { header: 'address', key: 'address', width: 30 },
    { header: 'acreage', key: 'acreage', width: 12 },
    { header: 'status', key: 'status', width: 14 },
    { header: 'phase', key: 'phase', width: 20 },
    { header: 'projectType', key: 'projectType', width: 16 },
    { header: 'description', key: 'description', width: 40 },
    { header: 'startDate', key: 'startDate', width: 16 },
    { header: 'targetEnd', key: 'targetEnd', width: 16 },
  ];
  for (const p of projects) {
    projSheet.addRow({
      id: p.id,
      name: p.name,
      slug: p.slug,
      location: p.location,
      address: p.address || '',
      acreage: p.acreage ? Number(p.acreage) : '',
      status: p.status,
      phase: p.phase,
      projectType: p.projectType || '',
      description: p.description || '',
      startDate: toDate(p.startDate),
      targetEnd: toDate(p.targetEnd),
    });
  }
  styleHeader(projSheet);
  addEnumValidation(projSheet, 'G', ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'], projects.length);
  addEnumValidation(projSheet, 'H', ['PRE_DEVELOPMENT', 'PERMITTING', 'CONSTRUCTION', 'LEASE_UP', 'STABILIZED', 'SOLD_REFI'], projects.length);
  addEnumValidation(projSheet, 'I', ['RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'INDUSTRIAL'], projects.length);

  // Helper: project slug lookup note
  const projNote = wb.addWorksheet('_Lookup_Projects');
  projNote.columns = [
    { header: 'projectId', key: 'id', width: 28 },
    { header: 'name', key: 'name', width: 30 },
    { header: 'slug', key: 'slug', width: 24 },
  ];
  for (const p of projects) {
    projNote.addRow({ id: p.id, name: p.name, slug: p.slug });
  }
  styleHeader(projNote);

  // ===== 2. Buildings =====
  const buildings = await prisma.building.findMany({ include: { project: { select: { name: true, slug: true } } }, orderBy: { name: 'asc' } });
  const bldgSheet = wb.addWorksheet('Buildings');
  bldgSheet.columns = [
    { header: 'id', key: 'id', width: 28 },
    { header: 'projectId', key: 'projectId', width: 28 },
    { header: 'projectName', key: 'projectName', width: 24 },
    { header: 'name', key: 'name', width: 24 },
    { header: 'totalSqft', key: 'totalSqft', width: 14 },
    { header: 'stories', key: 'stories', width: 10 },
    { header: 'buildingType', key: 'buildingType', width: 16 },
  ];
  for (const b of buildings) {
    bldgSheet.addRow({
      id: b.id,
      projectId: b.projectId,
      projectName: b.project.name,
      name: b.name,
      totalSqft: b.totalSqft ?? '',
      stories: b.stories ?? '',
      buildingType: b.buildingType || '',
    });
  }
  styleHeader(bldgSheet);

  // ===== 3. Units =====
  const units = await prisma.unit.findMany({
    include: {
      building: { select: { name: true, project: { select: { name: true } } } },
      leases: { where: { status: 'ACTIVE' }, take: 1, select: { tenantName: true } },
    },
    orderBy: { unitNumber: 'asc' },
  });
  const unitSheet = wb.addWorksheet('Units');
  unitSheet.columns = [
    { header: 'id', key: 'id', width: 28 },
    { header: 'buildingId', key: 'buildingId', width: 28 },
    { header: 'buildingName', key: 'buildingName', width: 20 },
    { header: 'projectName', key: 'projectName', width: 20 },
    { header: 'unitNumber', key: 'unitNumber', width: 14 },
    { header: 'unitType', key: 'unitType', width: 18 },
    { header: 'sqft', key: 'sqft', width: 10 },
    { header: 'status', key: 'status', width: 20 },
    { header: 'askingRent', key: 'askingRent', width: 14 },
    { header: 'askingPrice', key: 'askingPrice', width: 16 },
    { header: 'currentTenant', key: 'currentTenant', width: 22 },
    { header: 'notes', key: 'notes', width: 30 },
  ];
  for (const u of units) {
    unitSheet.addRow({
      id: u.id,
      buildingId: u.buildingId,
      buildingName: u.building.name,
      projectName: u.building.project.name,
      unitNumber: u.unitNumber,
      unitType: u.unitType,
      sqft: u.sqft ?? '',
      status: u.status,
      askingRent: u.askingRent ? Number(u.askingRent) : '',
      askingPrice: u.askingPrice ? Number(u.askingPrice) : '',
      currentTenant: u.leases[0]?.tenantName || '',
      notes: u.notes || '',
    });
  }
  styleHeader(unitSheet);
  addEnumValidation(unitSheet, 'F', ['RETAIL', 'MEDICAL', 'FLEX', 'RESIDENTIAL_LOT', 'OFFICE', 'RESTAURANT', 'EVENT_CENTER'], units.length);
  addEnumValidation(unitSheet, 'H', ['AVAILABLE', 'UNDER_CONTRACT', 'LEASED', 'SOLD', 'OCCUPIED', 'UNDER_CONSTRUCTION'], units.length);

  // ===== 4. Budget Lines =====
  const budgetLines = await prisma.budgetLine.findMany({ include: { project: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
  const budgetSheet = wb.addWorksheet('BudgetLines');
  budgetSheet.columns = [
    { header: 'id', key: 'id', width: 28 },
    { header: 'projectId', key: 'projectId', width: 28 },
    { header: 'projectName', key: 'projectName', width: 24 },
    { header: 'category', key: 'category', width: 20 },
    { header: 'description', key: 'description', width: 30 },
    { header: 'baselineAmt', key: 'baselineAmt', width: 16 },
    { header: 'revisedAmt', key: 'revisedAmt', width: 16 },
    { header: 'notes', key: 'notes', width: 30 },
  ];
  for (const b of budgetLines) {
    budgetSheet.addRow({
      id: b.id,
      projectId: b.projectId,
      projectName: b.project.name,
      category: b.category,
      description: b.description,
      baselineAmt: Number(b.baselineAmt),
      revisedAmt: b.revisedAmt ? Number(b.revisedAmt) : '',
      notes: b.notes || '',
    });
  }
  styleHeader(budgetSheet);
  addEnumValidation(budgetSheet, 'D', ['LAND_ACQUISITION', 'SITE_WORK', 'HARD_COSTS', 'SOFT_COSTS', 'FINANCING', 'PERMITS_FEES', 'CONTINGENCY', 'MARKETING', 'LEGAL', 'OTHER'], budgetLines.length);

  // ===== 5. Commitments =====
  const commitments = await prisma.commitment.findMany({ include: { project: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
  const commitSheet = wb.addWorksheet('Commitments');
  commitSheet.columns = [
    { header: 'id', key: 'id', width: 28 },
    { header: 'projectId', key: 'projectId', width: 28 },
    { header: 'projectName', key: 'projectName', width: 24 },
    { header: 'vendor', key: 'vendor', width: 24 },
    { header: 'description', key: 'description', width: 30 },
    { header: 'category', key: 'category', width: 20 },
    { header: 'contractAmt', key: 'contractAmt', width: 16 },
    { header: 'paidToDate', key: 'paidToDate', width: 14 },
    { header: 'retainage', key: 'retainage', width: 14 },
    { header: 'contractDate', key: 'contractDate', width: 16 },
    { header: 'notes', key: 'notes', width: 30 },
  ];
  for (const c of commitments) {
    commitSheet.addRow({
      id: c.id,
      projectId: c.projectId,
      projectName: c.project.name,
      vendor: c.vendor,
      description: c.description,
      category: c.category,
      contractAmt: Number(c.contractAmt),
      paidToDate: Number(c.paidToDate),
      retainage: Number(c.retainage),
      contractDate: toDate(c.contractDate),
      notes: c.notes || '',
    });
  }
  styleHeader(commitSheet);
  addEnumValidation(commitSheet, 'F', ['LAND_ACQUISITION', 'SITE_WORK', 'HARD_COSTS', 'SOFT_COSTS', 'FINANCING', 'PERMITS_FEES', 'CONTINGENCY', 'MARKETING', 'LEGAL', 'OTHER'], commitments.length);

  // ===== 6. Actuals =====
  const actuals = await prisma.actual.findMany({ include: { project: { select: { name: true } } }, orderBy: { txnDate: 'desc' } });
  const actualSheet = wb.addWorksheet('Actuals');
  actualSheet.columns = [
    { header: 'id', key: 'id', width: 28 },
    { header: 'projectId', key: 'projectId', width: 28 },
    { header: 'projectName', key: 'projectName', width: 24 },
    { header: 'category', key: 'category', width: 20 },
    { header: 'description', key: 'description', width: 30 },
    { header: 'amount', key: 'amount', width: 16 },
    { header: 'txnDate', key: 'txnDate', width: 16 },
    { header: 'vendor', key: 'vendor', width: 24 },
  ];
  for (const a of actuals) {
    actualSheet.addRow({
      id: a.id,
      projectId: a.projectId,
      projectName: a.project.name,
      category: a.category,
      description: a.description,
      amount: Number(a.amount),
      txnDate: toDate(a.txnDate),
      vendor: a.vendor || '',
    });
  }
  styleHeader(actualSheet);
  addEnumValidation(actualSheet, 'D', ['LAND_ACQUISITION', 'SITE_WORK', 'HARD_COSTS', 'SOFT_COSTS', 'FINANCING', 'PERMITS_FEES', 'CONTINGENCY', 'MARKETING', 'LEGAL', 'OTHER'], actuals.length);

  // ===== 7. Milestones =====
  const milestones = await prisma.milestone.findMany({
    include: { project: { select: { name: true } }, owner: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
  });
  const msSheet = wb.addWorksheet('Milestones');
  msSheet.columns = [
    { header: 'id', key: 'id', width: 28 },
    { header: 'projectId', key: 'projectId', width: 28 },
    { header: 'projectName', key: 'projectName', width: 24 },
    { header: 'title', key: 'title', width: 30 },
    { header: 'description', key: 'description', width: 36 },
    { header: 'phase', key: 'phase', width: 20 },
    { header: 'status', key: 'status', width: 16 },
    { header: 'dueDate', key: 'dueDate', width: 16 },
    { header: 'completedAt', key: 'completedAt', width: 16 },
    { header: 'ownerName', key: 'ownerName', width: 20 },
    { header: 'sortOrder', key: 'sortOrder', width: 10 },
  ];
  for (const m of milestones) {
    msSheet.addRow({
      id: m.id,
      projectId: m.projectId,
      projectName: m.project.name,
      title: m.title,
      description: m.description || '',
      phase: m.phase,
      status: m.status,
      dueDate: toDate(m.dueDate),
      completedAt: toDate(m.completedAt),
      ownerName: m.owner?.name || '',
      sortOrder: m.sortOrder,
    });
  }
  styleHeader(msSheet);
  addEnumValidation(msSheet, 'F', ['PRE_DEVELOPMENT', 'PERMITTING', 'CONSTRUCTION', 'LEASE_UP', 'STABILIZED', 'SOLD_REFI'], milestones.length);
  addEnumValidation(msSheet, 'G', ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'BLOCKED'], milestones.length);

  // ===== 8. Leases =====
  const leases = await prisma.lease.findMany({
    include: { unit: { select: { unitNumber: true, building: { select: { name: true, project: { select: { name: true } } } } } } },
    orderBy: { leaseStart: 'desc' },
  });
  const leaseSheet = wb.addWorksheet('Leases');
  leaseSheet.columns = [
    { header: 'id', key: 'id', width: 28 },
    { header: 'unitId', key: 'unitId', width: 28 },
    { header: 'unitNumber', key: 'unitNumber', width: 14 },
    { header: 'buildingName', key: 'buildingName', width: 20 },
    { header: 'projectName', key: 'projectName', width: 20 },
    { header: 'tenantName', key: 'tenantName', width: 24 },
    { header: 'tenantContact', key: 'tenantContact', width: 24 },
    { header: 'monthlyRent', key: 'monthlyRent', width: 14 },
    { header: 'rentPerSqft', key: 'rentPerSqft', width: 14 },
    { header: 'leaseStart', key: 'leaseStart', width: 16 },
    { header: 'leaseEnd', key: 'leaseEnd', width: 16 },
    { header: 'termMonths', key: 'termMonths', width: 14 },
    { header: 'escalationPct', key: 'escalationPct', width: 16 },
    { header: 'escalationFreq', key: 'escalationFreq', width: 16 },
    { header: 'securityDeposit', key: 'securityDeposit', width: 16 },
    { header: 'status', key: 'status', width: 14 },
    { header: 'notes', key: 'notes', width: 30 },
  ];
  for (const l of leases) {
    leaseSheet.addRow({
      id: l.id,
      unitId: l.unitId,
      unitNumber: l.unit.unitNumber,
      buildingName: l.unit.building.name,
      projectName: l.unit.building.project.name,
      tenantName: l.tenantName,
      tenantContact: l.tenantContact || '',
      monthlyRent: Number(l.monthlyRent),
      rentPerSqft: l.rentPerSqft ? Number(l.rentPerSqft) : '',
      leaseStart: toDate(l.leaseStart),
      leaseEnd: toDate(l.leaseEnd),
      termMonths: l.termMonths,
      escalationPct: l.escalationPct ? Number(l.escalationPct) : '',
      escalationFreq: l.escalationFreq ?? '',
      securityDeposit: l.securityDeposit ? Number(l.securityDeposit) : '',
      status: l.status,
      notes: l.notes || '',
    });
  }
  styleHeader(leaseSheet);
  addEnumValidation(leaseSheet, 'P', ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'], leases.length);

  // ===== 9. Sales =====
  const sales = await prisma.sale.findMany({
    include: {
      project: { select: { name: true } },
      unit: { select: { unitNumber: true, building: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const saleSheet = wb.addWorksheet('Sales');
  saleSheet.columns = [
    { header: 'id', key: 'id', width: 28 },
    { header: 'projectId', key: 'projectId', width: 28 },
    { header: 'projectName', key: 'projectName', width: 24 },
    { header: 'unitId', key: 'unitId', width: 28 },
    { header: 'unitNumber', key: 'unitNumber', width: 14 },
    { header: 'buildingName', key: 'buildingName', width: 20 },
    { header: 'buyer', key: 'buyer', width: 24 },
    { header: 'salePrice', key: 'salePrice', width: 16 },
    { header: 'depositAmt', key: 'depositAmt', width: 14 },
    { header: 'status', key: 'status', width: 18 },
    { header: 'loiDate', key: 'loiDate', width: 16 },
    { header: 'contractDate', key: 'contractDate', width: 16 },
    { header: 'closingDate', key: 'closingDate', width: 16 },
    { header: 'notes', key: 'notes', width: 30 },
  ];
  for (const s of sales) {
    saleSheet.addRow({
      id: s.id,
      projectId: s.projectId,
      projectName: s.project.name,
      unitId: s.unitId,
      unitNumber: s.unit.unitNumber,
      buildingName: s.unit.building.name,
      buyer: s.buyer || '',
      salePrice: s.salePrice ? Number(s.salePrice) : '',
      depositAmt: s.depositAmt ? Number(s.depositAmt) : '',
      status: s.status,
      loiDate: toDate(s.loiDate),
      contractDate: toDate(s.contractDate),
      closingDate: toDate(s.closingDate),
      notes: s.notes || '',
    });
  }
  styleHeader(saleSheet);
  addEnumValidation(saleSheet, 'J', ['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT', 'CLOSED', 'CANCELLED'], sales.length);

  // ===== 10. Loans =====
  const loans = await prisma.loan.findMany({ include: { project: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
  const loanSheet = wb.addWorksheet('Loans');
  loanSheet.columns = [
    { header: 'id', key: 'id', width: 28 },
    { header: 'projectId', key: 'projectId', width: 28 },
    { header: 'projectName', key: 'projectName', width: 24 },
    { header: 'loanType', key: 'loanType', width: 16 },
    { header: 'lender', key: 'lender', width: 24 },
    { header: 'principalAmt', key: 'principalAmt', width: 16 },
    { header: 'interestRate', key: 'interestRate', width: 14 },
    { header: 'termMonths', key: 'termMonths', width: 14 },
    { header: 'maturityDate', key: 'maturityDate', width: 16 },
    { header: 'currentBalance', key: 'currentBalance', width: 16 },
    { header: 'monthlyPayment', key: 'monthlyPayment', width: 16 },
    { header: 'notes', key: 'notes', width: 30 },
  ];
  for (const l of loans) {
    loanSheet.addRow({
      id: l.id,
      projectId: l.projectId,
      projectName: l.project.name,
      loanType: l.loanType,
      lender: l.lender,
      principalAmt: Number(l.principalAmt),
      interestRate: Number(l.interestRate),
      termMonths: l.termMonths,
      maturityDate: toDate(l.maturityDate),
      currentBalance: l.currentBalance ? Number(l.currentBalance) : '',
      monthlyPayment: l.monthlyPayment ? Number(l.monthlyPayment) : '',
      notes: l.notes || '',
    });
  }
  styleHeader(loanSheet);
  addEnumValidation(loanSheet, 'D', ['CONSTRUCTION', 'PERMANENT', 'BRIDGE', 'MEZZANINE', 'SBA'], loans.length);

  // ===== 11. Instructions sheet =====
  const instrSheet = wb.addWorksheet('README', { properties: { tabColor: { argb: 'FFFF6600' } } });
  instrSheet.columns = [{ header: '', key: 'text', width: 100 }];
  const instructions = [
    'PRIME TRACKER — DATA IMPORT/EXPORT TEMPLATE',
    '',
    'INSTRUCTIONS:',
    '1. Each sheet corresponds to a database table.',
    '2. The "id" column is the primary key. Leave blank for NEW rows — the system will generate IDs.',
    '3. Rows with an existing "id" will UPDATE that record.',
    '4. Columns like "projectName", "buildingName", "unitNumber" are READ-ONLY helpers. They are ignored on import.',
    '5. Foreign keys (projectId, buildingId, unitId) must match an existing ID. See _Lookup_Projects sheet.',
    '6. Enum columns have dropdown validation — only use the allowed values.',
    '7. Date columns: use YYYY-MM-DD format or Excel date values.',
    '8. Currency columns: enter plain numbers (no $ or commas). E.g. 150000 not $150,000.',
    '',
    'SHEETS:',
    '  Projects      — Core project records',
    '  Buildings      — Buildings within each project (requires projectId)',
    '  Units          — Units within buildings (requires buildingId)',
    '  BudgetLines    — Budget line items (requires projectId)',
    '  Commitments    — Vendor contracts (requires projectId)',
    '  Actuals        — Actual expenditures (requires projectId)',
    '  Milestones     — Project milestones (requires projectId)',
    '  Leases         — Unit leases (requires unitId)',
    '  Sales          — Unit sales (requires projectId + unitId)',
    '  Loans          — Project loans (requires projectId)',
    '',
    'ENUM VALUES:',
    '  ProjectStatus:    ACTIVE, ON_HOLD, COMPLETED, CANCELLED',
    '  ProjectPhase:     PRE_DEVELOPMENT, PERMITTING, CONSTRUCTION, LEASE_UP, STABILIZED, SOLD_REFI',
    '  ProjectType:      RESIDENTIAL, COMMERCIAL, MIXED_USE, INDUSTRIAL',
    '  UnitType:         RETAIL, MEDICAL, FLEX, RESIDENTIAL_LOT, OFFICE, RESTAURANT, EVENT_CENTER',
    '  UnitStatus:       AVAILABLE, UNDER_CONTRACT, LEASED, SOLD, OCCUPIED, UNDER_CONSTRUCTION',
    '  BudgetCategory:   LAND_ACQUISITION, SITE_WORK, HARD_COSTS, SOFT_COSTS, FINANCING, PERMITS_FEES, CONTINGENCY, MARKETING, LEGAL, OTHER',
    '  MilestoneStatus:  NOT_STARTED, IN_PROGRESS, COMPLETED, OVERDUE, BLOCKED',
    '  LeaseStatus:      DRAFT, ACTIVE, EXPIRED, TERMINATED',
    '  SaleStatus:       PROSPECT, LOI_SIGNED, UNDER_CONTRACT, CLOSED, CANCELLED',
    '  LoanType:         CONSTRUCTION, PERMANENT, BRIDGE, MEZZANINE, SBA',
    '',
    '_Lookup_Projects — Reference sheet with projectId → name/slug mapping',
    '',
    `Generated: ${new Date().toISOString()}`,
  ];
  for (const line of instructions) {
    instrSheet.addRow({ text: line });
  }
  instrSheet.getRow(1).font = { bold: true, size: 14 };

  // Move README to first position
  wb.removeWorksheet(instrSheet.id);
  // Re-add at beginning by re-creating
  // ExcelJS doesn't support reordering, so we'll write as-is. README is the last sheet.

  // ===== Write file =====
  const outPath = path.resolve(__dirname, '..', '..', '..', 'PrimeTracker_Data.xlsx');
  await wb.xlsx.writeFile(outPath);

  // Print summary
  console.log(`\nExcel exported to: ${outPath}`);
  console.log(`Sheets:`);
  console.log(`  Projects:     ${projects.length} rows`);
  console.log(`  Buildings:    ${buildings.length} rows`);
  console.log(`  Units:        ${units.length} rows`);
  console.log(`  BudgetLines:  ${budgetLines.length} rows`);
  console.log(`  Commitments:  ${commitments.length} rows`);
  console.log(`  Actuals:      ${actuals.length} rows`);
  console.log(`  Milestones:   ${milestones.length} rows`);
  console.log(`  Leases:       ${leases.length} rows`);
  console.log(`  Sales:        ${sales.length} rows`);
  console.log(`  Loans:        ${loans.length} rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
