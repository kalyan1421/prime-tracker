/**
 * End-to-end smoke test for the Interior + SalePayment slice, run against a REAL database
 * (local Postgres). Exercises the actual service code + Prisma + event bus — not mocks.
 *
 *   DATABASE_URL="postgresql://prime:prime_secret@localhost:5432/prime_tracker?schema=public" \
 *     npx ts-node prisma/smoke-slice1.ts
 *
 * Cleans up everything it creates and restores the building phase it borrows.
 */
import { PrismaClient } from '@prisma/client';
import { InteriorService } from '../src/modules/interior/interior.service';
import { SalePaymentsService } from '../src/modules/sales/sale-payments.service';
import { SalePaymentEventHandlers } from '../src/modules/sales/sale-payment-event-handlers.service';
import { ScheduledNotificationsService } from '../src/modules/notifications/scheduled-notifications.service';
import { CashFlowService } from '../src/modules/cashflow/cashflow.service';
import { SalesService } from '../src/modules/sales/sales.service';
import { DailyLogsService } from '../src/modules/daily-logs/daily-logs.service';
import { BrokersService } from '../src/modules/brokers/brokers.service';
import { UnitsService } from '../src/modules/units/units.service';
import { LeadsService } from '../src/modules/leads/leads.service';
import { EventBus } from '../src/common/events/event-bus.service';

const prisma = new PrismaClient();
let pass = 0;
function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(`❌ ${msg}`);
  pass++;
  console.log(`  ✅ ${msg}`);
}
async function expectThrow(fn: () => Promise<any>, msg: string) {
  try {
    await fn();
  } catch {
    pass++;
    console.log(`  ✅ ${msg}`);
    return;
  }
  throw new Error(`❌ expected throw but succeeded: ${msg}`);
}
const tick = () => new Promise((r) => setImmediate(r));

async function main() {
  const bus = new EventBus();
  const interior = new InteriorService(prisma as any, bus);
  const payments = new SalePaymentsService(prisma as any, bus);
  new SalePaymentEventHandlers(bus, payments).onModuleInit(); // wire milestone.completed → schedule
  const notifStub = { notifyPaymentOverdue: async () => {}, notifyPaymentDueSoon: async () => {} };
  const scheduled = new ScheduledNotificationsService(prisma as any, notifStub as any);
  const sales = new SalesService(prisma as any, bus);
  const dailyLogs = new DailyLogsService(prisma as any);
  const brokers = new BrokersService(prisma as any);
  const unitsSvc = new UnitsService(prisma as any);
  const leadsSvc = new LeadsService(prisma as any);

  const unit = await prisma.unit.findFirst({ include: { building: true } });
  if (!unit?.building) throw new Error('No seeded unit/building found — seed the DB first');
  const projectId = unit.building.projectId;
  const buildingId = unit.building.id;
  const originalPhase = unit.building.phase;
  const user = await prisma.user.findFirst();
  let vendor = await prisma.vendor.findFirst();
  if (!vendor) vendor = await prisma.vendor.create({ data: { name: 'Smoke Subcontractor' } });

  const created: { interiorId?: string; saleId?: string; discountSaleId?: string; milestoneId?: string; dailyLogId?: string; brokerId?: string; brokerSaleId?: string; combinedUnitId?: string; combineUnitIds: string[]; leadId?: string; docIds: string[]; actualIds: string[] } = { docIds: [], actualIds: [], combineUnitIds: [] };
  const originalUnitAsking = unit.askingPrice;
  const originalUnitStatus = unit.status;

  try {
    console.log('\n── Interior phase gates ──');
    // Shell NOT complete
    await prisma.building.update({ where: { id: buildingId }, data: { phase: 'CONSTRUCTION' } });
    const ip = await interior.create({ unitId: unit.id, name: 'Smoke fit-out', ratePerSqft: 50, area: 1000 });
    created.interiorId = ip.id;
    check(Number(ip.contractValue) === 50000, 'per-sqft contract value = rate × area (50 × 1000 = 50,000)');

    await interior.advancePhase(ip.id, 'CLIENT_APPROVAL', user!.id);
    await interior.advancePhase(ip.id, 'CITY_APPROVAL', user!.id);
    check(true, 'advanced DESIGN → CLIENT_APPROVAL → CITY_APPROVAL (paperwork phases, no gate)');

    await expectThrow(() => interior.advancePhase(ip.id, 'PROCUREMENT', user!.id),
      'PROCUREMENT blocked while shell is CONSTRUCTION (soft parallel gate)');

    // Shell complete now
    await prisma.building.update({ where: { id: buildingId }, data: { phase: 'STABILIZED' } });
    await interior.advancePhase(ip.id, 'PROCUREMENT', user!.id);
    check(true, 'PROCUREMENT allowed once shell is STABILIZED');

    await expectThrow(() => interior.advancePhase(ip.id, 'EXECUTION', user!.id),
      'EXECUTION blocked without a CITY_APPROVAL document (document gate)');

    const cityDoc = await prisma.document.create({
      data: { interiorProjectId: ip.id, category: 'CITY_APPROVAL', fileName: 'city.pdf', fileUrl: 'x', uploadedById: user!.id },
    });
    created.docIds.push(cityDoc.id);
    await interior.advancePhase(ip.id, 'EXECUTION', user!.id);
    await interior.advancePhase(ip.id, 'SNAGGING', user!.id);
    check(true, 'EXECUTION allowed with city-approval doc; advanced to SNAGGING');

    await expectThrow(() => interior.advancePhase(ip.id, 'HANDOVER', user!.id),
      'HANDOVER blocked without a HANDOVER_CERTIFICATE document');

    const certDoc = await prisma.document.create({
      data: { interiorProjectId: ip.id, category: 'HANDOVER_CERTIFICATE', fileName: 'cert.pdf', fileUrl: 'x', uploadedById: user!.id },
    });
    created.docIds.push(certDoc.id);
    const handed = await interior.advancePhase(ip.id, 'HANDOVER', user!.id);
    check(!!handed.handoverAt && handed.status === 'COMPLETED', 'HANDOVER allowed with cert; handoverAt stamped + COMPLETED');

    console.log('\n── Interior invoice → paired Actual ──');
    const inv = await interior.addInvoice(ip.id, { vendorId: vendor.id, amount: 2500, invoiceNo: 'SMK-1' });
    check(!!inv.actualId, 'invoice created with a paired actualId');
    const actual = await prisma.actual.findUnique({ where: { id: inv.actualId! } });
    created.actualIds.push(inv.actualId!);
    check(!!actual && Number(actual.amount) === 2500 && actual.projectId === projectId, 'Actual exists, tagged to the project, amount matches');

    console.log('\n── Sale payment schedule ──');
    const sale = await prisma.sale.create({ data: { projectId, unitId: unit.id, buyer: 'Smoke Buyer', salePrice: 1000000, status: 'UNDER_CONTRACT' } });
    created.saleId = sale.id;
    const sched = await payments.applyTemplate(sale.id, '10-40-50');
    check(sched.length === 3, 'template 10-40-50 created 3 installments');
    const deposit = sched[0];
    check(Number(deposit.amount) === 100000, 'deposit = 10% of 1,000,000 = 100,000');

    await payments.logPayment(deposit.id, 40000);
    let dep = await prisma.salePayment.findUnique({ where: { id: deposit.id } });
    check(dep!.status === 'PARTIALLY_PAID' && Number(dep!.paidAmount) === 40000, 'partial payment → PARTIALLY_PAID');
    await payments.logPayment(deposit.id, 60000);
    dep = await prisma.salePayment.findUnique({ where: { id: deposit.id } });
    check(dep!.status === 'PAID' && !!dep!.paidAt, 'completing payment → PAID with paidAt');

    console.log('\n── Milestone completion → installment DUE (via event bus) ──');
    const milestone = await prisma.milestone.create({
      data: { projectId, title: 'Smoke slab', phase: 'CONSTRUCTION', dueDate: new Date(), status: 'IN_PROGRESS' },
    });
    created.milestoneId = milestone.id;
    const msPay = await payments.addPayment(sale.id, { label: 'Slab draw', amount: 200000, trigger: 'ON_MILESTONE', milestoneId: milestone.id });
    check(msPay.status === 'SCHEDULED', 'milestone-linked installment starts SCHEDULED');
    bus.emit({ type: 'milestone.completed', milestoneId: milestone.id, projectId, completedAt: new Date() });
    // The handler runs async (setImmediate + awaited DB writes) — poll for the result.
    let msPayAfter = await prisma.salePayment.findUnique({ where: { id: msPay.id } });
    for (let i = 0; i < 40 && msPayAfter!.status !== 'DUE'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      msPayAfter = await prisma.salePayment.findUnique({ where: { id: msPay.id } });
    }
    check(msPayAfter!.status === 'DUE' && !!msPayAfter!.effectiveDueDate, 'milestone.completed event flipped installment → DUE + stamped effectiveDueDate');

    console.log('\n── Discount-approval gate ──');
    await prisma.unit.update({ where: { id: unit.id }, data: { askingPrice: 1000000, status: 'AVAILABLE' } });
    const discSale = await prisma.sale.create({
      data: { projectId, unitId: unit.id, buyer: 'Bargain Buyer', salePrice: 800000, status: 'UNDER_CONTRACT' },
    });
    created.discountSaleId = discSale.id;
    await expectThrow(() => sales.update(discSale.id, { status: 'CLOSED' } as any),
      'committing a 20% discount is blocked without Founder approval');
    await sales.approveDiscount(discSale.id, user!.id);
    const approved = await prisma.sale.findUnique({ where: { id: discSale.id } });
    check(!!approved!.discountApprovedAt && approved!.discountApprovedById === user!.id, 'approveDiscount stamps approver + timestamp');
    await sales.update(discSale.id, { status: 'CLOSED' } as any);
    const closedDisc = await prisma.sale.findUnique({ where: { id: discSale.id } });
    check(closedDisc!.status === 'CLOSED', 'approved discounted sale can now be committed (CLOSED)');

    console.log('\n── Daily construction logs ──');
    const log = await dailyLogs.create({ projectId, notes: 'Poured Building A footings; inspection passed.', authorId: user!.id, crewCount: 8, weather: 'Sunny 78F' });
    created.dailyLogId = log.id;
    check(log.notes.includes('footings') && log.crewCount === 8, 'daily log created with notes + crew + weather');
    const photo = await dailyLogs.addPhoto(log.id, { storagePath: 'daily-logs/smoke/footings.jpg', caption: 'Footings' });
    check(photo.storagePath === 'daily-logs/smoke/footings.jpg', 'photo attached by storagePath');
    const feed = await dailyLogs.findAll({ projectId });
    check(feed.some((l: any) => l.id === log.id && l.photos.length === 1), 'log appears in the project feed with its photo');

    console.log('\n── Broker commission + report ──');
    const broker = await brokers.create({ name: 'Smoke Broker', company: 'Referral Co', commissionRate: 2 });
    created.brokerId = broker.id;
    // building-level sale (no unit) avoids the discount gate; broker rate 2% of 500k = 10k
    const brSale = await prisma.sale.create({
      data: { projectId, unitId: unit.id, buyer: 'Broker Buyer', salePrice: 500000, status: 'UNDER_CONTRACT', brokerId: broker.id, discountApprovedAt: new Date() },
    });
    created.brokerSaleId = brSale.id;
    await sales.update(brSale.id, { status: 'CLOSED' } as any);
    const brSaleClosed = await prisma.sale.findUnique({ where: { id: brSale.id } });
    check(Number(brSaleClosed!.brokerCommissionAmt) === 10000, 'commission stamped on close = 2% × 500,000 = 10,000');
    const report = await brokers.report();
    const row = report.find((r: any) => r.brokerId === broker.id);
    check(!!row && row.closedSales >= 1 && row.commissionEarned >= 10000, 'broker report shows closed sale + commission earned');

    console.log('\n── Unit combine + lead funnel stages ──');
    const ua = await prisma.unit.create({ data: { buildingId, unitNumber: 'SMK-A', unitType: 'RETAIL', sqft: 600, status: 'AVAILABLE' } });
    const ub = await prisma.unit.create({ data: { buildingId, unitNumber: 'SMK-B', unitType: 'RETAIL', sqft: 400, status: 'AVAILABLE' } });
    created.combineUnitIds = [ua.id, ub.id];
    const combinedUnit = await unitsSvc.combine({ buildingId, sourceUnitIds: [ua.id, ub.id], unitNumber: 'SMK-A+B' });
    created.combinedUnitId = combinedUnit.id;
    check(Number(combinedUnit.sqft) === 1000, 'combined unit sums source area (600 + 400 = 1000)');
    const srcA = await prisma.unit.findUnique({ where: { id: ua.id } });
    check(srcA!.deletedAt != null && srcA!.mergedIntoId === combinedUnit.id, 'source unit archived + points at the combined unit');
    // Lead funnel: the new SITE_VISIT stage is accepted by the DB enum.
    const lead = await prisma.lead.create({ data: { projectId, source: 'BROKER', name: 'Funnel Lead', status: 'SITE_VISIT', createdBy: user!.id } });
    created.leadId = lead.id;
    check(lead.status === 'SITE_VISIT', 'lead accepts the new SITE_VISIT funnel stage');
    // Multi-unit interest / per-unit waitlist
    await leadsSvc.addInterest(lead.id, unit.id, 'Wants this unit');
    const waitlist = await leadsSvc.unitWaitlist(unit.id);
    check(waitlist.some((w: any) => w.lead.id === lead.id && w.position >= 1), 'lead appears on the unit waitlist (multi-unit interest)');

    console.log('\n── Cashflow inflows + receivables + overdue cron ──');
    const cashflow = new CashFlowService(prisma as any);
    const forecast = await cashflow.getForecast(projectId);
    check(forecast.summary.totalInflows > 0, 'cashflow forecast now includes sale-payment inflows');
    const recv = await payments.receivables(520); // wide horizon to capture all
    check(Array.isArray(recv) && recv.length > 0, `receivables view returns ${recv.length} outstanding installment(s)`);
    const cron = await scheduled.checkSalePayments();
    check(typeof cron.overdue === 'number', `overdue cron ran (overdue=${cron.overdue}, dueSoon=${cron.dueSoon})`);

    console.log(`\n🎉 SMOKE TEST PASSED — ${pass} checks green\n`);
  } finally {
    // Cleanup (local dev DB) — order matters for FKs; cascades handle children.
    if (created.saleId) await prisma.sale.delete({ where: { id: created.saleId } }).catch(() => {});
    if (created.discountSaleId) await prisma.sale.delete({ where: { id: created.discountSaleId } }).catch(() => {});
    if (created.brokerSaleId) await prisma.sale.delete({ where: { id: created.brokerSaleId } }).catch(() => {});
    if (created.brokerId) await prisma.broker.delete({ where: { id: created.brokerId } }).catch(() => {});
    await prisma.unit.update({ where: { id: unit.id }, data: { askingPrice: originalUnitAsking, status: originalUnitStatus } }).catch(() => {});
    if (created.interiorId) await prisma.interiorProject.delete({ where: { id: created.interiorId } }).catch(() => {});
    for (const id of created.actualIds) await prisma.actual.delete({ where: { id } }).catch(() => {});
    for (const id of created.docIds) await prisma.document.delete({ where: { id } }).catch(() => {});
    if (created.leadId) await prisma.lead.delete({ where: { id: created.leadId } }).catch(() => {});
    if (created.combinedUnitId) await prisma.unit.delete({ where: { id: created.combinedUnitId } }).catch(() => {});
    for (const id of created.combineUnitIds) await prisma.unit.delete({ where: { id } }).catch(() => {});
    if (created.dailyLogId) await prisma.dailyLog.delete({ where: { id: created.dailyLogId } }).catch(() => {});
    if (created.milestoneId) await prisma.milestone.delete({ where: { id: created.milestoneId } }).catch(() => {});
    await prisma.building.update({ where: { id: buildingId }, data: { phase: originalPhase } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error(e.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
