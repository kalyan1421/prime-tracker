import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesService, assertCancellationReconciles } from './sales.service';
import { SALE_STAGE_DOCS, requiredDocsForTransition } from './sale-document-gates';
import { HistoricalDeletionService } from '../../common/utils/historical-deletion.service';

const mockPrisma: any = {
  sale: {
    findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    // backfillSale checks for an identical sale before writing. Defaults to "nothing like
    // this is stored", which is what every existing backfill case assumes; the duplicate
    // suite overrides it.
    findFirst: jest.fn().mockResolvedValue(null),
  },
  unit: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
  building: { findUnique: jest.fn() },
  salePayment: { create: jest.fn() },
  project: { findUnique: jest.fn() },
  orgSettings: { findUnique: jest.fn() },
  broker: { findUnique: jest.fn() },
  // Cancellation ledger (S1). Written inside the same transaction as the unit release.
  saleCancellation: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  // R6 — the Founder approval gate on deleting a backfilled sale. Defaults are the
  // "no request exists" answers, which is what every non-historical sale sees.
  historicalRecordDeletion: {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
  },
  // Closing a sale looks for the tenancies to end (H3). Defaults to "no lease on this
  // unit" so the existing suites stay about the sale; the H3 cases override it. findMany,
  // not findFirst: a unit can hold more than one non-terminated lease.
  lease: { findMany: jest.fn().mockResolvedValue([]) },
  // Stage document gate (S6/D1). Defaults to "every gated document is on file" so the
  // other suites stay about the thing they are testing; the gate suite overrides it.
  document: {
    findMany: jest.fn().mockResolvedValue([
      { category: 'LOI' },
      { category: 'BOOKING_AGREEMENT' },
      { category: 'DEED' },
      { category: 'NOC' },
      { category: 'POSSESSION_CERTIFICATE' },
    ]),
  },
  // Support both forms: array (batch) and callback (interactive) transactions.
  $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma))),
};

// The CLOSE-with-unit path uses an optimistic-locked interactive transaction
// (updateMany guarded on status != CLOSED, then findUniqueOrThrow). Default to "won the race".
function stubCloseTxn() {
  mockPrisma.sale.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.sale.findUniqueOrThrow.mockImplementation((args: any) =>
    Promise.resolve({ id: args.where.id, status: 'CLOSED' }),
  );
}
// jest.clearAllMocks() (which every suite below calls) clears CALLS but keeps
// implementations, so a `mockResolvedValue` set by the gate suite would otherwise leak
// into every suite that runs after it. Re-arm the "all documents on file" default here:
// a file-scope beforeEach runs before each suite's own, so the gate suite still gets to
// override it.
beforeEach(() => {
  mockPrisma.document.findMany.mockResolvedValue([
    { category: 'LOI' },
    { category: 'BOOKING_AGREEMENT' },
    { category: 'DEED' },
    { category: 'NOC' },
    { category: 'POSSESSION_CERTIFICATE' },
  ]);
});

const mockBus = { emit: jest.fn() };

// Occupancy-log double. The real service writes unit_status_events inside the same
// transaction as the unit flip; these suites assert the flip, not the log, so a spy
// is enough — but it is a spy rather than a no-op so the log-write assertions below
// can check that a flip and its event stay in lockstep.
const mockStatusEvents = { record: jest.fn(), recordIfChanged: jest.fn() };

// Closing a sale now ends the sitting tenancy in the same transaction (H3). These suites
// assert the SALE side; the tenancy end has its own coverage in leases.service.spec.
const mockLeases = { endTenancyWithin: jest.fn().mockResolvedValue({}) };

// The installment side of a cancellation (S1). What it does to the schedule is asserted
// in sale-payments.service.spec — here it is the source of `totalCollected` and the proof
// that the sweep is invoked from inside the cancelling transaction.
const mockSalePayments = {
  sumCollected: jest.fn().mockResolvedValue(new Prisma.Decimal(0)),
  voidScheduleOnCancellation: jest.fn().mockResolvedValue(0),
};

// R7 — commission installment sync. A spy is enough here; its own behavior (create vs
// adjust vs leave-alone) is asserted in commission-installment.service.spec.ts.
const mockCommissionInstallments = {
  syncStampedAmount: jest.fn().mockResolvedValue(undefined),
  add: jest.fn().mockResolvedValue(undefined),
};

// R4 — backfillSale logs an explicit audit action beyond what AuditInterceptor covers.
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

// R6 — real HistoricalDeletionService over the same mockPrisma, same reasoning as the
// leases spec: the delete-gate tests below assert against mockPrisma.historicalRecordDeletion.
const mockHistoricalDeletions = new HistoricalDeletionService(mockPrisma as any);

function makeService() {
  return new SalesService(
    mockPrisma as any,
    mockBus as any,
    mockStatusEvents as any,
    mockLeases as any,
    mockSalePayments as any,
    mockCommissionInstallments as any,
    mockHistoricalDeletions as any,
    mockAudit as any,
  );
}

describe('SalesService.update — unit-status side effects', () => {
  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.sale.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, status: args.data.status }),
    );
    mockPrisma.unit.update.mockResolvedValue({});
    // The flip paths read the unit's prior status inside the transaction to stamp the
    // occupancy event's fromStatus. Default to a reserved unit — the state the CLOSE
    // and CANCEL paths are actually reached from.
    mockPrisma.unit.findUniqueOrThrow.mockResolvedValue({ status: 'UNDER_CONTRACT' });
    mockPrisma.saleCancellation.upsert.mockResolvedValue({ id: 'sc1' });
    mockSalePayments.sumCollected.mockResolvedValue(new Prisma.Decimal(0));
    mockSalePayments.voidScheduleOnCancellation.mockResolvedValue(0);
    stubCloseTxn();
  });

  it('CANCELLING a sale releases the reserved unit back to AVAILABLE (backend-issue #1)', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'UNDER_CONTRACT', unitId: 'u1', unit: {} });
    mockPrisma.unit.findUnique.mockResolvedValue({ status: 'UNDER_CONTRACT' });

    await service.update('s1', { status: 'CANCELLED', lostReason: 'PRICE_TOO_HIGH' } as any);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.unit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ status: 'AVAILABLE', availableSince: expect.any(Date) }),
      }),
    );
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sale.statusChanged', from: 'UNDER_CONTRACT', to: 'CANCELLED' }),
    );
  });

  it('does NOT touch a unit that is already SOLD when a (closed) sale is cancelled', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'CLOSED', unitId: 'u1', unit: {} });
    mockPrisma.unit.findUnique.mockResolvedValue({ status: 'SOLD' });

    await service.update('s1', { status: 'CANCELLED' } as any);

    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
    expect(mockPrisma.sale.update).toHaveBeenCalledTimes(1);
  });

  it('still flips the unit to SOLD when a sale CLOSES (regression)', async () => {
    // salePrice must be set — closing a sale with no price is rejected (see the
    // "requires a sale price to close" tests below), and this test is about the unit
    // side effect, not price validation, so give it a price to get past that gate.
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'UNDER_CONTRACT', unitId: 'u1', unit: {}, salePrice: 500000 });

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockPrisma.unit.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { status: 'SOLD', availableSince: null } }),
    );
  });

  it('rejects closing a sale with no price set, and no price on the update either', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'UNDER_CONTRACT', unitId: 'u1', unit: {}, salePrice: null });

    await expect(service.update('s1', { status: 'CLOSED' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
    expect(mockPrisma.sale.update).not.toHaveBeenCalled();
  });

  it('allows closing when the update itself sets the price, even though the sale had none', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'UNDER_CONTRACT', unitId: 'u1', unit: {}, salePrice: null });

    await service.update('s1', { status: 'CLOSED', salePrice: 500000 } as any);

    expect(mockPrisma.unit.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { status: 'SOLD', availableSince: null } }),
    );
  });

  it('defaults lostReason to OTHER when cancelling without one', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'PROSPECT', unitId: null, unit: null });

    await service.update('s1', { status: 'CANCELLED' } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lostReason: 'OTHER' }) }),
    );
    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
  });
});

describe('SalesService — discount-approval gate', () => {
  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.sale.update.mockImplementation((args: any) => Promise.resolve({ id: args.where.id }));
    mockPrisma.unit.update.mockResolvedValue({});
    mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'o1' });
    mockPrisma.orgSettings.findUnique.mockResolvedValue({ discountApprovalThresholdPct: 5 });
    stubCloseTxn();
  });

  it('blocks committing a sale whose discount exceeds the threshold and is unapproved', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'LOI_SIGNED', projectId: 'pr1', unitId: 'u1', salePrice: 90, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 }); // 10% discount > 5%

    await expect(service.update('s1', { status: 'UNDER_CONTRACT' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.sale.update).not.toHaveBeenCalled();
  });

  it('does NOT ask for approval again on Under Contract -> Closed', async () => {
    // The commitment — and its Founder sign-off — happened at Under Contract. Re-charging
    // it at closing stranded already-approved, already-contracted deals at the last step
    // (client decision 2026-09-02). Same over-threshold, still-unapproved sale as the test
    // above; only the origin stage differs.
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 90, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 }); // 10% discount > 5%

    await service.update('s1', { status: 'CLOSED' } as any);
    expect(mockPrisma.sale.updateMany).toHaveBeenCalled();
  });

  it('still gates a sale skipping straight from Prospect to Closed', async () => {
    // Skipping the Under Contract rung must not buy a discount on the approval, for the
    // same reason requiredDocsForTransition is cumulative over the rungs it crosses.
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'PROSPECT', projectId: 'pr1', unitId: 'u1', salePrice: 90, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 });

    // Matched on the message, not just the type: the document gate runs first and also
    // throws ForbiddenException, so a bare type assertion would pass for the wrong reason.
    await expect(service.update('s1', { status: 'CLOSED' } as any))
      .rejects.toThrow(/Founder\/Co-Founder approval/);
  });

  it('allows committing once the discount has been approved', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 90,
      discountApprovedAt: new Date(), unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 });

    await service.update('s1', { status: 'CLOSED' } as any);
    // close-with-unit commits via the optimistic-locked updateMany, not update
    expect(mockPrisma.sale.updateMany).toHaveBeenCalled();
  });

  it('allows committing when the discount is within the threshold', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 97, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 }); // 3% ≤ 5%

    await service.update('s1', { status: 'CLOSED' } as any);
    expect(mockPrisma.sale.updateMany).toHaveBeenCalled();
  });

  it('does NOT re-stamp commission / re-flip the unit when a concurrent CLOSE won the race', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 97, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 });
    mockPrisma.sale.updateMany.mockResolvedValue({ count: 0 }); // lost the optimistic lock

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
    expect(mockPrisma.sale.findUniqueOrThrow).toHaveBeenCalled();
  });

  it('the LOSER of a concurrent CLOSE emits nothing (no duplicate unit.sold notifications)', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 97, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 });
    mockPrisma.sale.updateMany.mockResolvedValue({ count: 0 }); // lost the optimistic lock

    await service.update('s1', { status: 'CLOSED' } as any);

    // The pre-transaction snapshot still says UNDER_CONTRACT, but this request wrote
    // nothing — announcing the close would double-notify ~10 recipients.
    expect(mockBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'unit.sold' }));
    expect(mockBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sale.statusChanged' }));
    expect(mockBus.emit).not.toHaveBeenCalled();
  });

  it('the WINNER of a concurrent CLOSE emits unit.sold + sale.statusChanged exactly once', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 97, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 });
    mockPrisma.sale.updateMany.mockResolvedValue({ count: 1 }); // won the optimistic lock

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockBus.emit).toHaveBeenCalledWith({
      type: 'unit.sold', unitId: 'u1', saleId: 's1', projectId: 'pr1',
    });
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sale.statusChanged', from: 'UNDER_CONTRACT', to: 'CLOSED' }),
    );
    expect(mockBus.emit.mock.calls.filter((c: any[]) => c[0].type === 'unit.sold')).toHaveLength(1);
  });

  it('does not gate a building-level sale (no unit asking price)', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'PROSPECT', projectId: 'pr1', unitId: null, salePrice: 90, discountApprovedAt: null, unit: null,
    });

    await service.update('s1', { status: 'UNDER_CONTRACT' } as any);
    expect(mockPrisma.sale.update).toHaveBeenCalled();
    expect(mockPrisma.unit.findUnique).not.toHaveBeenCalled();
  });

  it('approveDiscount stamps approver + timestamp', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', unit: {} });
    await service.approveDiscount('s1', 'founder-1');
    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ discountApprovedById: 'founder-1', discountApprovedAt: expect.any(Date) }),
      }),
    );
  });
});

describe('SalesService — stage document gate (S6/D1)', () => {
  let service: SalesService;

  /** Nothing on file unless a test says otherwise — the point of the suite. */
  function attached(...categories: string[]) {
    mockPrisma.document.findMany.mockResolvedValue(categories.map((category) => ({ category })));
  }

  function saleIn(status: string, over: Record<string, any> = {}) {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1',
      status,
      projectId: 'pr1',
      unitId: 'u1',
      buyer: 'Acme Corp',
      salePrice: 100,
      discountApprovedAt: null,
      unit: { id: 'u1', unitNumber: '101' },
      ...over,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    attached();
    mockPrisma.sale.update.mockImplementation((args: any) => Promise.resolve({ id: args.where.id }));
    mockPrisma.unit.update.mockResolvedValue({});
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: null }); // no discount to gate on
    mockPrisma.unit.findUniqueOrThrow.mockResolvedValue({ status: 'UNDER_CONTRACT' });
    mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'o1' });
    mockPrisma.orgSettings.findUnique.mockResolvedValue({ discountApprovalThresholdPct: 5 });
    mockPrisma.saleCancellation.upsert.mockResolvedValue({ id: 'sc1' });
    stubCloseTxn();
  });

  it('refuses LOI Signed when the LOI is not attached, and writes nothing', async () => {
    saleIn('PROSPECT');

    await expect(service.update('s1', { status: 'LOI_SIGNED' } as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mockPrisma.sale.update).not.toHaveBeenCalled();
    expect(mockPrisma.sale.updateMany).not.toHaveBeenCalled();
  });

  it('names the sale, the target stage and the exact missing category in the refusal', async () => {
    saleIn('PROSPECT');

    await expect(service.update('s1', { status: 'LOI_SIGNED' } as any)).rejects.toThrow(
      /The sale of unit 101 to Acme Corp cannot move to LOI Signed: LOI is not attached/,
    );
  });

  it('allows LOI Signed once the LOI is attached', async () => {
    saleIn('PROSPECT');
    attached('LOI');

    await service.update('s1', { status: 'LOI_SIGNED' } as any);
    expect(mockPrisma.sale.update).toHaveBeenCalled();
  });

  it('asks only for the rung being crossed — LOI Signed → Under Contract wants the Booking Agreement, not the LOI', async () => {
    saleIn('LOI_SIGNED');

    await expect(service.update('s1', { status: 'UNDER_CONTRACT' } as any)).rejects.toThrow(
      /Booking Agreement is not attached/,
    );
    // A sale already sitting in LOI_SIGNED from before this gate existed is not trapped
    // there by a missing LOI.
    expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: { in: ['BOOKING_AGREEMENT'] } }),
      }),
    );
  });

  it('allows Under Contract once the Booking Agreement is attached', async () => {
    saleIn('LOI_SIGNED');
    attached('BOOKING_AGREEMENT');

    await service.update('s1', { status: 'UNDER_CONTRACT' } as any);
    expect(mockPrisma.sale.update).toHaveBeenCalled();
  });

  it('lists every missing closing document by name', async () => {
    saleIn('UNDER_CONTRACT');
    attached('DEED');

    await expect(service.update('s1', { status: 'CLOSED' } as any)).rejects.toThrow(
      /cannot move to Closed: NOC and Possession Certificate are not attached/,
    );
    expect(mockPrisma.sale.updateMany).not.toHaveBeenCalled();
  });

  it('allows Closed once all three closing documents are attached', async () => {
    saleIn('UNDER_CONTRACT');
    attached('DEED', 'NOC', 'POSSESSION_CERTIFICATE');

    await service.update('s1', { status: 'CLOSED' } as any);
    expect(mockPrisma.sale.updateMany).toHaveBeenCalled();
  });

  // The cumulative decision, pinned: a transition owes the documents of every rung it
  // CROSSES, so skipping stages cannot be used to walk around the gate.
  it('Prospect → Closed owes the skipped stages’ documents too', async () => {
    saleIn('PROSPECT');
    attached('DEED', 'NOC', 'POSSESSION_CERTIFICATE');

    await expect(service.update('s1', { status: 'CLOSED' } as any)).rejects.toThrow(
      /LOI and Booking Agreement are not attached/,
    );
    expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: { in: ['LOI', 'BOOKING_AGREEMENT', 'DEED', 'NOC', 'POSSESSION_CERTIFICATE'] },
        }),
      }),
    );
  });

  it('explains WHY a skipping transition asks for earlier documents', async () => {
    saleIn('PROSPECT');
    attached('DEED', 'NOC', 'POSSESSION_CERTIFICATE');

    await expect(service.update('s1', { status: 'CLOSED' } as any)).rejects.toThrow(
      /Moving straight from Prospect to Closed also requires the documents for the stages being skipped/,
    );
  });

  it('does not gate a BACKWARDS transition (Under Contract → Prospect) with nothing on file', async () => {
    saleIn('UNDER_CONTRACT');

    await service.update('s1', { status: 'PROSPECT' } as any);
    expect(mockPrisma.sale.update).toHaveBeenCalled();
    expect(mockPrisma.document.findMany).not.toHaveBeenCalled();
  });

  it('does not gate CANCELLED — missing paperwork is exactly why a deal gets cancelled', async () => {
    saleIn('UNDER_CONTRACT');

    await service.update('s1', { status: 'CANCELLED' } as any);
    expect(mockPrisma.document.findMany).not.toHaveBeenCalled();
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sale.statusChanged', to: 'CANCELLED' }),
    );
  });

  it('does not gate an update that leaves the status alone', async () => {
    saleIn('PROSPECT');

    await service.update('s1', { notes: 'called the buyer' } as any);
    expect(mockPrisma.document.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.sale.update).toHaveBeenCalled();
  });

  it('does not re-gate a sale already sitting in the stage', async () => {
    // Existing sales past these stages must keep working: the gate is on the TRANSITION.
    saleIn('CLOSED');

    await service.update('s1', { status: 'CLOSED', notes: 'corrected buyer name' } as any);
    expect(mockPrisma.document.findMany).not.toHaveBeenCalled();
  });

  it('counts only non-deleted documents on THIS sale', async () => {
    saleIn('PROSPECT');
    attached('LOI');

    await service.update('s1', { status: 'LOI_SIGNED' } as any);
    expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ saleId: 's1', deletedAt: null }) }),
    );
  });

  it('a soft-deleted LOI does not satisfy the gate', async () => {
    saleIn('PROSPECT');
    // The query filters deletedAt: null, so the deleted row simply is not returned.
    attached();

    await expect(service.update('s1', { status: 'LOI_SIGNED' } as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('falls back to the buyer, then the id, when there is no unit to name', async () => {
    saleIn('PROSPECT', { unitId: null, unit: null });

    await expect(service.update('s1', { status: 'LOI_SIGNED' } as any)).rejects.toThrow(
      /The sale to Acme Corp cannot move to LOI Signed/,
    );
  });
});

describe('SalesService.create — a sale born CLOSED (2026-08-25)', () => {
  let service: SalesService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.document.findMany.mockResolvedValue([]);
    // create() checks the unit belongs to the project before anything else.
    mockPrisma.unit.findUnique.mockResolvedValue({
      id: 'u1', askingPrice: null, building: { projectId: 'pr1' },
    });
    mockPrisma.sale.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'new', ...args.data }));
  });

  /**
   * Creating straight into CLOSED skips every stage, and the gate is cumulative over the
   * rungs crossed precisely so skipping cannot buy a discount on the paperwork. Since
   * documents attach by saleId and the sale does not exist yet, a closed-on-arrival sale
   * is simply not a thing that can exist — the message has to say so.
   */
  it('is refused, naming every document the skipped stages owe', async () => {
    await expect(
      service.create({ projectId: 'pr1', unitId: 'u1', buyer: 'B', salePrice: 100, status: 'CLOSED' } as any),
    ).rejects.toThrow(/cannot be created already closed: LOI, Booking Agreement, Deed, NOC and Possession Certificate/);
    expect(mockPrisma.sale.create).not.toHaveBeenCalled();
  });

  it('says how to actually get there', async () => {
    await expect(
      service.create({ projectId: 'pr1', unitId: 'u1', buyer: 'B', salePrice: 100, status: 'CLOSED' } as any),
    ).rejects.toThrow(/Create the sale at its current stage, upload the paperwork, then move it to Closed/);
  });

  it('leaves a sale created at an earlier stage alone', async () => {
    const created: any = await service.create(
      { projectId: 'pr1', unitId: 'u1', buyer: 'B', salePrice: 100, status: 'UNDER_CONTRACT' } as any,
    );
    expect(created.status).toBe('UNDER_CONTRACT');
    expect(mockPrisma.sale.create).toHaveBeenCalled();
  });
});

describe('sale-document-gates — the map, in isolation', () => {
  it('gates only the stages the client asked about', () => {
    expect(Object.keys(SALE_STAGE_DOCS).sort()).toEqual(
      ['CLOSED', 'LOI_SIGNED', 'UNDER_CONTRACT'].sort(),
    );
  });

  it('a transition crossing one rung owes only that rung', () => {
    expect(requiredDocsForTransition('PROSPECT', 'LOI_SIGNED')).toEqual(['LOI']);
    expect(requiredDocsForTransition('LOI_SIGNED', 'UNDER_CONTRACT')).toEqual(['BOOKING_AGREEMENT']);
    expect(requiredDocsForTransition('UNDER_CONTRACT', 'CLOSED')).toEqual([
      'DEED',
      'NOC',
      'POSSESSION_CERTIFICATE',
    ]);
  });

  it('is cumulative over crossed rungs, never over the sale’s history', () => {
    expect(requiredDocsForTransition('PROSPECT', 'CLOSED')).toEqual([
      'LOI',
      'BOOKING_AGREEMENT',
      'DEED',
      'NOC',
      'POSSESSION_CERTIFICATE',
    ]);
    // already past LOI_SIGNED → the LOI is never asked for again
    expect(requiredDocsForTransition('LOI_SIGNED', 'CLOSED')).not.toContain('LOI');
  });

  it('never gates backwards moves, no-ops, or off-pipeline targets', () => {
    expect(requiredDocsForTransition('CLOSED', 'PROSPECT')).toEqual([]);
    expect(requiredDocsForTransition('UNDER_CONTRACT', 'UNDER_CONTRACT')).toEqual([]);
    expect(requiredDocsForTransition('UNDER_CONTRACT', 'CANCELLED')).toEqual([]);
    expect(requiredDocsForTransition('PROSPECT', 'SOMETHING_ELSE')).toEqual([]);
  });

  it('a revived CANCELLED sale owes every rung up to its target', () => {
    expect(requiredDocsForTransition('CANCELLED', 'UNDER_CONTRACT')).toEqual([
      'LOI',
      'BOOKING_AGREEMENT',
    ]);
  });
});

describe('SalesService — broker commission on close', () => {
  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.sale.update.mockImplementation((args: any) => Promise.resolve({ id: args.where.id }));
  });

  // building-level sale (unitId null) → skips the discount gate, exercises commission only
  const brokerSale = (over: any = {}) => ({
    id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: null, salePrice: 1000000,
    brokerId: 'br1', brokerCommissionPct: null, discountApprovedAt: null, unit: null, ...over,
  });

  it('stamps commission = salePrice × broker rate on close', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale());
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokerCommissionAmt: 20000 }) }),
    );
  });

  it('per-sale commission % overrides the broker default rate', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ brokerCommissionPct: 3 }));
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokerCommissionAmt: 30000 }) }),
    );
  });

  it('falls back to a flat fee when no percentage is set', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale());
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: null, commissionFlat: 5000 });

    await service.update('s1', { status: 'CLOSED' } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokerCommissionAmt: 5000 }) }),
    );
  });

  it('stamps no commission when the sale has no broker', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ brokerId: null }));

    await service.update('s1', { status: 'CLOSED' } as any);

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    expect(data.brokerCommissionAmt).toBeUndefined();
    expect(mockPrisma.broker.findUnique).not.toHaveBeenCalled();
  });

  // Correcting a closed sale's record afterward (e.g. from the unit detail page) must
  // keep the stamped commission honest — it must not go stale just because the sale
  // isn't transitioning INTO closed this time.
  it('recomputes commission when an ALREADY-CLOSED sale has its broker % edited', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED', brokerCommissionPct: 2 }));
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

    await service.update('s1', { brokerCommissionPct: 5 } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokerCommissionAmt: 50000 }) }),
    );
  });

  it('recomputes commission when an ALREADY-CLOSED sale has its sale price edited', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED' }));
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

    await service.update('s1', { salePrice: 2000000 } as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokerCommissionAmt: 40000 }) }),
    );
  });

  it('zeroes the commission when the broker is explicitly cleared on an already-closed sale', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED' }));

    await service.update('s1', { brokerId: null } as any);

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    expect(data.brokerCommissionAmt).toBeNull();
    // Must not fall through to the OLD broker via computeBrokerCommission's `?? sale.brokerId`.
    expect(mockPrisma.broker.findUnique).not.toHaveBeenCalled();
  });

  it('does NOT touch commission on an unrelated field edit to an already-closed sale', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED' }));

    await service.update('s1', { notes: 'corrected buyer spelling' } as any);

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    expect(data.brokerCommissionAmt).toBeUndefined();
    expect(mockPrisma.broker.findUnique).not.toHaveBeenCalled();
  });

  // The edit form sends null (not undefined) for a field the user emptied, so "cleared"
  // and "omitted" arrive as different values and must behave differently.
  it('falls back to the broker default rate when the per-sale % is cleared on a closed sale', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED', brokerCommissionPct: 3 }));
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

    await service.update('s1', { brokerCommissionPct: null } as any);

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    // 2% of 1,000,000 — the broker default. NOT 30000, which would recompute from the
    // 3% override that this very request deleted.
    expect(Number(data.brokerCommissionAmt)).toBe(20000);
  });

  it('clears a stale commission when the new broker has neither a rate nor a flat fee', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(brokerSale({ status: 'CLOSED', brokerCommissionAmt: 20000 }));
    mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: null, commissionFlat: null });

    await service.update('s1', { brokerId: 'br2' } as any);

    const data = mockPrisma.sale.update.mock.calls[0][0].data;
    // Nothing computable for br2 → the $20,000 stamped for the previous broker must go,
    // not survive by omission.
    expect(data.brokerCommissionAmt).toBeNull();
  });
});

describe('SalesService.delete — soft delete (preserves unit history)', () => {
  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('soft-deletes via update(deletedAt) instead of a hard Prisma delete', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'PROSPECT', unitId: 'u1', unit: {} });
    mockPrisma.sale.update.mockResolvedValue({ id: 's1', deletedAt: new Date() });
    expect(mockPrisma.sale.delete).toBeUndefined(); // never wired up — nothing in this service should call it

    await service.delete('s1', 'user-1', 'FOUNDER' as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('a soft-deleted sale reads back as not-found', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'PROSPECT', deletedAt: new Date() });
    await expect(service.findById('s1')).rejects.toThrow('Sale not found');
  });

  it('still blocks a non-Founder/SuperAdmin from deleting a CLOSED sale', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'CLOSED', unitId: 'u1', unit: {} });
    await expect(service.delete('s1', 'user-1', 'SALES' as any)).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.sale.update).not.toHaveBeenCalled();
  });
});

// R6 — the same Founder-approval gate a backfilled lease already has (R27), generalized
// to sales. Mirrors leases.service.spec.ts's "historical deletion approval" suite.
describe('SalesService — historical deletion approval (R6)', () => {
  let service: SalesService;

  const HISTORICAL = { id: 's1', unitId: 'u1', buyer: 'Old Buyer', status: 'CLOSED', isHistorical: true };
  const LIVE = { id: 's2', unitId: 'u1', buyer: 'Current Buyer', status: 'PROSPECT', isHistorical: false };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue(null);
    mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue(null);
    mockPrisma.historicalRecordDeletion.create.mockImplementation(
      ({ data }: any) => Promise.resolve({ id: 'r-new', ...data }),
    );
    mockPrisma.historicalRecordDeletion.update.mockImplementation(
      ({ where, data }: any) => Promise.resolve({ id: where.id, ...data }),
    );
    mockPrisma.sale.update.mockResolvedValue({ id: 's1', deletedAt: new Date() });
    service = makeService();
  });

  it('refuses to delete a historical sale with no approval', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(HISTORICAL);
    await expect(service.delete('s1', 'user-1', 'SALES' as any)).rejects.toThrow(/Request deletion first/);
    expect(mockPrisma.sale.update).not.toHaveBeenCalled();
  });

  it('deletes once an approval exists, even for a role that could not otherwise delete a CLOSED sale', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(HISTORICAL);
    mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue({ id: 'r1', status: 'APPROVED' });

    await service.delete('s1', 'user-1', 'SALES' as any);

    expect(mockPrisma.sale.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { deletedAt: expect.any(Date) } });
  });

  it('lets an approver delete directly, recorded as self-approved', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(HISTORICAL);

    await service.delete('s1', 'founder-1', 'SALES' as any, true);

    expect(mockPrisma.historicalRecordDeletion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ saleId: 's1', status: 'APPROVED', requestedById: 'founder-1', decidedById: 'founder-1' }),
    });
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SALE_HISTORICAL_DELETED', oldValues: expect.objectContaining({ selfApproved: true }) }),
    );
  });

  it('leaves a live sale governed by the existing role check, not the historical gate', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(LIVE);
    await service.delete('s2', 'user-1', 'SALES' as any);
    expect(mockPrisma.sale.update).toHaveBeenCalled();
    expect(mockPrisma.historicalRecordDeletion.findFirst).not.toHaveBeenCalled();
  });

  describe('requesting', () => {
    it('records the request and emits with a resolved label', async () => {
      mockPrisma.sale.findUnique.mockResolvedValue(HISTORICAL);

      await service.requestHistoricalDeletion('s1', 'duplicate entry', 'user-1');

      expect(mockPrisma.historicalRecordDeletion.create).toHaveBeenCalledWith({
        data: { saleId: 's1', reason: 'duplicate entry', requestedById: 'user-1' },
      });
      expect(mockBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'history.deletionRequested', saleId: 's1', label: 'Old Buyer' }),
      );
    });

    it('refuses for a sale that was recorded live', async () => {
      mockPrisma.sale.findUnique.mockResolvedValue(LIVE);
      await expect(service.requestHistoricalDeletion('s2', 'a reason', 'user-1')).rejects.toThrow(/recorded live/);
    });
  });
});

// ---------------------------------------------------------------------------
// H3 — closing a sale ends the tenancies in occupation
//
// Until this existed, SalesService.close() contained ZERO references to a lease: it
// flipped the unit to SOLD and stopped. The lease stayed ACTIVE, and the only thing
// stopping a departed tenant being invoiced was the billing cron's sold-unit filter.
// ---------------------------------------------------------------------------
const leaseRow = (over: any = {}) => ({
  id: 'l1', tenantName: 'Sitting Tenant LLC', leaseStart: new Date('2025-01-01'), ...over,
});

describe('SalesService — a closed sale ends the sitting tenancy', () => {
  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    stubCloseTxn();
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', unitId: 'u1', projectId: 'pr1', status: 'UNDER_CONTRACT', closingDate: null,
      salePrice: 100000,
    });
    mockPrisma.unit.findUniqueOrThrow.mockResolvedValue({ status: 'UNDER_CONTRACT' });
    mockPrisma.lease.findMany.mockResolvedValue([leaseRow()]);
    mockLeases.endTenancyWithin.mockResolvedValue({});
  });

  it('ends the lease at the CLOSING DATE, with reason TENANT_BOUGHT', async () => {
    // The v1 rule is that a sale means the sitting tenant bought. Dating the end by the
    // closing date — not by now() — is what keeps the ledger and the sale agreeing.
    await service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1');

    const [, leaseId, input] = mockLeases.endTenancyWithin.mock.calls[0];
    expect(leaseId).toBe('l1');
    expect(input.terminationReason).toBe('TENANT_BOUGHT');
    expect(input.terminationDate).toEqual(new Date('2026-06-30'));
    // Regression guard for the single-lease case: exactly one tenancy, ended exactly once.
    expect(mockLeases.endTenancyWithin).toHaveBeenCalledTimes(1);
  });

  it('ends it in the SAME transaction as the unit flip', async () => {
    // Sold-with-a-live-lease is the exact inconsistency both halves prevent, so it must
    // not be reachable by one half succeeding and the other not.
    await service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1');

    const txPassed = mockLeases.endTenancyWithin.mock.calls[0][0];
    expect(txPassed).toBe(mockPrisma); // the interactive-transaction client
  });

  it('FAILS THE SALE when the tenancy cannot be ended', async () => {
    // e.g. rent already collected past the closing date. Closing around a real conflict
    // would leave a unit reading SOLD with a tenancy still running.
    mockLeases.endTenancyWithin.mockRejectedValue(
      new Error('Rent has already been collected for 2026-08'),
    );

    await expect(
      service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1'),
    ).rejects.toThrow(/already been collected/);
  });

  it('does nothing when the unit has no sitting tenancy', async () => {
    mockPrisma.lease.findMany.mockResolvedValue([]);

    await service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1');

    expect(mockLeases.endTenancyWithin).not.toHaveBeenCalled();
    // …and the sale still closes.
    expect(mockPrisma.unit.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SOLD' }) }),
    );
  });

  it('ignores leases that already ended', async () => {
    // The lookup filters on terminationDate + status, so a unit with three past tenancies
    // and no current one is correctly left alone.
    await service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1');

    const where = mockPrisma.lease.findMany.mock.calls[0][0].where;
    expect(where.terminationDate).toBeNull();
    expect(where.status).toEqual({ notIn: ['EXPIRED', 'TERMINATED'] });
    expect(where.deletedAt).toBeNull();
  });

  it('does NOT touch a lease when the sale is CANCELLED', async () => {
    // A cancelled sale releases the unit; it does not un-end a tenancy, and it must not
    // end one either.
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', unitId: 'u1', status: 'UNDER_CONTRACT', closingDate: null,
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ status: 'UNDER_CONTRACT' });

    await service.update('s1', { status: 'CANCELLED' } as any, 'user-1');

    expect(mockLeases.endTenancyWithin).not.toHaveBeenCalled();
  });

  it('does not end the tenancy twice when a concurrent close wins the lock', async () => {
    // guard.count === 0 means another request already closed this sale — and already
    // ended the tenancy. Running again would throw "this tenancy already ended".
    mockPrisma.sale.updateMany.mockResolvedValue({ count: 0 });

    await service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1');

    expect(mockLeases.endTenancyWithin).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // More than ONE live tenancy. findFirst used to pick a single row by
  // `leaseStart desc`, which is both too few and the wrong one.
  // -------------------------------------------------------------------------

  it('ends EVERY tenancy in occupation, not just one', async () => {
    // A unit can hold two non-terminated leases at once: assertNoOverlappingLease permits
    // a lease starting the day another ends. Ending only one left the other ACTIVE on a
    // unit now reading SOLD — the exact inconsistency this code exists to prevent.
    mockPrisma.lease.findMany.mockResolvedValue([
      leaseRow({ id: 'l-old', tenantName: 'First Tenant', leaseStart: new Date('2024-01-01') }),
      leaseRow({ id: 'l-new', tenantName: 'Second Tenant', leaseStart: new Date('2026-06-01') }),
    ]);

    await service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1');

    expect(mockLeases.endTenancyWithin).toHaveBeenCalledTimes(2);
    // Oldest first — the query orders by leaseStart asc so the outcome does not depend on
    // whatever order the rows happen to come back in.
    expect(mockLeases.endTenancyWithin.mock.calls.map((c: any[]) => c[1])).toEqual([
      'l-old', 'l-new',
    ]);
    for (const call of mockLeases.endTenancyWithin.mock.calls) {
      expect(call[2].terminationReason).toBe('TENANT_BOUGHT');
      expect(call[2].terminationDate).toEqual(new Date('2026-06-30'));
    }
  });

  it('acts on the lease IN OCCUPATION and leaves a future-dated successor alone (R4)', async () => {
    // The unit state machine allows LEASED → LEASE_PENDING so a successor can be signed
    // while the sitting tenant is still in. `leaseStart desc` used to pick that DRAFT
    // successor and terminate it, leaving the ACTIVE tenancy running on a SOLD unit.
    // Nothing can be "ended" before it starts, and the close is never blocked by one.
    mockPrisma.lease.findMany.mockResolvedValue([
      leaseRow({ id: 'l-active', tenantName: 'Sitting Tenant', leaseStart: new Date('2025-01-01') }),
      leaseRow({ id: 'l-draft', tenantName: 'Next Tenant', leaseStart: new Date('2026-07-01') }),
    ]);

    await service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1');

    expect(mockLeases.endTenancyWithin).toHaveBeenCalledTimes(1);
    expect(mockLeases.endTenancyWithin.mock.calls[0][1]).toBe('l-active');
    // …and the sale still closes.
    expect(mockPrisma.unit.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SOLD' }) }),
    );
  });

  it('treats a lease starting ON the closing date as in occupation', async () => {
    // Boundary: a tenancy that begins the day the sale completes is a tenancy the buyer
    // would otherwise inherit unannounced.
    mockPrisma.lease.findMany.mockResolvedValue([
      leaseRow({ id: 'l-sameday', leaseStart: new Date('2026-06-30') }),
    ]);

    await service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1');

    expect(mockLeases.endTenancyWithin.mock.calls[0][1]).toBe('l-sameday');
  });

  // -------------------------------------------------------------------------
  // R5 — notify on the same footing as a manual end-tenancy.
  // endTenancyWithin deliberately emits nothing (the caller's transaction can still roll
  // back), so the emit is this method's job. It was never written: ending a tenancy
  // through the sale door notified nobody, while the LeasesService.endTenancy door did.
  // -------------------------------------------------------------------------

  it('emits lease.terminated once per ended tenancy, after the commit', async () => {
    mockPrisma.lease.findMany.mockResolvedValue([
      leaseRow({ id: 'l-old', tenantName: 'First Tenant', leaseStart: new Date('2024-01-01') }),
      leaseRow({ id: 'l-new', tenantName: 'Second Tenant', leaseStart: new Date('2026-06-01') }),
    ]);

    await service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1');

    // Same shape LeasesService.endTenancy emits, so downstream handlers cannot tell which
    // door was used.
    expect(mockBus.emit).toHaveBeenCalledWith({
      type: 'lease.terminated', leaseId: 'l-old', projectId: 'pr1',
      tenantName: 'First Tenant', reason: 'TENANT_BOUGHT',
    });
    expect(mockBus.emit).toHaveBeenCalledWith({
      type: 'lease.terminated', leaseId: 'l-new', projectId: 'pr1',
      tenantName: 'Second Tenant', reason: 'TENANT_BOUGHT',
    });
    expect(
      mockBus.emit.mock.calls.filter((c: any[]) => c[0].type === 'lease.terminated'),
    ).toHaveLength(2);
  });

  it('emits NOTHING for a tenancy when a concurrent close won the race', async () => {
    // Nothing was written and no tenancy was ended by THIS request — the winner already
    // announced it. A second notification would be a second alert for one move-out.
    mockPrisma.sale.updateMany.mockResolvedValue({ count: 0 });

    await service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1');

    expect(mockBus.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lease.terminated' }),
    );
  });

  it('does not announce a tenancy end that rolled back with its sale', async () => {
    // The emit sits outside the transaction on purpose. If the close throws, nothing is
    // announced — a notification for a move-out that did not happen is worse than none.
    mockLeases.endTenancyWithin.mockRejectedValue(
      new Error('Rent has already been collected for 2026-08'),
    );

    await expect(
      service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30' } as any, 'user-1'),
    ).rejects.toThrow(/already been collected/);

    expect(mockBus.emit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// S4 / T1 — who bought decides what happens to the tenancy.
//
// Before Sale.buyerType existed this path hard-coded TENANT_BOUGHT for every close, so a
// third-party sale of a tenanted unit DELETED the remaining rent periods and voided the
// future invoices of a tenant still in occupation and still owing rent. Unrecoverable,
// and driven by an assumption nobody was asked to confirm.
//
// The tests below are mostly about what is NOT done, and about the default staying put:
// every sale written before the field existed reads as SITTING_TENANT, which is exactly
// what the old code assumed about it.
// ---------------------------------------------------------------------------
describe('SalesService — a third-party sale hands the tenancy over instead of ending it', () => {
  let service: SalesService;

  const sittingTenant = {
    id: 'l1', tenantName: 'Sitting Tenant LLC', leaseStart: new Date('2025-01-01'),
  };

  /** The stored sale. `buyerType` is overridden per case; omit it to model a legacy row. */
  const saleRow = (over: any = {}) => ({
    id: 's1', unitId: 'u1', projectId: 'pr1', status: 'UNDER_CONTRACT', closingDate: null,
    salePrice: 100000, ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    stubCloseTxn();
    mockPrisma.unit.findUniqueOrThrow.mockResolvedValue({ status: 'LEASED' });
    mockPrisma.unit.update.mockResolvedValue({});
    mockPrisma.lease.findMany.mockResolvedValue([sittingTenant]);
    mockLeases.endTenancyWithin.mockResolvedValue({});
  });

  const close = (over: any = {}) =>
    service.update('s1', { status: 'CLOSED', closingDate: '2026-06-30', ...over } as any, 'user-1');

  it('ends the tenancy as TENANT_BOUGHT when the SITTING TENANT bought', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'SITTING_TENANT' }));

    await close();

    expect(mockLeases.endTenancyWithin.mock.calls[0][2].terminationReason).toBe('TENANT_BOUGHT');
  });

  it('transfers the tenancy — NOT TENANT_BOUGHT — when a THIRD PARTY bought', async () => {
    // The reason is the whole branch: LEASE_TRANSFERRED_WITH_SALE is what makes
    // endTenancyWithin skip capAtTermination and voidAfter. Asserting the reason here and
    // the skip in leases.service.spec keeps each test on one side of the seam.
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'THIRD_PARTY' }));

    await close();

    const input = mockLeases.endTenancyWithin.mock.calls[0][2];
    expect(input.terminationReason).toBe('LEASE_TRANSFERRED_WITH_SALE');
    expect(input.terminationDate).toEqual(new Date('2026-06-30'));
    // The note is what a human reads on the lease afterwards, so it has to say the tenant
    // stayed — "Ended automatically when the sale closed" would be a lie.
    expect(input.terminationNote).toMatch(/remains in occupation/);
  });

  it('flips the unit to SOLD on the third-party path too', async () => {
    // The tenancy surviving does not make the sale any less of a sale. SOLD is also what
    // NOT_ON_SOLD_UNIT keys off, and that filter — not the skipped cap — is what actually
    // stops Prime billing a tenancy it handed over.
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'THIRD_PARTY' }));

    await close();

    expect(mockPrisma.unit.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SOLD' }) }),
    );
  });

  it('marks the unit SOLD BEFORE ending the tenancy, which is what makes the transfer legal', async () => {
    // endTenancyWithin refuses LEASE_TRANSFERRED_WITH_SALE unless the unit already reads
    // SOLD. Reversing these two writes would make every third-party close fail on a guard
    // it is supposed to satisfy.
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'THIRD_PARTY' }));

    await close();

    expect(mockPrisma.unit.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockLeases.endTenancyWithin.mock.invocationCallOrder[0],
    );
  });

  it('a sale that predates the field keeps its old meaning — the tenant bought', async () => {
    // The migration defaults every existing row to SITTING_TENANT. A close that silently
    // changed behaviour for historical sales would be a worse bug than the one being fixed.
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow()); // no buyerType at all

    await close();

    expect(mockLeases.endTenancyWithin.mock.calls[0][2].terminationReason).toBe('TENANT_BOUGHT');
  });

  it('takes buyerType from THIS request, not from the row it is about to overwrite', async () => {
    // "Who bought it" is answered at completion. Closing and choosing third-party is one
    // PUT, so reading the stored value would act on the answer from before the dialog.
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'SITTING_TENANT' }));

    await close({ buyerType: 'THIRD_PARTY' });

    expect(mockLeases.endTenancyWithin.mock.calls[0][2].terminationReason)
      .toBe('LEASE_TRANSFERRED_WITH_SALE');
  });

  it('changes nothing on a vacant unit — buyerType only bites when someone is in occupation', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'THIRD_PARTY' }));
    mockPrisma.lease.findMany.mockResolvedValue([]);

    await close();

    expect(mockLeases.endTenancyWithin).not.toHaveBeenCalled();
    expect(mockPrisma.unit.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SOLD' }) }),
    );
  });

  it('transfers EVERY tenancy in occupation, not just the first', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'THIRD_PARTY' }));
    mockPrisma.lease.findMany.mockResolvedValue([
      { id: 'l-old', tenantName: 'First Tenant', leaseStart: new Date('2024-01-01') },
      { id: 'l-new', tenantName: 'Second Tenant', leaseStart: new Date('2026-06-01') },
    ]);

    await close();

    expect(mockLeases.endTenancyWithin).toHaveBeenCalledTimes(2);
    for (const call of mockLeases.endTenancyWithin.mock.calls) {
      expect(call[2].terminationReason).toBe('LEASE_TRANSFERRED_WITH_SALE');
    }
  });

  // ── R5 — notification parity, on both paths ──────────────────────────────────────
  it('announces the transfer after the commit, with the reason that tells it apart', async () => {
    // One event type for both endings on purpose: the audience is identical (Finance
    // stops expecting the rent, Sales stops treating the space as Prime's) and `reason`
    // is what distinguishes them. A separate event type would be a second name for one
    // message — and a handler that forgot to subscribe would re-create the exact R5
    // defect of a tenancy leaving the book silently.
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'THIRD_PARTY' }));

    await close();

    expect(mockBus.emit).toHaveBeenCalledWith({
      type: 'lease.terminated', leaseId: 'l1', projectId: 'pr1',
      tenantName: 'Sitting Tenant LLC', reason: 'LEASE_TRANSFERRED_WITH_SALE',
    });
  });

  it('says nothing when a third-party close rolls back', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'THIRD_PARTY' }));
    mockLeases.endTenancyWithin.mockRejectedValue(new Error('unit is not SOLD'));

    await expect(close()).rejects.toThrow(/not SOLD/);
    expect(mockBus.emit).not.toHaveBeenCalled();
  });

  // ── R6 — the unit's history distinguishes the two endings ────────────────────────
  it('records the sale as a LANDLORD CHANGE when a third party bought', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'THIRD_PARTY' }));

    await close();

    const event = mockStatusEvents.recordIfChanged.mock.calls[0][0];
    expect(event).toMatchObject({ toStatus: 'SOLD', source: 'SALE_CLOSED', saleId: 's1' });
    expect(event.reason).toMatch(/third party/);
    expect(event.reason).toMatch(/continues/);
  });

  it('records the sale as one continuous story when the sitting tenant bought', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'SITTING_TENANT' }));

    await close();

    const event = mockStatusEvents.recordIfChanged.mock.calls[0][0];
    expect(event.reason).toMatch(/sitting tenant/);
    expect(event.reason).toMatch(/ends at completion/);
  });

  it('narrates nothing about the buyer when there was no tenancy to reason about', async () => {
    // On a vacant unit buyerType has no consequence, so stating one would put a
    // distinction into the history that the sale never made.
    mockPrisma.sale.findUnique.mockResolvedValue(saleRow({ buyerType: 'THIRD_PARTY' }));
    mockPrisma.lease.findMany.mockResolvedValue([]);

    await close();

    expect(mockStatusEvents.recordIfChanged.mock.calls[0][0].reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S1 — the cancellation refund/penalty ledger
//
// CancelSaleModal collected a refund and a penalty and update() threw them away
// (deferred as "discovery item D18"), so a sale could be killed with real collected money
// on it and nothing recorded about where that money went. The fix is a transition row
// with an invariant, not two loose columns on Sale: see SaleCancellation.
// ---------------------------------------------------------------------------

/** Every disposition that carries a decision — i.e. everything but DECIDE_LATER. */
const DECIDED = ['REFUND', 'FORFEIT', 'NET'] as const;

describe('assertCancellationReconciles — the invariant, in isolation', () => {
  const dec = (n: number) => new Prisma.Decimal(n);

  it.each(DECIDED)('refuses a %s that leaves collected money unaccounted for', (disposition) => {
    expect(() =>
      assertCancellationReconciles({
        disposition,
        totalCollected: dec(50_000),
        refundAmount: dec(20_000),
        penaltyAmount: dec(10_000),
      }),
    ).toThrow(BadRequestException);
  });

  it('names all three figures so the wrong one is visible without opening the database', () => {
    try {
      assertCancellationReconciles({
        disposition: 'NET',
        totalCollected: dec(50_000),
        refundAmount: dec(20_000),
        penaltyAmount: dec(10_000),
      });
      throw new Error('expected the invariant to throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toContain('20000.00'); // refund
      expect(e.message).toContain('10000.00'); // penalty
      expect(e.message).toContain('50000.00'); // collected
      expect(e.message).toContain('-20000.00'); // the shortfall, signed
      expect(e.message).toContain('DECIDE_LATER'); // and the way out
    }
  });

  it('accepts DECIDE_LATER with nothing allocated — that IS the state', () => {
    expect(() =>
      assertCancellationReconciles({
        disposition: 'DECIDE_LATER',
        totalCollected: dec(50_000),
        refundAmount: dec(0),
        penaltyAmount: dec(0),
      }),
    ).not.toThrow();
  });

  it('accepts a full REFUND, a full FORFEIT and a NET split of the same collected sum', () => {
    const cases = [
      { disposition: 'REFUND' as const, refundAmount: dec(50_000), penaltyAmount: dec(0) },
      { disposition: 'FORFEIT' as const, refundAmount: dec(0), penaltyAmount: dec(50_000) },
      { disposition: 'NET' as const, refundAmount: dec(45_000), penaltyAmount: dec(5_000) },
    ];
    for (const c of cases) {
      expect(() => assertCancellationReconciles({ ...c, totalCollected: dec(50_000) })).not.toThrow();
    }
  });

  it('reconciles at the precision the money is stored at (Decimal(14,2))', () => {
    // 33333.34 + 16666.66 is exactly 50000.00 in Decimal and NOT in binary floats.
    expect(() =>
      assertCancellationReconciles({
        disposition: 'NET',
        totalCollected: dec(50_000),
        refundAmount: dec(33_333.34),
        penaltyAmount: dec(16_666.66),
      }),
    ).not.toThrow();
  });

  it('holds when NOTHING was collected — zero is still an amount that must reconcile', () => {
    expect(() =>
      assertCancellationReconciles({
        disposition: 'FORFEIT',
        totalCollected: dec(0),
        refundAmount: dec(0),
        penaltyAmount: dec(1_000),
      }),
    ).toThrow(/0.00 was collected/);
  });
});

describe('SalesService.update — cancellation ledger', () => {
  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.sale.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, status: args.data.status }),
    );
    mockPrisma.unit.update.mockResolvedValue({});
    mockPrisma.unit.findUniqueOrThrow.mockResolvedValue({ status: 'UNDER_CONTRACT' });
    mockPrisma.saleCancellation.upsert.mockImplementation((args: any) =>
      Promise.resolve({ id: 'sc1', ...args.create }),
    );
    mockSalePayments.sumCollected.mockResolvedValue(new Prisma.Decimal(50_000));
    mockSalePayments.voidScheduleOnCancellation.mockResolvedValue(2);
    // A reserved unit-level sale — the state a cancellation is actually reached from.
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', unitId: 'u1', projectId: 'pr1', unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ status: 'UNDER_CONTRACT' });
  });

  it('defaults to DECIDE_LATER and needs no amounts — cancelling at 6pm without Finance', async () => {
    await service.update('s1', { status: 'CANCELLED' } as any, 'user-1');

    expect(mockPrisma.saleCancellation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { saleId: 's1' },
        create: expect.objectContaining({
          saleId: 's1',
          disposition: 'DECIDE_LATER',
          cancelledById: 'user-1',
        }),
      }),
    );
    const data = mockPrisma.saleCancellation.upsert.mock.calls[0][0].create;
    expect(data.refundAmount.toString()).toBe('0');
    expect(data.penaltyAmount.toString()).toBe('0');
    // Collected money is still SNAPSHOTTED, even with the decision deferred — that is what
    // Finance will reconcile against later, and it must be the figure from cancel-time.
    expect(data.totalCollected.toString()).toBe('50000');
  });

  it.each(DECIDED)('accepts a reconciling %s', async (disposition) => {
    const split: Record<string, { refundAmount: number; penaltyAmount: number }> = {
      REFUND: { refundAmount: 50_000, penaltyAmount: 0 },
      FORFEIT: { refundAmount: 0, penaltyAmount: 50_000 },
      NET: { refundAmount: 30_000, penaltyAmount: 20_000 },
    };

    await service.update(
      's1',
      { status: 'CANCELLED' } as any,
      'user-1',
      { disposition, ...split[disposition] },
    );

    expect(mockPrisma.saleCancellation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ disposition }) }),
    );
    expect(mockPrisma.unit.update).toHaveBeenCalled(); // and the unit still went back to market
  });

  it('REFUSES the whole cancellation when the ledger does not reconcile', async () => {
    await expect(
      service.update('s1', { status: 'CANCELLED' } as any, 'user-1', {
        disposition: 'NET',
        refundAmount: 20_000,
        penaltyAmount: 10_000,
      }),
    ).rejects.toThrow(/does not reconcile/);

    // The point of doing this inside the transaction: a sale whose unit went back on the
    // market with the money unaccounted for is the exact hole S1 closes. Nothing is
    // written, so the operator fixes the numbers rather than discovering the gap later.
    expect(mockPrisma.saleCancellation.upsert).not.toHaveBeenCalled();
    expect(mockSalePayments.voidScheduleOnCancellation).not.toHaveBeenCalled();
  });

  it('snapshots totalCollected rather than storing a reference to be recomputed', async () => {
    mockSalePayments.sumCollected.mockResolvedValue(new Prisma.Decimal(12_500.5));

    await service.update('s1', { status: 'CANCELLED' } as any, 'user-1');

    // Summed INSIDE the transaction (the mock $transaction passes mockPrisma through as
    // tx), then frozen onto the row.
    expect(mockSalePayments.sumCollected).toHaveBeenCalledWith(mockPrisma, 's1');
    const data = mockPrisma.saleCancellation.upsert.mock.calls[0][0].create;
    expect(data.totalCollected.toString()).toBe('12500.5');
  });

  it('voids the rest of the schedule in the same transaction', async () => {
    await service.update('s1', { status: 'CANCELLED' } as any, 'user-1');

    expect(mockSalePayments.voidScheduleOnCancellation).toHaveBeenCalledWith(mockPrisma, 's1');
  });

  it('records the ledger for a BUILDING-level sale, which has no unit to release', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'UNDER_CONTRACT', unitId: null, buildingId: 'b1', projectId: 'pr1', unit: null,
    });

    await service.update('s1', { status: 'CANCELLED' } as any, 'user-1', {
      disposition: 'FORFEIT', penaltyAmount: 50_000,
    });

    expect(mockPrisma.saleCancellation.upsert).toHaveBeenCalled();
    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
  });

  it('records the ledger even when the unit is NOT the cancelling sale\'s to release', async () => {
    // A closed sale being cancelled: the unit reads SOLD and must not be touched. The
    // money still has to be accounted for — the two concerns are independent.
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'CLOSED', unitId: 'u1', projectId: 'pr1', unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ status: 'SOLD' });

    await service.update('s1', { status: 'CANCELLED' } as any, 'user-1');

    expect(mockPrisma.saleCancellation.upsert).toHaveBeenCalled();
    expect(mockPrisma.unit.update).not.toHaveBeenCalled();
  });

  it('records refundPaidAt only when there is a refund to have been paid', async () => {
    await expect(
      service.update('s1', { status: 'CANCELLED' } as any, 'user-1', {
        disposition: 'FORFEIT',
        penaltyAmount: 50_000,
        refundPaidAt: '2026-08-14',
      }),
    ).rejects.toThrow(/refunds nothing/);
  });

  it('writes NO ledger row when the sale was already CANCELLED', async () => {
    mockPrisma.sale.findUnique.mockResolvedValue({
      id: 's1', status: 'CANCELLED', unitId: 'u1', projectId: 'pr1', unit: {},
    });

    await service.update('s1', { lostReasonNote: 'corrected the note' } as any, 'user-1');

    // One cancellation, one ledger row (@unique on saleId). Editing a cancelled sale is
    // not a second cancellation.
    expect(mockPrisma.saleCancellation.upsert).not.toHaveBeenCalled();
  });
});

describe('SalesService.settleCancellation — Finance decides later', () => {
  let service: SalesService;

  const existing = (over: any = {}) => ({
    id: 'sc1',
    saleId: 's1',
    totalCollected: new Prisma.Decimal(50_000),
    disposition: 'DECIDE_LATER',
    refundAmount: new Prisma.Decimal(0),
    penaltyAmount: new Prisma.Decimal(0),
    refundPaidAt: null,
    refundReference: null,
    note: null,
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.saleCancellation.findUnique.mockResolvedValue(existing());
    mockPrisma.saleCancellation.update.mockImplementation((args: any) =>
      Promise.resolve({ ...existing(), ...args.data }),
    );
  });

  it('404s when the sale has no cancellation to settle', async () => {
    mockPrisma.saleCancellation.findUnique.mockResolvedValue(null);
    await expect(service.settleCancellation('s1', { disposition: 'REFUND' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('settles a DECIDE_LATER once the amounts reconcile', async () => {
    await service.settleCancellation('s1', {
      disposition: 'NET', refundAmount: 45_000, penaltyAmount: 5_000,
    });

    expect(mockPrisma.saleCancellation.update).toHaveBeenCalledWith({
      where: { saleId: 's1' },
      data: expect.objectContaining({ disposition: 'NET' }),
    });
  });

  it('reconciles against the SNAPSHOT, not a fresh sum of the installments', async () => {
    // Installments edited since the cancellation must not move the goalposts. The service
    // never asks SalePaymentsService for a new total on this path.
    await expect(
      service.settleCancellation('s1', { disposition: 'REFUND', refundAmount: 40_000 }),
    ).rejects.toThrow(/50000.00 was collected/);
    expect(mockSalePayments.sumCollected).not.toHaveBeenCalled();
  });

  it('refuses to return a settled cancellation to DECIDE_LATER', async () => {
    // A decision can be corrected; it cannot be un-made. Reverting would erase the fact
    // that somebody decided, which is the one thing this row exists to remember.
    mockPrisma.saleCancellation.findUnique.mockResolvedValue(
      existing({ disposition: 'FORFEIT', penaltyAmount: new Prisma.Decimal(50_000) }),
    );

    await expect(
      service.settleCancellation('s1', { disposition: 'DECIDE_LATER' }),
    ).rejects.toThrow(/cannot be returned to DECIDE_LATER/);
  });

  it('records when the money ACTUALLY moved, separately from when it was decided', async () => {
    mockPrisma.saleCancellation.findUnique.mockResolvedValue(
      existing({ disposition: 'REFUND', refundAmount: new Prisma.Decimal(50_000) }),
    );

    await service.settleCancellation('s1', {
      refundPaidAt: '2026-09-01', refundReference: 'ACH-88421',
    });

    expect(mockPrisma.saleCancellation.update).toHaveBeenCalledWith({
      where: { saleId: 's1' },
      data: expect.objectContaining({
        refundPaidAt: new Date('2026-09-01'),
        refundReference: 'ACH-88421',
        disposition: 'REFUND', // untouched — this call is about the payment, not the decision
      }),
    });
  });

  it('will not mark a refund paid when the disposition refunds nothing', async () => {
    mockPrisma.saleCancellation.findUnique.mockResolvedValue(
      existing({ disposition: 'FORFEIT', penaltyAmount: new Prisma.Decimal(50_000) }),
    );

    await expect(
      service.settleCancellation('s1', { refundPaidAt: '2026-09-01' }),
    ).rejects.toThrow(/refunds nothing/);
  });

  it('leaves omitted fields alone rather than blanking them', async () => {
    mockPrisma.saleCancellation.findUnique.mockResolvedValue(
      existing({
        disposition: 'REFUND',
        refundAmount: new Prisma.Decimal(50_000),
        refundReference: 'ACH-88421',
        note: 'Buyer financing fell through',
      }),
    );

    await service.settleCancellation('s1', {});

    expect(mockPrisma.saleCancellation.update).toHaveBeenCalledWith({
      where: { saleId: 's1' },
      data: expect.objectContaining({
        refundReference: 'ACH-88421',
        note: 'Buyer financing fell through',
      }),
    });
  });
});

describe('SalesService.backfillSale', () => {
  let service: SalesService;

  const PAST_SALE = {
    unitId: 'u1',
    buyer: 'Historical Buyer LLC',
    salePrice: 500000,
    closingDate: '2022-06-30',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1', deletedAt: null, building: { projectId: 'p1' } });
    mockPrisma.unit.findUniqueOrThrow.mockResolvedValue({ status: 'LEASED' });
    mockPrisma.unit.update.mockResolvedValue({});
    // clearAllMocks resets calls, not implementations — without this the duplicate suite's
    // override would leak into every case that follows it.
    mockPrisma.sale.findFirst.mockResolvedValue(null);
    mockPrisma.sale.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'sale-hist1', ...data }));
    mockPrisma.salePayment.create.mockResolvedValue({});
    mockPrisma.lease.findMany.mockResolvedValue([]); // no tenancy on the unit by default
    mockStatusEvents.recordIfChanged.mockResolvedValue({ id: 'evt1' });
    mockLeases.endTenancyWithin.mockResolvedValue({});
  });

  it('refuses a closing date in the future', async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    await expect(
      service.backfillSale({ ...PAST_SALE, closingDate: future.toISOString() } as any, 'user-1'),
    ).rejects.toThrow(/has not closed yet/);
  });

  // Unlike a lease, a sale carries no date range, so there is no exclusion constraint in
  // the database to fall back on. This guard is the only thing standing between a
  // re-uploaded spreadsheet and a second copy of every sale it contains.
  describe('duplicate protection', () => {
    it('refuses a sale already recorded on the unit for the same buyer and day', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: 'existing', buyer: 'Historical Buyer LLC', salePrice: 500000,
        closingDate: new Date('2022-06-30'), isHistorical: true,
      });
      await expect(service.backfillSale(PAST_SALE as any, 'user-1'))
        .rejects.toThrow(/already recorded/);
      expect(mockPrisma.sale.create).not.toHaveBeenCalled();
    });

    it('compares the closing date as a whole day, not an instant', async () => {
      // Backfill stores midnight UTC; a sale closed through the live path carries a real
      // timestamp. Those are the same day's sale and must not both be written.
      await service.backfillSale(PAST_SALE as any, 'user-1');
      const where = mockPrisma.sale.findFirst.mock.calls[0][0].where;
      expect(where.closingDate.gte.toISOString()).toBe('2022-06-30T00:00:00.000Z');
      expect(where.closingDate.lt.toISOString()).toBe('2022-07-01T00:00:00.000Z');
      expect(where.buyer).toEqual({ equals: 'Historical Buyer LLC', mode: 'insensitive' });
      expect(where.deletedAt).toBeNull();
    });

    it('does not count a soft-deleted sale as the duplicate blocking a re-entry', async () => {
      // Deleting a mistaken record and entering it again is the intended repair path.
      await service.backfillSale(PAST_SALE as any, 'user-1');
      expect(mockPrisma.sale.findFirst.mock.calls[0][0].where.deletedAt).toBeNull();
      expect(mockPrisma.sale.create).toHaveBeenCalled();
    });
  });

  it('requires exactly one of unitId/buildingId', async () => {
    await expect(
      service.backfillSale({ ...PAST_SALE, unitId: undefined } as any, 'user-1'),
    ).rejects.toThrow(/unit or a building/);
    await expect(
      service.backfillSale({ ...PAST_SALE, buildingId: 'b1' } as any, 'user-1'),
    ).rejects.toThrow(/cannot reference both/);
  });

  it('flags the created sale as historical and CLOSED', async () => {
    await service.backfillSale(PAST_SALE as any, 'user-1');
    expect(mockPrisma.sale.create.mock.calls[0][0].data).toMatchObject({
      isHistorical: true,
      status: 'CLOSED',
      unitId: 'u1',
    });
  });

  // Acceptance criterion 1 (R4 spec): no prior tenancy → SOLD, no lease side effects.
  it('sets the unit to SOLD with no lease side effects when nothing was occupying it', async () => {
    await service.backfillSale(PAST_SALE as any, 'user-1');
    expect(mockPrisma.unit.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'SOLD', availableSince: null },
    });
    expect(mockLeases.endTenancyWithin).not.toHaveBeenCalled();
  });

  // Acceptance criterion 2: an overlapping tenancy is ended the same way close() does.
  it('ends an overlapping tenancy with reason TENANT_BOUGHT at the closing date', async () => {
    mockPrisma.lease.findMany.mockResolvedValueOnce([
      { id: 'l1', tenantName: 'Old Tenant', leaseStart: new Date('2020-01-01') },
    ]);

    await service.backfillSale(PAST_SALE as any, 'user-1');

    expect(mockLeases.endTenancyWithin).toHaveBeenCalledWith(
      mockPrisma,
      'l1',
      expect.objectContaining({
        terminationDate: new Date('2022-06-30'),
        terminationReason: 'TENANT_BOUGHT',
      }),
      'user-1',
    );
  });

  it('does not end a lease that starts after the closing date', async () => {
    mockPrisma.lease.findMany.mockResolvedValueOnce([
      { id: 'l1', tenantName: 'Future Tenant', leaseStart: new Date('2023-01-01') },
    ]);

    await service.backfillSale(PAST_SALE as any, 'user-1');

    expect(mockLeases.endTenancyWithin).not.toHaveBeenCalled();
  });

  it('composes SalePayment rows for deposit/second-payment entries, already marked PAID', async () => {
    await service.backfillSale(
      {
        ...PAST_SALE,
        payments: [
          { label: 'Deposit', amount: 50000, paidAt: '2022-01-15' },
          { label: 'Second Payment', amount: 20000 },
        ],
      } as any,
      'user-1',
    );

    expect(mockPrisma.salePayment.create).toHaveBeenCalledTimes(2);
    const [dep, second] = mockPrisma.salePayment.create.mock.calls.map((c: any) => c[0].data);
    expect(dep).toMatchObject({ label: 'Deposit', amount: 50000, paidAmount: 50000, status: 'PAID' });
    expect(second.paidAt).toEqual(new Date('2022-06-30')); // no paidAt given → defaults to the closing date
  });

  // The existing Unit History sale entry reads Sale.depositAmt directly — mirroring the
  // Deposit-labeled payment onto that column keeps it working without touching
  // unit-history.service's rendering in this same change.
  it('mirrors a Deposit-labeled payment onto Sale.depositAmt', async () => {
    await service.backfillSale(
      { ...PAST_SALE, payments: [{ label: 'Deposit', amount: 50000 }] } as any,
      'user-1',
    );
    expect(mockPrisma.sale.create.mock.calls[0][0].data.depositAmt).toBe(50000);
  });

  describe('commission (R7)', () => {
    it('sums explicit installments as the stamped total, and creates each one', async () => {
      await service.backfillSale(
        {
          ...PAST_SALE,
          brokerId: 'b1',
          commissionInstallments: [{ amount: 5000, paidAt: '2022-06-30' }, { amount: 5000 }],
        } as any,
        'user-1',
      );

      expect(mockPrisma.sale.create.mock.calls[0][0].data.brokerCommissionAmt).toBe(10000);
      expect(mockCommissionInstallments.add).toHaveBeenCalledTimes(2);
    });

    it('falls back to computing from brokerCommissionPct when no installments are given', async () => {
      mockPrisma.broker.findUnique.mockResolvedValue({ commissionRate: 2, commissionFlat: null });

      await service.backfillSale(
        { ...PAST_SALE, brokerId: 'b1', brokerCommissionPct: 3 } as any,
        'user-1',
      );

      expect(mockPrisma.sale.create.mock.calls[0][0].data.brokerCommissionAmt).toBe(15000); // 3% of 500000
      expect(mockCommissionInstallments.syncStampedAmount).toHaveBeenCalledWith(
        { saleId: 'sale-hist1' }, 'b1', 15000,
      );
    });
  });
});
