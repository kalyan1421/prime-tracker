/**
 * Assertion pass over the B-DELTA unit-history fixtures.
 *
 * Runs the REAL UnitHistoryService against every fixture unit and checks the claim each
 * one exists to make. Deliberately not a jest spec: the repo's specs mock Prisma, and
 * the whole point here is to exercise the service against a live database with real
 * rows, real constraints and the real generated schedules.
 *
 *   npx tsx prisma/seed-qa-building.ts
 *   npx tsx prisma/seed-qa-unit-history.ts
 *   npx tsx prisma/qa-unit-history-check.ts
 */
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UnitHistoryService } from '../src/modules/units/unit-history.service';
import { LeaseRentPeriodService } from '../src/modules/leases/lease-rent-period.service';
import { LeaseRentInvoiceService } from '../src/modules/leases/lease-rent-invoice.service';

const prisma = new PrismaClient();
const BUILDING_NAME = 'B-DELTA — Unit History';
/** Fixed "now", so assertions about open windows do not drift with the clock. */
const NOW = new Date('2026-08-12T00:00:00.000Z');

type Result = { unit: string; claim: string; ok: boolean; detail: string };
const results: Result[] = [];

function check(unit: string, claim: string, ok: boolean, detail = '') {
  results.push({ unit, claim, ok, detail });
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const history = app.get(UnitHistoryService);
  const periods = app.get(LeaseRentPeriodService);
  const invoices = app.get(LeaseRentInvoiceService);

  const building = await prisma.building.findFirst({ where: { name: BUILDING_NAME } });
  if (!building) throw new Error('Run seed-qa-unit-history.ts first');

  const units = await prisma.unit.findMany({
    where: { buildingId: building.id },
    orderBy: { unitNumber: 'asc' },
    select: { id: true, unitNumber: true, sqft: true },
  });
  const byNumber = new Map(units.map((u) => [u.unitNumber, u]));

  // Generate schedules + ledgers so the rent-derived assertions run against real rows.
  const leases = await prisma.lease.findMany({
    where: { unit: { buildingId: building.id }, deletedAt: null },
    select: { id: true },
  });
  for (const l of leases) {
    try { await periods.generateForLease(l.id, { force: true }); } catch { /* asserted below */ }
    try { await invoices.generateForLease(l.id, { through: NOW }); } catch { /* asserted below */ }
  }

  const h = async (n: string) => history.getHistory(byNumber.get(n)!.id, NOW);
  const kinds = (r: any, k: string) => r.entries.filter((e: any) => e.kind === k);

  // ── H-01 bootstrap only ────────────────────────────────────────────────────
  {
    const r = await h('H-01');
    check('H-01', 'flags that tracked history starts at the bootstrap row',
      r.summary.historyStartsAtBootstrap === true, `got ${r.summary.historyStartsAtBootstrap}`);
    check('H-01', 'reports one open vacancy and no tenancies',
      kinds(r, 'vacancy').length === 1 && r.summary.tenancyCount === 0,
      `vacancy=${kinds(r, 'vacancy').length} tenancies=${r.summary.tenancyCount}`);
    check('H-01', 'measures the open vacancy against now (72 days)',
      r.summary.currentVacancyDays === 72, `got ${r.summary.currentVacancyDays}`);
  }

  // ── H-02 vacancy BEFORE the first lease ────────────────────────────────────
  {
    const r = await h('H-02');
    const v = kinds(r, 'vacancy');
    check('H-02', 'shows the lease-up vacancy that precedes the first tenancy',
      v.length === 1 && v[0].durationDays === 181, JSON.stringify(v.map((x: any) => x.durationDays)));
    check('H-02', 'counts those days as vacant, not as leased',
      r.summary.totalDaysVacant === 181, `vacant=${r.summary.totalDaysVacant}`);
  }

  // ── H-03 re-let with a gap ─────────────────────────────────────────────────
  {
    const r = await h('H-03');
    const v = kinds(r, 'vacancy');
    check('H-03', 'shows both the lease-up vacancy and the re-let gap',
      v.length === 2, `got ${v.length}`);
    check('H-03', 'totals 59 + 184 vacant days across the unit’s life',
      r.summary.totalDaysVacant === 59 + 184, `got ${r.summary.totalDaysVacant}`);
    check('H-03', 'reports two tenancies', r.summary.tenancyCount === 2, `got ${r.summary.tenancyCount}`);
    check('H-03', 'is not vacant now', r.summary.isCurrentlyVacant === false);
  }

  // ── H-04 back-to-back ──────────────────────────────────────────────────────
  {
    const r = await h('H-04');
    check('H-04', 'invents no vacancy between same-day turnover leases',
      kinds(r, 'vacancy').length === 0, `got ${kinds(r, 'vacancy').length}`);
    check('H-04', 'still reports both tenancies',
      r.summary.tenancyCount === 2, `got ${r.summary.tenancyCount}`);
    // The DB constraint is the real guard; prove it rejects a genuine overlap.
    let rejected = false;
    try {
      await prisma.lease.create({
        data: {
          unitId: byNumber.get('H-04')!.id, tenantName: 'Overlapper', monthlyRent: 1,
          leaseStart: new Date('2027-01-01'), leaseEnd: new Date('2027-06-01'),
          termMonths: 5, status: 'DRAFT',
        },
      });
    } catch (e: any) { rejected = /lease_unit_no_overlap/.test(String(e.message)); }
    check('H-04', 'the exclusion constraint still rejects a real overlap', rejected);
  }

  // ── H-05 fit-out gap ───────────────────────────────────────────────────────
  {
    const r = await h('H-05');
    const f = kinds(r, 'fit_out');
    check('H-05', 'renders the fit-out gap as its own entry',
      f.length === 1 && f[0].durationDays === 90, JSON.stringify(f.map((x: any) => x.durationDays)));
    // The fit-out window is LEASE_PENDING, which classifies as RESERVED — the unit is
    // committed, not on the market. No vacancy window may intersect it. (The earlier
    // Oct-Jan vacancy is genuine lease-up time and must still be there.)
    const fitStart = +new Date('2026-01-01'), fitEnd = +new Date('2026-04-01');
    const intersects = kinds(r, 'vacancy').filter((v: any) => {
      const s = +new Date(v.startDate), e = v.endDate ? +new Date(v.endDate) : Infinity;
      return s < fitEnd && e > fitStart;
    });
    check('H-05', 'no vacancy window overlaps the fit-out period',
      intersects.length === 0, JSON.stringify(intersects.map((v: any) => [v.startDate, v.endDate])));
    check('H-05', 'the lease-up vacancy before the lease is still reported',
      kinds(r, 'vacancy').length === 1, `got ${kinds(r, 'vacancy').length}`);

    const lease = await prisma.lease.findFirstOrThrow({ where: { unitId: byNumber.get('H-05')!.id } });
    const ps = await prisma.leaseRentPeriod.findMany({ where: { leaseId: lease.id }, orderBy: { startDate: 'asc' } });
    check('H-05', 'the rent schedule starts at rent commencement, not lease start',
      ps.length > 0 && ps[0].startDate.toISOString().slice(0, 10) === '2026-04-01',
      ps[0]?.startDate.toISOString().slice(0, 10));
    const inv = await prisma.leaseRentInvoice.findMany({ where: { leaseId: lease.id }, orderBy: { periodMonth: 'asc' } });
    check('H-05', 'no invoice exists for the fit-out months',
      inv.filter((i) => i.periodMonth < new Date('2026-04-01')).length === 0,
      `${inv.filter((i) => i.periodMonth < new Date('2026-04-01')).length} early invoices`);
    check('H-05', 'the derived term excludes the fit-out gap (33, not 36)',
      lease.termMonths === 33, `got ${lease.termMonths}`);
  }

  // ── H-06 free rent ─────────────────────────────────────────────────────────
  {
    const r = await h('H-06');
    check('H-06', 'renders exactly one abatement entry',
      kinds(r, 'free_rent').length === 1, `got ${kinds(r, 'free_rent').length}`);
    check('H-06', 'invents no $X→$0→$X rent-change pair around the abatement',
      kinds(r, 'rent_change').length === 0,
      JSON.stringify(kinds(r, 'rent_change').map((e: any) => [e.data.from, e.data.to])));
    // Free months at the START of a lease have no earlier paying period to value them
    // against — and that is the commonest arrangement, not an exotic one.
    check('H-06', 'values an abatement that starts on day one of the lease',
      kinds(r, 'free_rent')[0]?.data.forgoneMonthlyRent === 6000,
      `got ${kinds(r, 'free_rent')[0]?.data.forgoneMonthlyRent}`);
    check('H-06', 'states what the concession cost in total',
      (kinds(r, 'free_rent')[0]?.data.forgoneTotal ?? 0) > 11000,
      `got ${kinds(r, 'free_rent')[0]?.data.forgoneTotal}`);
  }

  // ── H-07 escalations ───────────────────────────────────────────────────────
  {
    const r = await h('H-07');
    const rc = kinds(r, 'rent_change');
    check('H-07', 'emits one entry per escalation, and none for the initial rent',
      rc.length === 4, `got ${rc.length}`);
    check('H-07', 'every escalation is marked scheduled, not manual',
      rc.every((e: any) => e.data.isScheduled === true));
    check('H-07', 'escalations dated ahead of now are marked upcoming',
      rc.filter((e: any) => e.isProjected).length === 3,
      `projected=${rc.filter((e: any) => e.isProjected).length}`);
    check('H-07', 'each step carries both ends of the move',
      rc.every((e: any) => e.data.from > 0 && e.data.to > e.data.from));
  }

  // ── H-08 manual renegotiation ──────────────────────────────────────────────
  {
    const r = await h('H-08');
    const rc = kinds(r, 'rent_change');
    check('H-08', 'shows the renegotiation as a manual change',
      rc.length === 1 && rc[0].data.isScheduled === false, `got ${rc.length}`);
    check('H-08', 'carries the mandatory reason',
      /hardship/i.test(rc[0]?.data.reason ?? ''), rc[0]?.data.reason ?? 'none');
    check('H-08', 'records the decrease with a negative delta',
      rc[0]?.data.delta === -800, `got ${rc[0]?.data.delta}`);
  }

  // ── H-09 clean sale ────────────────────────────────────────────────────────
  {
    const r = await h('H-09');
    check('H-09', 'raises no data warning when the lease was terminated at the sale',
      (r.summary.dataWarnings ?? []).length === 0, JSON.stringify(r.summary.dataWarnings));
    check('H-09', 'suppresses nothing', r.summary.suppressedAfterSale === 0,
      `got ${r.summary.suppressedAfterSale}`);
    check('H-09', 'shows the sale on the timeline', kinds(r, 'sale').length === 1);
  }

  // ── H-10 sold with the lease left ACTIVE ───────────────────────────────────
  {
    const r = await h('H-10');
    check('H-10', 'warns that a SOLD unit still has an ACTIVE lease',
      (r.summary.dataWarnings ?? []).some((w: string) => /SOLD but still has an ACTIVE lease/.test(w)),
      JSON.stringify(r.summary.dataWarnings));
    check('H-10', 'withholds rent changes dated after the sale closed',
      r.summary.suppressedAfterSale > 0, `got ${r.summary.suppressedAfterSale}`);
    check('H-10', 'shows no rent movement after the closing date',
      kinds(r, 'rent_change').every((e: any) => new Date(e.startDate) <= new Date('2026-03-01')),
      JSON.stringify(kinds(r, 'rent_change').map((e: any) => e.startDate)));
    check('H-10', 'says how many were withheld rather than hiding them silently',
      (r.summary.dataWarnings ?? []).some((w: string) => /are not shown/.test(w)));
  }

  // ── H-10 (cont.) the WRITE paths must be closed, not just the display ───────
  // Suppressing post-sale rent from the timeline is worthless if "Regenerate future"
  // can mint it straight back. The buttons are disabled in the UI; these assert the
  // API refuses regardless of what a client sends.
  {
    const lease = await prisma.lease.findFirstOrThrow({
      where: { unitId: byNumber.get('H-10')!.id, deletedAt: null }, select: { id: true },
    });
    const refuses = async (fn: () => Promise<any>) => {
      try { await fn(); return false; } catch (e: any) { return /has been sold/.test(String(e.message)); }
    };
    check('H-10', 'refuses to regenerate future periods on a sold unit',
      await refuses(() => periods.regenerateFuture(lease.id)));
    check('H-10', 'refuses a forced schedule regeneration on a sold unit',
      await refuses(() => periods.generateForLease(lease.id, { force: true })));
    check('H-10', 'refuses a manual rent change dated after the sale',
      await refuses(() => periods.addManualPeriod({
        leaseId: lease.id, startDate: new Date('2027-01-01') as any,
        baseRent: 9999, reason: 'must be refused',
      } as any)));

    // The pre-sale story stays editable — H2's backfill depends on it.
    let preSaleAllowed = false;
    try {
      await periods.addManualPeriod({
        leaseId: lease.id, startDate: new Date('2025-06-01') as any,
        baseRent: 5100, reason: 'legitimate pre-sale correction',
      } as any);
      preSaleAllowed = true;
    } catch { /* recorded below */ }
    check('H-10', 'still allows a correction dated BEFORE the sale', preSaleAllowed);
    await prisma.leaseRentPeriod.deleteMany({ where: { leaseId: lease.id, source: 'MANUAL' } });

    await prisma.leaseRentInvoice.deleteMany({
      where: { leaseId: lease.id, periodMonth: { gt: new Date('2026-03-01') } },
    });
    await invoices.generateForLease(lease.id, { through: new Date('2029-01-01') });
    const postSale = await prisma.leaseRentInvoice.count({
      where: { leaseId: lease.id, periodMonth: { gt: new Date('2026-03-01') } },
    });
    check('H-10', 'the ledger cannot be billed past the sale, even on request',
      postSale === 0, `${postSale} post-sale invoices created`);
  }

  // ── H-11 cancelled sale ────────────────────────────────────────────────────
  {
    const r = await h('H-11');
    check('H-11', 'shows the reserved window and the release back to market',
      kinds(r, 'vacancy').length === 2, `got ${kinds(r, 'vacancy').length}`);
    check('H-11', 'is vacant again now', r.summary.isCurrentlyVacant === true);
    check('H-11', 'shows the collapsed sale with its lost reason',
      kinds(r, 'sale')[0]?.data.lostReason === 'FINANCING_FELL_THROUGH',
      kinds(r, 'sale')[0]?.data.lostReason);
  }

  // ── H-12 construction ──────────────────────────────────────────────────────
  {
    const r = await h('H-12');
    check('H-12', 'narrates the construction window, which no lease or sale explains',
      kinds(r, 'status').length === 1, `got ${kinds(r, 'status').length}`);
    check('H-12', 'does not count construction as vacancy',
      r.summary.totalDaysVacant === 192, `got ${r.summary.totalDaysVacant}`);
  }

  // ── H-13 backfilled out of order ───────────────────────────────────────────
  {
    const r = await h('H-13');
    const first = r.windows[0];
    check('H-13', 'orders by real-world date, not by write order',
      first?.kind === 'VACANT' && first.start.toISOString().slice(0, 10) === '2024-01-01',
      `${first?.kind} @ ${first?.start?.toISOString().slice(0, 10)}`);
  }

  // ── H-14 same-instant flips ────────────────────────────────────────────────
  {
    const r = await h('H-14');
    check('H-14', 'collapses the zero-length window the unit never occupied',
      r.windows.every((w: any) => w.durationDays > 0 || w.isOngoing),
      JSON.stringify(r.windows.map((w: any) => [w.kind, w.durationDays])));
    check('H-14', 'keeps the state the unit actually ended up in',
      r.windows[r.windows.length - 1].kind === 'LEASED',
      r.windows[r.windows.length - 1].kind);
  }

  // ── H-15 future-dated event ────────────────────────────────────────────────
  {
    const r = await h('H-15');
    check('H-15', 'clamps a future-dated event to zero days rather than going negative',
      r.summary.currentVacancyDays === 0 && r.summary.totalDaysVacant === 0,
      `current=${r.summary.currentVacancyDays} total=${r.summary.totalDaysVacant}`);
  }

  // ── H-16 soft-deleted lease ────────────────────────────────────────────────
  {
    const r = await h('H-16');
    check('H-16', 'excludes a soft-deleted lease from the timeline',
      kinds(r, 'lease').length === 0 && r.summary.tenancyCount === 0,
      `leases=${kinds(r, 'lease').length}`);
  }

  // ── H-17 zero-sqft unit ────────────────────────────────────────────────────
  {
    const r = await h('H-17');
    check('H-17', 'renders a zero-sqft unit without dividing by zero',
      Number.isFinite(r.summary.totalDaysVacant), JSON.stringify(r.summary));
  }

  // ── Cross-cutting: no entry may carry an invalid date or NaN money ──────────
  for (const u of units) {
    const r = await history.getHistory(u.id, NOW);
    const bad = r.entries.filter(
      (e: any) => !e.startDate || Number.isNaN(new Date(e.startDate).getTime()) ||
        (e.durationDays != null && !Number.isFinite(e.durationDays)),
    );
    check(u.unitNumber, 'every entry has a valid date and a finite duration',
      bad.length === 0, bad.length ? JSON.stringify(bad.map((b: any) => b.id)) : '');
  }

  await app.close();

  // ── Report ─────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  const width = Math.max(...results.map((r) => r.claim.length));
  let currentUnit = '';
  for (const r of results) {
    if (r.unit !== currentUnit) { console.log(`\n${r.unit}`); currentUnit = r.unit; }
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.claim.padEnd(width)}${r.ok ? '' : `   <- ${r.detail}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log('\nFAILURES');
    for (const f of failed) console.log(`  ${f.unit}  ${f.claim}\n        ${f.detail}`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
