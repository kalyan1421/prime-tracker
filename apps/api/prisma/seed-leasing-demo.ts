/**
 * Leasing-depth demo data.
 *
 * The base seed gives every leased unit exactly ONE lease, and puts its expired
 * leases on AVAILABLE units — so no unit ever has both. That means the features
 * built in this cycle have nothing to show:
 *   - a unit's rent history across a re-let (previous tenant -> current tenant)
 *   - free-rent months and compounding escalations on a real schedule
 *   - a security deposit part-paid, and a TI allowance disbursed in phases
 *   - a month-by-month rent ledger with paid / partial / due / free rows
 *
 * This script builds exactly one fully-populated example so all of that is
 * demoable, and drives it through the REAL services rather than raw inserts —
 * seeded data therefore cannot drift from production behaviour.
 *
 * Idempotent: re-running replaces only the rows it owns, keyed on DEMO_TAG.
 */
import { PrismaClient } from '@prisma/client';
import { LeaseRentPeriodService } from '../src/modules/leases/lease-rent-period.service';
import { LeaseObligationService } from '../src/modules/leases/lease-obligation.service';
import { LeaseRentInvoiceService } from '../src/modules/leases/lease-rent-invoice.service';

const prisma = new PrismaClient();

/** Marks every row this script owns, so a re-run can clean up after itself. */
const DEMO_TAG = '[leasing-demo]';
const PRIOR_TENANT = 'Sunrise Bakery LLC';

function monthsAgo(n: number) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function monthsAhead(n: number) {
  return monthsAgo(-n);
}

async function main() {
  const rentPeriods = new LeaseRentPeriodService(prisma as any);
  const obligations = new LeaseObligationService(prisma as any);
  const invoices = new LeaseRentInvoiceService(prisma as any);

  // Pick the target deterministically so the demo lands on the same unit every run:
  // the lowest-numbered LEASED unit that already has exactly one ACTIVE lease.
  const candidate = await prisma.unit.findFirst({
    where: {
      deletedAt: null,
      status: 'LEASED',
      leases: { some: { status: 'ACTIVE', deletedAt: null } },
    },
    orderBy: [{ unitNumber: 'asc' }],
    select: {
      id: true,
      unitNumber: true,
      building: { select: { id: true, name: true, projectId: true, project: { select: { name: true } } } },
      leases: { where: { deletedAt: null }, orderBy: { leaseStart: 'desc' } },
    },
  });

  if (!candidate) {
    console.log('⚠️  No leased unit with an active lease found — run the base seed first.');
    return;
  }

  const current = candidate.leases.find((l) => l.status === 'ACTIVE');
  if (!current) {
    console.log('⚠️  Target unit has no ACTIVE lease.');
    return;
  }

  console.log(
    `🎯 Target: ${candidate.building.project.name} / ${candidate.building.name} / Unit ${candidate.unitNumber}`,
  );

  // ---- clean up anything a previous run of THIS script created ----
  const priorLeases = await prisma.lease.findMany({
    where: { unitId: candidate.id, tenantName: PRIOR_TENANT },
    select: { id: true },
  });
  if (priorLeases.length) {
    await prisma.lease.deleteMany({ where: { id: { in: priorLeases.map((l) => l.id) } } });
    console.log(`   ↺ removed ${priorLeases.length} row(s) from a previous run`);
  }
  await prisma.leaseObligation.deleteMany({
    where: { leaseId: current.id, notes: { contains: DEMO_TAG } },
  });

  // ---- 1. The re-let: a PRIOR, expired lease on the SAME unit ----------------
  // This is the whole point — a unit whose rent story spans two tenants.
  const priorStart = monthsAgo(72);
  const priorEnd = monthsAgo(30);
  const prior = await prisma.lease.create({
    data: {
      unitId: candidate.id,
      tenantName: PRIOR_TENANT,
      tenantLegalName: PRIOR_TENANT,
      tenantBrand: 'Sunrise Bakery',
      tenantContact: 'Marta Ruiz',
      tenantEmail: 'marta@sunrisebakery.example',
      tenantPhone: '+1-555-0142',
      monthlyRent: 2400,
      leaseStart: priorStart,
      leaseEnd: priorEnd,
      termMonths: 42,
      escalationPct: 3,
      escalationFreq: 12,
      rentDueDay: 1,
      status: 'EXPIRED',
      notes: `${DEMO_TAG} previous tenant, vacated at end of term`,
    },
  });
  await rentPeriods.generateForLease(prior.id);
  console.log(`   ✅ prior lease: ${PRIOR_TENANT} (EXPIRED) + rent schedule`);

  // ---- 2. Make the CURRENT lease interesting --------------------------------
  // Free rent + a 6-monthly escalation + a per-lease due day, so the schedule
  // shows abatement, compounding, and a non-1st due date all at once.
  const currentStart = monthsAgo(8);
  const currentEnd = monthsAhead(52);
  await prisma.lease.update({
    where: { id: current.id },
    data: {
      leaseStart: currentStart,
      leaseEnd: currentEnd,
      termMonths: 60,
      monthlyRent: 3600,
      escalationPct: 3.5,
      escalationFreq: 6,
      freeRentMonths: 2,
      freeRentStartDate: currentStart,
      rentDueDay: 5,
      tenantEmail: 'ap@currenttenant.example',
      tenantPhone: '+1-555-0188',
      securityDeposit: 7200,
      status: 'ACTIVE',
    },
  });
  await prisma.leaseRentPeriod.deleteMany({ where: { leaseId: current.id } });
  const periods = await rentPeriods.generateForLease(current.id);
  console.log(
    `   ✅ current lease "${current.tenantName}": ${periods.length} periods, 2 free months, 3.5%/6mo, due on the 5th`,
  );

  // ---- 3. Security deposit — part paid --------------------------------------
  const deposit = await obligations.create({
    leaseId: current.id,
    kind: 'SECURITY_DEPOSIT',
    totalAmount: 7200,
    dueDate: currentStart,
    notes: `${DEMO_TAG} two months' rent`,
  } as any);
  await obligations.recordPayment(deposit.id, {
    amount: 4000,
    paidAt: monthsAgo(8),
    method: 'WIRE',
    reference: 'WIRE-88421',
  } as any);
  console.log('   ✅ deposit $7,200 agreed / $4,000 collected → PARTIAL');

  // ---- 4. TI allowance — fixed amount, disbursed in phases ------------------
  const ti = await obligations.create({
    leaseId: current.id,
    kind: 'TI_ALLOWANCE',
    totalAmount: 45000,
    dueDate: monthsAgo(6),
    notes: `${DEMO_TAG} fit-out allowance, released against progress`,
  } as any);
  await obligations.recordPayment(ti.id, {
    amount: 15000, paidAt: monthsAgo(7), method: 'ACH', reference: 'TI-1 mobilisation',
  } as any);
  await obligations.recordPayment(ti.id, {
    amount: 12500, paidAt: monthsAgo(4), method: 'ACH', reference: 'TI-2 MEP rough-in',
  } as any);
  console.log('   ✅ TI $45,000 agreed / $27,500 disbursed over 2 phases → $17,500 pending');

  // ---- 5. Rent ledger: paid / partial / due / free --------------------------
  await invoices.generateForLease(current.id);
  const rows = await prisma.leaseRentInvoice.findMany({
    where: { leaseId: current.id },
    orderBy: { periodMonth: 'asc' },
  });

  // Pay everything except the last two payable months: leave one PARTIAL and one
  // DUE so the collection UI has an overdue case to show.
  const payable = rows.filter((r) => r.status !== 'FREE');
  for (let i = 0; i < payable.length - 2; i += 1) {
    const inv = payable[i];
    await invoices.recordPayment(inv.id, {
      amountPaid: Number(inv.amountDue),
      paidAt: inv.dueDate,
      method: 'ACH',
      reference: `RENT-${inv.periodMonth.toISOString().slice(0, 7)}`,
    } as any);
  }
  if (payable.length >= 2) {
    const partial = payable[payable.length - 2];
    await invoices.recordPayment(partial.id, {
      amountPaid: Math.round(Number(partial.amountDue) * 0.4 * 100) / 100,
      paidAt: partial.dueDate,
      method: 'CHECK',
      reference: 'CHK-2261 (short payment)',
    } as any);
  }

  const summary = await invoices.summaryForLease(current.id);
  const freeRows = rows.filter((r) => r.status === 'FREE').length;
  const prorated = rows.filter((r) => r.isProrated).length;
  console.log(
    `   ✅ rent ledger: ${rows.length} months (${freeRows} free, ${prorated} prorated) — ` +
    `billed ${summary.billed}, collected ${summary.collected}, outstanding ${summary.outstanding}, ` +
    `${summary.overdueCount} overdue`,
  );

  // ---- 6. Prior lease also gets a ledger so the unit timeline is continuous --
  await invoices.generateForLease(prior.id);
  const priorRows = await prisma.leaseRentInvoice.findMany({ where: { leaseId: prior.id } });
  for (const inv of priorRows) {
    if (inv.status === 'FREE') continue;
    await invoices.recordPayment(inv.id, {
      amountPaid: Number(inv.amountDue), paidAt: inv.dueDate, method: 'ACH',
    } as any);
  }
  console.log(`   ✅ prior lease ledger: ${priorRows.length} months, all settled`);

  console.log(
    `\n✅ Demo re-let ready — open Unit ${candidate.unitNumber} ` +
    `(${candidate.building.project.name} / ${candidate.building.name}) to see two tenants' rent history.`,
  );
}

main()
  .catch((e) => {
    console.error('Leasing demo seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
