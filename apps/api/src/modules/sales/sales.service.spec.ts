import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesService, assertCancellationReconciles } from './sales.service';
import { SALE_STAGE_DOCS, requiredDocsForTransition } from './sale-document-gates';

const mockPrisma: any = {
  sale: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  unit: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
  project: { findUnique: jest.fn() },
  orgSettings: { findUnique: jest.fn() },
  broker: { findUnique: jest.fn() },
  // Cancellation ledger (S1). Written inside the same transaction as the unit release.
  saleCancellation: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
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

function makeService() {
  return new SalesService(
    mockPrisma as any,
    mockBus as any,
    mockStatusEvents as any,
    mockLeases as any,
    mockSalePayments as any,
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
    mockPrisma.sale.findUnique.mockResolvedValue({ id: 's1', status: 'UNDER_CONTRACT', unitId: 'u1', unit: {} });

    await service.update('s1', { status: 'CLOSED' } as any);

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
      id: 's1', status: 'UNDER_CONTRACT', projectId: 'pr1', unitId: 'u1', salePrice: 90, discountApprovedAt: null, unit: {},
    });
    mockPrisma.unit.findUnique.mockResolvedValue({ askingPrice: 100 }); // 10% discount > 5%

    await expect(service.update('s1', { status: 'CLOSED' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.sale.update).not.toHaveBeenCalled();
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

    await service.delete('s1', 'FOUNDER' as any);

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
    await expect(service.delete('s1', 'SALES' as any)).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.sale.update).not.toHaveBeenCalled();
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
