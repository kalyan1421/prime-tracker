import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LeaseObligationService } from './lease-obligation.service';

const D = (v: string | number) => new Prisma.Decimal(v);

const mockPrisma: any = {
  lease: { findFirst: jest.fn(), findUnique: jest.fn() },
  leaseObligation: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  leaseObligationPayment: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  // Callback form only — every mutation in this service runs in a transaction.
  $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma))),
};

const mockBus: any = { emit: jest.fn() };

function makeService() {
  return new LeaseObligationService(mockPrisma as any, mockBus as any);
}

/** Every `lease.tiDisbursed` the service put on the bus. */
function tiEvents() {
  return mockBus.emit.mock.calls
    .map((c: any[]) => c[0])
    .filter((e: any) => e.type === 'lease.tiDisbursed');
}

/** Last `data` object handed to leaseObligation.update — i.e. the mirror that was written. */
function lastMirrorWrite() {
  const calls = mockPrisma.leaseObligation.update.mock.calls;
  return calls[calls.length - 1][0].data;
}

describe('LeaseObligationService', () => {
  let service: LeaseObligationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.leaseObligation.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, ...args.data }),
    );
    mockPrisma.leaseObligationPayment.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'pay-new', ...args.data }),
    );
  });

  // ─────── create ───────

  describe('create', () => {
    beforeEach(() => {
      mockPrisma.lease.findFirst.mockResolvedValue({ id: 'l1' });
      mockPrisma.leaseObligation.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'ob1', ...args.data }),
      );
    });

    it('implies FROM_TENANT for a security deposit and starts PENDING at 0 paid', async () => {
      mockPrisma.leaseObligation.findFirst.mockResolvedValue(null);
      const res: any = await service.create({ leaseId: 'l1', kind: 'SECURITY_DEPOSIT', totalAmount: 5000 });
      expect(res.direction).toBe('FROM_TENANT');
      expect(res.status).toBe('PENDING');
      expect(Number(res.paidAmount)).toBe(0);
    });

    it('implies TO_TENANT for a TI allowance and stores the fixed agreed amount as given', async () => {
      const res: any = await service.create({ leaseId: 'l1', kind: 'TI_ALLOWANCE', totalAmount: 42500.5 });
      expect(res.direction).toBe('TO_TENANT');
      // Fixed agreed amount — no percentage basis is applied anywhere.
      expect(Number(res.totalAmount)).toBe(42500.5);
    });

    it('rejects an invalid kind/direction pair (SECURITY_DEPOSIT + TO_TENANT)', async () => {
      mockPrisma.leaseObligation.findFirst.mockResolvedValue(null);
      await expect(
        service.create({ leaseId: 'l1', kind: 'SECURITY_DEPOSIT', direction: 'TO_TENANT', totalAmount: 5000 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.leaseObligation.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid kind/direction pair (TI_ALLOWANCE + FROM_TENANT)', async () => {
      await expect(
        service.create({ leaseId: 'l1', kind: 'TI_ALLOWANCE', direction: 'FROM_TENANT', totalAmount: 1000 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires an explicit direction for OTHER', async () => {
      await expect(service.create({ leaseId: 'l1', kind: 'OTHER', totalAmount: 100 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.create({ leaseId: 'l1', kind: 'OTHER', direction: 'TO_TENANT', totalAmount: 100 }),
      ).resolves.toEqual(expect.objectContaining({ direction: 'TO_TENANT' }));
    });

    it('rejects a second SECURITY_DEPOSIT on the same lease (one deposit per lease, at its own level)', async () => {
      mockPrisma.leaseObligation.findFirst.mockResolvedValue({ id: 'existing-deposit' });
      await expect(
        service.create({ leaseId: 'l1', kind: 'SECURITY_DEPOSIT', totalAmount: 5000 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.leaseObligation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { leaseId: 'l1', kind: 'SECURITY_DEPOSIT' } }),
      );
      expect(mockPrisma.leaseObligation.create).not.toHaveBeenCalled();
    });

    it('allows a second TI_ALLOWANCE — only deposits are one-per-lease', async () => {
      mockPrisma.leaseObligation.findFirst.mockResolvedValue({ id: 'existing-ti' });
      await expect(
        service.create({ leaseId: 'l1', kind: 'TI_ALLOWANCE', totalAmount: 1000 }),
      ).resolves.toEqual(expect.objectContaining({ kind: 'TI_ALLOWANCE' }));
    });

    it('rejects a non-positive total and an unknown kind', async () => {
      await expect(
        service.create({ leaseId: 'l1', kind: 'TI_ALLOWANCE', totalAmount: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ leaseId: 'l1', kind: 'DEPOSIT', totalAmount: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s on a soft-deleted (or missing) lease', async () => {
      mockPrisma.lease.findFirst.mockResolvedValue(null);
      await expect(
        service.create({ leaseId: 'gone', kind: 'TI_ALLOWANCE', totalAmount: 100 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.lease.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'gone', deletedAt: null } }),
      );
    });
  });

  // ─────── status derivation across successive payments ───────

  describe('recordPayment — derived status', () => {
    /** Wire the mocks so the obligation has `existing` payments totalling `paid`. */
    function seed(total: string, existing: string[], status = 'PENDING') {
      const paid = existing.reduce((s, a) => s.plus(D(a)), D(0));
      mockPrisma.leaseObligation.findUnique.mockResolvedValue({
        id: 'ob1',
        leaseId: 'l1',
        kind: 'SECURITY_DEPOSIT',
        totalAmount: D(total),
        paidAmount: paid,
        status,
      });
      // findMany runs AFTER the insert, so it returns existing + the new payment.
      mockPrisma.leaseObligationPayment.findMany.mockImplementation(() =>
        Promise.resolve(
          [...existing, ...mockPrisma.leaseObligationPayment.create.mock.calls.map((c: any) => c[0].data.amount)].map(
            (a: any) => ({ amount: D(a) }),
          ),
        ),
      );
    }

    it('PENDING → PARTIAL on a first, part payment', async () => {
      seed('5000', []);
      await service.recordPayment('ob1', { amount: 2000 });
      const data = lastMirrorWrite();
      expect(data.status).toBe('PARTIAL');
      expect(Number(data.paidAmount)).toBe(2000);
    });

    it('PARTIAL → SETTLED once cumulative payments reach the total', async () => {
      seed('5000', ['2000'], 'PARTIAL');
      await service.recordPayment('ob1', { amount: 3000 });
      const data = lastMirrorWrite();
      expect(data.status).toBe('SETTLED');
      expect(Number(data.paidAmount)).toBe(5000);
    });

    it('an exact payment lands on SETTLED, not PARTIAL (boundary)', async () => {
      seed('5000', []);
      await service.recordPayment('ob1', { amount: 5000 });
      expect(lastMirrorWrite().status).toBe('SETTLED');
    });

    it('a cent short of the total is still PARTIAL', async () => {
      seed('5000', []);
      await service.recordPayment('ob1', { amount: 4999.99 });
      const data = lastMirrorWrite();
      expect(data.status).toBe('PARTIAL');
      expect(Number(data.paidAmount)).toBe(4999.99);
    });

    it('ALLOWS a CONFIRMED overpayment: status SETTLED, mirror holds the real money received', async () => {
      // Deposits do get over-paid in the field, and blocking the entry outright would
      // strand money the user has actually received. Since 2026-08-12 the caller has to
      // say so explicitly — a $100 TI allowance was accepting a $4,500 payment in
      // silence — but a confirmed overpayment still records exactly as before.
      seed('5000', ['4800'], 'PARTIAL');
      await service.recordPayment('ob1', { amount: 500, allowOverpayment: true });
      const data = lastMirrorWrite();
      expect(data.status).toBe('SETTLED');
      expect(Number(data.paidAmount)).toBe(5300);
      // pending = total - paid → negative, the refund signal for Finance.
      expect(5000 - Number(data.paidAmount)).toBe(-300);
    });

    it('rejects a zero or negative payment before touching the DB', async () => {
      seed('5000', []);
      await expect(service.recordPayment('ob1', { amount: 0 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.recordPayment('ob1', { amount: -100 })).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.leaseObligationPayment.create).not.toHaveBeenCalled();
      expect(mockPrisma.leaseObligation.update).not.toHaveBeenCalled();
    });

    it('rejects a payment against a waived obligation', async () => {
      seed('5000', [], 'WAIVED');
      await expect(service.recordPayment('ob1', { amount: 100 })).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.leaseObligationPayment.create).not.toHaveBeenCalled();
    });

    it('404s on an unknown obligation', async () => {
      mockPrisma.leaseObligation.findUnique.mockResolvedValue(null);
      await expect(service.recordPayment('nope', { amount: 100 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('runs the insert + mirror recompute inside one transaction', async () => {
      seed('5000', []);
      await service.recordPayment('ob1', { amount: 100 });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ─────── TI disbursement announces itself; a deposit does not ───────

  describe('recordPayment — lease.tiDisbursed', () => {
    /** Obligation of `kind` on lease `l-x`, already carrying `existing` payments. */
    function seedObligation(kind: string, total: string, existing: string[]) {
      const paid = existing.reduce((s, a) => s.plus(D(a)), D(0));
      mockPrisma.leaseObligation.findUnique.mockResolvedValue({
        id: 'ob1',
        leaseId: 'l-x',
        kind,
        totalAmount: D(total),
        paidAmount: paid,
        status: paid.greaterThan(0) ? 'PARTIAL' : 'PENDING',
      });
      mockPrisma.leaseObligationPayment.findMany.mockImplementation(() =>
        Promise.resolve(
          [
            ...existing,
            ...mockPrisma.leaseObligationPayment.create.mock.calls.map((c: any) => c[0].data.amount),
          ].map((a: any) => ({ amount: D(a) })),
        ),
      );
    }

    /** A lease hanging off a unit inside a building inside a project. */
    function leaseOnUnit(projectId: string | null) {
      mockPrisma.lease.findUnique.mockResolvedValue({
        building: null,
        unit: { building: projectId ? { projectId } : null },
      });
    }

    it('emits for a TI_ALLOWANCE payment with projectId, amount and remaining pending', async () => {
      seedObligation('TI_ALLOWANCE', '30000', ['5000']);
      leaseOnUnit('p1');

      await service.recordPayment('ob1', { amount: 10000 });

      expect(tiEvents()).toEqual([
        {
          type: 'lease.tiDisbursed',
          leaseId: 'l-x',
          projectId: 'p1',
          amount: 10000,
          // 30000 agreed − 15000 now disbursed
          pending: 15000,
        },
      ]);
    });

    it('resolves the project through the BUILDING when the lease is building-level', async () => {
      seedObligation('TI_ALLOWANCE', '1000', []);
      mockPrisma.lease.findUnique.mockResolvedValue({
        building: { projectId: 'p-bldg' },
        unit: null,
      });

      await service.recordPayment('ob1', { amount: 250 });

      expect(tiEvents()[0]).toEqual(
        expect.objectContaining({ projectId: 'p-bldg', amount: 250, pending: 750 }),
      );
    });

    it('does NOT emit for a SECURITY_DEPOSIT payment (money coming in, not going out)', async () => {
      seedObligation('SECURITY_DEPOSIT', '5000', []);
      leaseOnUnit('p1');

      await service.recordPayment('ob1', { amount: 5000 });

      expect(tiEvents()).toHaveLength(0);
      // and it never even looks the lease up
      expect(mockPrisma.lease.findUnique).not.toHaveBeenCalled();
    });

    it('skips the emit when the project cannot be resolved rather than emitting a broken event', async () => {
      seedObligation('TI_ALLOWANCE', '30000', []);
      leaseOnUnit(null);

      // The payment itself still succeeds — the money is recorded either way.
      const res: any = await service.recordPayment('ob1', { amount: 1000 });
      expect(Number(res.obligation.paidAmount)).toBe(1000);
      expect(tiEvents()).toHaveLength(0);
    });

    it('emits AFTER the transaction commits, never inside it', async () => {
      seedObligation('TI_ALLOWANCE', '30000', []);
      leaseOnUnit('p1');

      let emitsAtCommit = -1;
      mockPrisma.$transaction.mockImplementationOnce(async (fn: any) => {
        const out = await fn(mockPrisma);
        emitsAtCommit = mockBus.emit.mock.calls.length;
        return out;
      });

      await service.recordPayment('ob1', { amount: 1000 });

      expect(emitsAtCommit).toBe(0); // nothing announced while the write could still roll back
      expect(tiEvents()).toHaveLength(1);
    });

    it('does not emit when the payment transaction rolls back', async () => {
      seedObligation('TI_ALLOWANCE', '30000', []);
      leaseOnUnit('p1');
      mockPrisma.$transaction.mockImplementationOnce(() => Promise.reject(new Error('deadlock')));

      await expect(service.recordPayment('ob1', { amount: 1000 })).rejects.toThrow('deadlock');
      expect(tiEvents()).toHaveLength(0);
    });

    it('reports NEGATIVE pending when the TI is over-disbursed (refund signal)', async () => {
      seedObligation('TI_ALLOWANCE', '30000', ['29000']);
      leaseOnUnit('p1');

      // Over-disbursement must be confirmed at the call site; the refund signal it
      // produces downstream is unchanged.
      await service.recordPayment('ob1', { amount: 1500, allowOverpayment: true });

      expect(tiEvents()[0]).toEqual(expect.objectContaining({ amount: 1500, pending: -500 }));
    });

    it('computes pending with Decimal math, not string-concatenating `+`/`-`', async () => {
      seedObligation('TI_ALLOWANCE', '1000.50', ['0.25']);
      leaseOnUnit('p1');

      await service.recordPayment('ob1', { amount: 0.25 });

      // 1000.50 − (0.25 + 0.25). A raw `-` on Prisma Decimals here would produce NaN.
      expect(tiEvents()[0]).toEqual(expect.objectContaining({ amount: 0.25, pending: 1000 }));
    });

    it('a failure resolving the project never fails the recorded payment', async () => {
      seedObligation('TI_ALLOWANCE', '30000', []);
      mockPrisma.lease.findUnique.mockRejectedValue(new Error('db down'));

      await expect(service.recordPayment('ob1', { amount: 1000 })).resolves.toEqual(
        expect.objectContaining({ obligation: expect.anything() }),
      );
      expect(tiEvents()).toHaveLength(0);
    });
  });

  // ─────── the mirror is recomputed, never incremented ───────

  describe('paidAmount mirror', () => {
    it('deleting a MIDDLE payment corrects the mirror (recomputed from survivors)', async () => {
      mockPrisma.leaseObligationPayment.findUnique.mockResolvedValue({ id: 'p2', obligationId: 'ob1' });
      mockPrisma.leaseObligationPayment.delete.mockResolvedValue({ id: 'p2' });
      mockPrisma.leaseObligation.findUnique.mockResolvedValue({
        id: 'ob1',
        totalAmount: D('5000'),
        // Stale mirror from when p1+p2+p3 existed (1000 + 1500 + 2500).
        paidAmount: D('5000'),
        status: 'SETTLED',
      });
      // p2 is gone; p1 and p3 survive.
      mockPrisma.leaseObligationPayment.findMany.mockResolvedValue([
        { amount: D('1000') },
        { amount: D('2500') },
      ]);

      await service.deletePayment('p2');

      const data = lastMirrorWrite();
      expect(Number(data.paidAmount)).toBe(3500); // not 5000 - 1500 by luck: recomputed
      expect(data.status).toBe('PARTIAL'); // and the status walks back from SETTLED
    });

    it('deleting the last payment returns the obligation to PENDING', async () => {
      mockPrisma.leaseObligationPayment.findUnique.mockResolvedValue({ id: 'p1', obligationId: 'ob1' });
      mockPrisma.leaseObligationPayment.delete.mockResolvedValue({ id: 'p1' });
      mockPrisma.leaseObligation.findUnique.mockResolvedValue({
        id: 'ob1',
        totalAmount: D('5000'),
        paidAmount: D('1000'),
        status: 'PARTIAL',
      });
      mockPrisma.leaseObligationPayment.findMany.mockResolvedValue([]);

      await service.deletePayment('p1');

      const data = lastMirrorWrite();
      expect(Number(data.paidAmount)).toBe(0);
      expect(data.status).toBe('PENDING');
    });

    it('sums payments with Decimal math — naive JS `+` would string-concatenate', async () => {
      const payments = [{ amount: D('1000.50') }, { amount: D('1500.25') }, { amount: D('0.25') }];
      // Guard the premise of this test: `+` on Prisma Decimals really does concatenate.
      const naive: any = payments.reduce((s: any, p) => s + p.amount, '');
      expect(typeof naive).toBe('string');
      expect(naive).toBe('1000.51500.250.25');

      mockPrisma.leaseObligationPayment.findUnique.mockResolvedValue({ id: 'p3', obligationId: 'ob1' });
      mockPrisma.leaseObligationPayment.delete.mockResolvedValue({ id: 'p3' });
      mockPrisma.leaseObligation.findUnique.mockResolvedValue({
        id: 'ob1',
        totalAmount: D('5000'),
        paidAmount: D('0'),
        status: 'PENDING',
      });
      mockPrisma.leaseObligationPayment.findMany.mockResolvedValue(payments);

      await service.deletePayment('p3');

      const data = lastMirrorWrite();
      expect(data.paidAmount).toBeInstanceOf(Prisma.Decimal);
      expect(data.paidAmount.toString()).toBe('2501');
      expect(Number(data.paidAmount)).toBe(2501);
    });

    it('a waived obligation keeps status WAIVED while paidAmount stays truthful', async () => {
      mockPrisma.leaseObligationPayment.findUnique.mockResolvedValue({ id: 'p1', obligationId: 'ob1' });
      mockPrisma.leaseObligationPayment.delete.mockResolvedValue({ id: 'p1' });
      mockPrisma.leaseObligation.findUnique.mockResolvedValue({
        id: 'ob1',
        totalAmount: D('5000'),
        paidAmount: D('1200'),
        status: 'WAIVED',
      });
      mockPrisma.leaseObligationPayment.findMany.mockResolvedValue([{ amount: D('200') }]);

      await service.deletePayment('p1');

      const data = lastMirrorWrite();
      expect(data.status).toBe('WAIVED');
      expect(Number(data.paidAmount)).toBe(200);
    });
  });

  // ─────── update / waive ───────

  describe('update', () => {
    beforeEach(() => {
      mockPrisma.leaseObligation.findUnique.mockResolvedValue({
        id: 'ob1',
        kind: 'SECURITY_DEPOSIT',
        totalAmount: D('5000'),
        paidAmount: D('5000'),
        status: 'SETTLED',
        notes: null,
        payments: [],
      });
    });

    it('refuses to change kind', async () => {
      await expect(service.update('ob1', { kind: 'TI_ALLOWANCE' })).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.leaseObligation.update).not.toHaveBeenCalled();
    });

    it('re-derives status when the agreed total is raised (SETTLED → PARTIAL)', async () => {
      await service.update('ob1', { totalAmount: 8000 });
      const data = lastMirrorWrite();
      expect(data.status).toBe('PARTIAL');
      expect(Number(data.totalAmount)).toBe(8000);
    });

    it('re-derives status when the agreed total is lowered below what was paid (→ SETTLED)', async () => {
      mockPrisma.leaseObligation.findUnique.mockResolvedValue({
        id: 'ob1',
        kind: 'SECURITY_DEPOSIT',
        totalAmount: D('5000'),
        paidAmount: D('2000'),
        status: 'PARTIAL',
        payments: [],
      });
      await service.update('ob1', { totalAmount: 1500 });
      expect(lastMirrorWrite().status).toBe('SETTLED');
    });

    it('rejects a non-positive total', async () => {
      await expect(service.update('ob1', { totalAmount: -1 })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('waive', () => {
    beforeEach(() => {
      mockPrisma.leaseObligation.findUnique.mockResolvedValue({
        id: 'ob1',
        kind: 'SECURITY_DEPOSIT',
        totalAmount: D('5000'),
        paidAmount: D('0'),
        status: 'PENDING',
        notes: 'Original note',
        payments: [],
      });
    });

    it('sets WAIVED and appends the reason to notes', async () => {
      await service.waive('ob1', 'Waived in lieu of higher rent');
      const data = lastMirrorWrite();
      expect(data.status).toBe('WAIVED');
      expect(data.notes).toContain('Waived in lieu of higher rent');
      expect(data.notes).toContain('Original note');
    });

    it('requires a reason and refuses to double-waive', async () => {
      await expect(service.waive('ob1', '   ')).rejects.toBeInstanceOf(BadRequestException);
      mockPrisma.leaseObligation.findUnique.mockResolvedValue({ id: 'ob1', status: 'WAIVED', payments: [] });
      await expect(service.waive('ob1', 'again')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─────── rollups ───────

  describe('summaryForUnit', () => {
    it('totals only obligations on leases attached to that unit, per kind', async () => {
      mockPrisma.leaseObligation.findMany.mockResolvedValue([
        { id: 'o1', kind: 'SECURITY_DEPOSIT', totalAmount: D('5000'), paidAmount: D('5000'), status: 'SETTLED', lease: { id: 'l1' } },
        { id: 'o2', kind: 'TI_ALLOWANCE', totalAmount: D('20000'), paidAmount: D('7500'), status: 'PARTIAL', lease: { id: 'l1' } },
      ]);
      const res = await service.summaryForUnit('u1');
      expect(res.totalAgreed).toBe(25000);
      expect(res.totalPaid).toBe(12500);
      expect(res.totalPending).toBe(12500);
      expect(res.byKind).toEqual([
        expect.objectContaining({ kind: 'SECURITY_DEPOSIT', count: 1, totalPending: 0 }),
        expect.objectContaining({ kind: 'TI_ALLOWANCE', count: 1, totalPending: 12500 }),
      ]);
    });

    it('excludes soft-deleted leases from the rollup query', async () => {
      mockPrisma.leaseObligation.findMany.mockResolvedValue([]);
      await service.summaryForUnit('u1');
      expect(mockPrisma.leaseObligation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { lease: { unitId: 'u1', deletedAt: null } } }),
      );
    });
  });

  describe('summaryForBuilding', () => {
    const buildingDeposit = {
      id: 'ob-bldg',
      kind: 'SECURITY_DEPOSIT',
      totalAmount: D('50000'),
      paidAmount: D('50000'),
      status: 'SETTLED',
      lease: { id: 'lb', unitId: null, buildingId: 'b1', tenantName: 'Whole-building Co', unit: null },
    };
    const unitDeposit = {
      id: 'ob-u1',
      kind: 'SECURITY_DEPOSIT',
      totalAmount: D('5000'),
      paidAmount: D('2000'),
      status: 'PARTIAL',
      lease: { id: 'lu1', unitId: 'u1', buildingId: null, tenantName: 'Shop A', unit: { id: 'u1', unitNumber: '101' } },
    };
    const unitTi = {
      id: 'ob-u2',
      kind: 'TI_ALLOWANCE',
      totalAmount: D('30000'),
      paidAmount: D('10000'),
      status: 'PARTIAL',
      lease: { id: 'lu2', unitId: 'u2', buildingId: null, tenantName: 'Shop B', unit: { id: 'u2', unitNumber: '102' } },
    };

    it('keeps a building-level deposit out of the unit totals (no double-count)', async () => {
      mockPrisma.leaseObligation.findMany.mockResolvedValue([buildingDeposit, unitDeposit, unitTi]);
      const res = await service.summaryForBuilding('b1');

      expect(res.buildingLevel.totalAgreed).toBe(50000);
      expect(res.buildingLevel.obligations).toHaveLength(1);

      // The 50k building deposit is NOT apportioned into the units.
      expect(res.unitLevel.totalAgreed).toBe(35000);
      expect(res.unitLevel.units.map((u) => u.unitId)).toEqual(['u1', 'u2']);
      expect(res.unitLevel.units[0]).toEqual(
        expect.objectContaining({ unitNumber: '101', totalAgreed: 5000, totalPaid: 2000, totalPending: 3000 }),
      );

      // combined counts each obligation exactly once: 50000 + 5000 + 30000.
      expect(res.combined.totalAgreed).toBe(85000);
      expect(res.combined.totalPaid).toBe(62000);
      expect(res.combined.totalPending).toBe(23000);
    });

    it('queries both building-level leases and leases on units inside the building, excluding soft-deleted ones', async () => {
      mockPrisma.leaseObligation.findMany.mockResolvedValue([]);
      await service.summaryForBuilding('b1');
      expect(mockPrisma.leaseObligation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            lease: { deletedAt: null, OR: [{ buildingId: 'b1' }, { unit: { buildingId: 'b1' } }] },
          },
        }),
      );
    });

    it('drops waived obligations from agreed totals but keeps money actually paid', async () => {
      mockPrisma.leaseObligation.findMany.mockResolvedValue([
        { ...unitDeposit, status: 'WAIVED', paidAmount: D('500') },
        unitTi,
      ]);
      const res = await service.summaryForBuilding('b1');
      expect(res.unitLevel.totalAgreed).toBe(30000); // 5000 waived deposit excluded
      expect(res.unitLevel.totalPaid).toBe(10500); // the 500 already collected still counts
    });

    it('sums Decimal cents correctly across obligations', async () => {
      mockPrisma.leaseObligation.findMany.mockResolvedValue([
        { ...unitDeposit, totalAmount: D('1000.50'), paidAmount: D('0.25'), status: 'PARTIAL' },
        { ...unitTi, totalAmount: D('1500.25'), paidAmount: D('0.50'), status: 'PARTIAL' },
      ]);
      const res = await service.summaryForBuilding('b1');
      expect(res.unitLevel.totalAgreed).toBe(2500.75);
      expect(res.unitLevel.totalPaid).toBe(0.75);
      expect(res.unitLevel.totalPending).toBe(2500);
    });
  });

  describe('findByLease', () => {
    it('returns obligations with payments, newest payment first', async () => {
      mockPrisma.leaseObligation.findMany.mockResolvedValue([]);
      await service.findByLease('l1');
      expect(mockPrisma.leaseObligation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { leaseId: 'l1' },
          include: expect.objectContaining({
            payments: expect.objectContaining({ orderBy: { paidAt: 'desc' } }),
          }),
        }),
      );
    });
  });
});

// Reported from the UI: a $100 TI allowance showing "$4,500 paid — Overpaid — $4,400
// refund due". `paidAmount` mirrors the payment rows, so a mis-keyed amount used to be
// accepted in silence and simply flipped the panel to a refund. Nothing distinguished a
// typo from a real credit.
describe('LeaseObligationService.recordPayment — overpayment guard', () => {
  let service: LeaseObligationService;

  const obligation = {
    id: 'ob1', leaseId: 'l1', kind: 'TI_ALLOWANCE', direction: 'TO_TENANT',
    totalAmount: new Prisma.Decimal(100), paidAmount: new Prisma.Decimal(60),
    status: 'PARTIAL',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.leaseObligation.findUnique.mockResolvedValue(obligation);
    mockPrisma.leaseObligationPayment.create.mockImplementation((a: any) => Promise.resolve(a.data));
    mockPrisma.leaseObligationPayment.findMany.mockResolvedValue([]);
    mockPrisma.leaseObligation.update.mockResolvedValue({ ...obligation, paidAmount: new Prisma.Decimal(60) });
  });

  it('refuses a payment that exceeds the agreed total', async () => {
    await expect(service.recordPayment('ob1', { amount: 4500 })).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.leaseObligationPayment.create).not.toHaveBeenCalled();
  });

  it('names the overshoot so the number can be checked against the paperwork', async () => {
    await expect(service.recordPayment('ob1', { amount: 4500 })).rejects.toThrow(/4460\.00 more than is owed/);
  });

  it('allows a payment that exactly settles the obligation', async () => {
    await expect(service.recordPayment('ob1', { amount: 40 })).resolves.toBeDefined();
  });

  it('allows a payment that leaves a balance outstanding', async () => {
    await expect(service.recordPayment('ob1', { amount: 10 })).resolves.toBeDefined();
  });

  it('records an overpayment when it is explicitly confirmed', async () => {
    // Genuine overpayments happen — a deposit topped up mid-term, a tenant rounding up.
    // The guard makes them deliberate, it does not make them impossible.
    await expect(
      service.recordPayment('ob1', { amount: 4500, allowOverpayment: true }),
    ).resolves.toBeDefined();
    expect(mockPrisma.leaseObligationPayment.create).toHaveBeenCalled();
  });
});
