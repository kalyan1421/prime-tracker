import { UnitStatus } from '@prisma/client';
import {
  buildOccupancyWindows,
  summariseWindows,
  classifyStatus,
  daysBetween,
  rentEntriesForLease,
  successionGaps,
  tenancyEndEntries,
  assignmentEntries,
  activeLeaseCoversNow,
} from './unit-history.service';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** An event as the log stores it. recordedAt defaults to effectiveAt (a live event). */
function ev(toStatus: UnitStatus, effective: string, recorded?: string) {
  return {
    toStatus,
    effectiveAt: d(effective),
    recordedAt: d(recorded ?? effective),
  };
}

describe('classifyStatus', () => {
  it('collapses the seven unit statuses into what the unit was doing', () => {
    expect(classifyStatus('AVAILABLE')).toBe('VACANT');
    expect(classifyStatus('LEASED')).toBe('LEASED');
    // OCCUPIED is a tenant in the space just as LEASED is — both count as earning.
    expect(classifyStatus('OCCUPIED')).toBe('LEASED');
    expect(classifyStatus('SOLD')).toBe('SOLD');
    expect(classifyStatus('UNDER_CONTRACT')).toBe('RESERVED');
    expect(classifyStatus('LEASE_PENDING')).toBe('RESERVED');
    expect(classifyStatus('UNDER_CONSTRUCTION')).toBe('CONSTRUCTION');
  });
});

describe('buildOccupancyWindows', () => {
  const now = d('2026-08-12');

  it('turns a chain of events into contiguous windows', () => {
    const windows = buildOccupancyWindows(
      [ev('AVAILABLE', '2024-01-01'), ev('LEASED', '2024-04-01'), ev('AVAILABLE', '2025-04-01')],
      now,
    );

    expect(windows).toHaveLength(3);
    expect(windows[0]).toMatchObject({ kind: 'VACANT', start: d('2024-01-01'), end: d('2024-04-01'), isOngoing: false });
    expect(windows[1]).toMatchObject({ kind: 'LEASED', start: d('2024-04-01'), end: d('2025-04-01') });
    // The trailing window is open and measured against `now`.
    expect(windows[2]).toMatchObject({ kind: 'VACANT', end: null, isOngoing: true });
  });

  it('measures the OPEN window against now, which is the vacancy nobody could see before', () => {
    const windows = buildOccupancyWindows([ev('AVAILABLE', '2026-07-13')], now);
    expect(windows[0].isOngoing).toBe(true);
    expect(windows[0].durationDays).toBe(30);
  });

  it('captures the vacancy BEFORE the first lease', () => {
    // The old client-side derivation measured gaps BETWEEN two ended leases, so a
    // unit's initial lease-up period was invisible no matter how long it ran.
    const windows = buildOccupancyWindows(
      [ev('AVAILABLE', '2024-01-01'), ev('LEASED', '2024-07-01')],
      now,
    );
    expect(windows[0]).toMatchObject({ kind: 'VACANT', durationDays: 182 });
  });

  it('orders by real-world date, not write order, so backfilled history slots in', () => {
    // A 2024 tenancy entered today must sort before a 2025 one entered last year.
    const windows = buildOccupancyWindows(
      [
        ev('LEASED', '2025-01-01', '2025-01-01'),
        ev('AVAILABLE', '2024-01-01', '2026-08-12'), // backfilled long after the fact
      ],
      now,
    );
    expect(windows.map((w) => w.kind)).toEqual(['VACANT', 'LEASED']);
    expect(windows[0].start).toEqual(d('2024-01-01'));
  });

  it('lets the last-RECORDED event win when two share an effective date', () => {
    // Same-instant events mean the earlier one describes a state the unit was never
    // actually in, so it collapses to zero length and drops out. What survives is the
    // state it ended up in — decided by recordedAt, since effectiveAt cannot separate
    // them. Reversing the write order must reverse the survivor.
    const forwards = buildOccupancyWindows(
      [
        ev('UNDER_CONTRACT', '2025-01-01', '2025-01-01'),
        ev('LEASED', '2025-01-01', '2025-01-02'),
      ],
      now,
    );
    expect(forwards.map((w) => w.kind)).toEqual(['LEASED']);

    const backwards = buildOccupancyWindows(
      [
        ev('UNDER_CONTRACT', '2025-01-01', '2025-01-02'),
        ev('LEASED', '2025-01-01', '2025-01-01'),
      ],
      now,
    );
    expect(backwards.map((w) => w.kind)).toEqual(['RESERVED']);
  });

  it('drops zero-length windows from a same-instant double flip', () => {
    // A correction or a rapid re-flip leaves a window the unit spent no time in.
    const windows = buildOccupancyWindows(
      [
        ev('AVAILABLE', '2025-01-01', '2025-01-01'),
        ev('UNDER_CONTRACT', '2025-01-01', '2025-01-02'),
        ev('LEASED', '2025-06-01'),
      ],
      now,
    );
    expect(windows.map((w) => w.kind)).toEqual(['RESERVED', 'LEASED']);
  });

  it('never produces a negative duration from a future-dated event', () => {
    const windows = buildOccupancyWindows([ev('AVAILABLE', '2027-01-01')], now);
    expect(windows[0].durationDays).toBe(0);
  });

  it('returns nothing for a unit with no events', () => {
    expect(buildOccupancyWindows([], now)).toEqual([]);
  });
});

describe('summariseWindows', () => {
  const now = d('2026-08-12');

  it('totals days by what the unit was doing, across its whole life', () => {
    const s = summariseWindows(
      buildOccupancyWindows(
        [
          ev('AVAILABLE', '2024-01-01'), // 91 days vacant
          ev('LEASED', '2024-04-01'),    // 365 days leased
          ev('AVAILABLE', '2025-04-01'), // 61 days vacant
          ev('SOLD', '2025-06-01'),      // sold since
        ],
        now,
      ),
    );

    expect(s.totalDaysVacant).toBe(91 + 61);
    expect(s.totalDaysLeased).toBe(365);
    expect(s.totalDaysSold).toBe(daysBetween(d('2025-06-01'), now));
    // Sold, not sitting on the market — so no open vacancy.
    expect(s.isCurrentlyVacant).toBe(false);
    expect(s.currentVacancyDays).toBe(0);
    expect(s.vacantSince).toBeNull();
  });

  it('reports the open vacancy when the unit is on the market now', () => {
    const s = summariseWindows(
      buildOccupancyWindows([ev('LEASED', '2024-01-01'), ev('AVAILABLE', '2026-06-13')], now),
    );
    expect(s.isCurrentlyVacant).toBe(true);
    expect(s.currentVacancyDays).toBe(60);
    expect(s.vacantSince).toEqual(d('2026-06-13'));
  });

  it('counts a re-let unit\'s earlier vacancy even though availableSince was wiped', () => {
    // The whole point of the log: the flip to LEASED nulls availableSince, so this
    // 91-day vacancy is unrecoverable from the units table alone.
    const s = summariseWindows(
      buildOccupancyWindows([ev('AVAILABLE', '2024-01-01'), ev('LEASED', '2024-04-01')], now),
    );
    expect(s.totalDaysVacant).toBe(91);
    expect(s.isCurrentlyVacant).toBe(false);
  });

  it('is all zeroes for a unit with no history', () => {
    const s = summariseWindows([]);
    expect(s).toMatchObject({
      totalDaysVacant: 0, totalDaysLeased: 0, totalDaysSold: 0,
      currentVacancyDays: 0, isCurrentlyVacant: false, vacantSince: null,
    });
  });
});

describe('rentEntriesForLease', () => {
  const lease = { id: 'l1', tenantName: 'Acme Holdings LLC', tenantBrand: 'Cream Stone' };

  /** A paying period. */
  const period = (
    seq: number, start: string, monthly: number,
    source = 'AUTO_ESCALATION', extra: Record<string, any> = {},
  ) => ({
    id: `p${seq}`, sequence: seq, startDate: d(start), endDate: null,
    baseRent: monthly, nnnAmount: 0, monthlyRent: monthly,
    isFreeRent: false, escalationPct: null, source, reason: null, createdBy: null,
    ...extra,
  });

  const free = (seq: number, start: string, end: string) => ({
    id: `p${seq}`, sequence: seq, startDate: d(start), endDate: d(end),
    baseRent: 0, nnnAmount: 0, monthlyRent: 0,
    isFreeRent: true, escalationPct: null, source: 'FREE_RENT', reason: null, createdBy: null,
  });

  it('does not treat the lease starting as a rent change', () => {
    // The lease entry already states the opening rent; an INITIAL period entry here
    // would double up every tenancy on the timeline.
    const out = rentEntriesForLease(lease, [period(1, '2024-01-01', 10000, 'INITIAL')]);
    expect(out).toEqual([]);
  });

  it('emits an escalation with both ends of the move', () => {
    const out = rentEntriesForLease(lease, [
      period(1, '2024-01-01', 10000, 'INITIAL'),
      period(2, '2025-01-01', 10300, 'AUTO_ESCALATION', { escalationPct: 3 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'rent_change', startDate: d('2025-01-01') });
    expect(out[0].data).toMatchObject({ from: 10000, to: 10300, delta: 300, isScheduled: true, escalationPct: 3 });
    expect(out[0].title).toContain('Cream Stone');
  });

  it('marks a negotiated change as unscheduled and carries its reason', () => {
    const out = rentEntriesForLease(lease, [
      period(1, '2024-01-01', 10000, 'INITIAL'),
      period(2, '2024-07-01', 9000, 'MANUAL', { reason: 'Covid concession' }),
    ]);
    expect(out[0].data).toMatchObject({ from: 10000, to: 9000, delta: -1000, isScheduled: false, reason: 'Covid concession' });
  });

  it('values an abatement that starts on day one, where nothing precedes it', () => {
    // Free months at the START of a lease are the commonest arrangement, and there is
    // no earlier paying period to value them against. Found by the QA fixture pass
    // (B-DELTA/H-06), which rendered the concession's worth as blank.
    const out = rentEntriesForLease({ ...lease, monthlyRent: 6000 }, [
      free(1, '2026-01-01', '2026-02-28'),
      period(2, '2026-03-01', 6000, 'INITIAL'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('free_rent');
    // Valued from the period that FOLLOWS it — the rent that would have been charged.
    expect(out[0].data.forgoneMonthlyRent).toBe(6000);
    expect(out[0].data.forgoneTotal).toBeGreaterThan(11000);
  });

  it('falls back to the headline rent when an abatement has no paying period either side', () => {
    const out = rentEntriesForLease({ ...lease, monthlyRent: 4321 }, [
      free(1, '2026-01-01', '2026-03-31'),
    ]);
    expect(out[0].data.forgoneMonthlyRent).toBe(4321);
  });

  it('renders free rent as ONE abatement entry, not a drop to zero and back', () => {
    // Naive consecutive-period diffing yields "$10,000 -> $0" then "$0 -> $10,000",
    // which is two fake rent changes around every abatement.
    const out = rentEntriesForLease(lease, [
      period(1, '2024-01-01', 10000, 'INITIAL'),
      free(2, '2024-04-01', '2024-06-30'),
      period(3, '2024-07-01', 10000),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'free_rent', startDate: d('2024-04-01'), endDate: d('2024-06-30') });
    // The concession is worth stating in money, not just as a gap.
    expect(out[0].data.forgoneMonthlyRent).toBe(10000);
  });

  it('still reports a real escalation that lands right after free rent', () => {
    const out = rentEntriesForLease(lease, [
      period(1, '2024-01-01', 10000, 'INITIAL'),
      free(2, '2024-04-01', '2024-06-30'),
      period(3, '2024-07-01', 11000),
    ]);
    expect(out.map((e) => e.kind)).toEqual(['free_rent', 'rent_change']);
    // Measured from the last PAYING rent, never from the abated 0.
    expect(out[1].data).toMatchObject({ from: 10000, to: 11000 });
  });

  it('reads as one continuous story across several escalations', () => {
    const out = rentEntriesForLease(lease, [
      period(1, '2024-01-01', 10000, 'INITIAL'),
      period(2, '2025-01-01', 10300),
      period(3, '2026-01-01', 10609),
    ]);
    expect(out.map((e) => [e.data.from, e.data.to])).toEqual([
      [10000, 10300],
      [10300, 10609],
    ]);
  });

  it('orders by real-world start date, not by sequence number', () => {
    // Sequence is assigned at generation time; a regenerated schedule can renumber.
    const out = rentEntriesForLease(lease, [
      period(3, '2025-01-01', 10300),
      period(1, '2024-01-01', 10000, 'INITIAL'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].data).toMatchObject({ from: 10000, to: 10300 });
  });

  it('falls back to the legal name when the lease has no brand', () => {
    const out = rentEntriesForLease(
      { id: 'l2', tenantName: 'Acme Holdings LLC', tenantBrand: null },
      [period(1, '2024-01-01', 10000, 'INITIAL'), period(2, '2025-01-01', 10300)],
    );
    expect(out[0].title).toContain('Acme Holdings LLC');
  });

  it('has nothing to say about a lease with no schedule', () => {
    expect(rentEntriesForLease(lease, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tenancy transitions on the timeline (T1.4)
// ---------------------------------------------------------------------------

const lease = (over: Record<string, any> = {}) => ({
  id: 'l1',
  tenantName: 'Patel Ventures LLC',
  tenantBrand: 'The Coffee House',
  leaseStart: d('2025-01-01'),
  leaseEnd: d('2030-01-01'),
  monthlyRent: 8500,
  terminationDate: null,
  terminationReason: null,
  terminationNote: null,
  successorLeaseId: null,
  ...over,
});

describe('tenancyEndEntries', () => {
  it('emits nothing for a tenancy that has not ended', () => {
    expect(tenancyEndEntries([lease()])).toHaveLength(0);
  });

  it('measures how early the tenant left against the CONTRACTED end', () => {
    // The lease entry spans to 2030; this says they went in 2026. The disagreement
    // between the two is the early-termination exposure, and it is the whole reason
    // terminationDate is a separate column from leaseEnd.
    const [e] = tenancyEndEntries([
      lease({ terminationDate: d('2026-06-30'), terminationReason: 'EARLY_TERMINATION' }),
    ]);

    expect(e.kind).toBe('tenancy_end');
    expect(e.startDate).toEqual(d('2026-06-30'));
    expect(e.title).toBe('Ended early — The Coffee House');
    expect(e.data.daysEarly).toBe(daysBetween(d('2026-06-30'), d('2030-01-01')));
    expect(e.data.daysHeldOver).toBe(0);
  });

  it('reports holdover when the tenant stayed PAST the contracted end', () => {
    // Not an error state — holdover is normal and has to be recordable, which is why
    // the DB CHECK deliberately has no upper bound on terminationDate.
    const [e] = tenancyEndEntries([
      lease({ terminationDate: d('2030-04-01'), terminationReason: 'NON_RENEWAL' }),
    ]);

    expect(e.data.daysHeldOver).toBe(daysBetween(d('2030-01-01'), d('2030-04-01')));
    expect(e.data.daysEarly).toBe(0);
  });

  it('names the successor for a same-unit renewal but not for a relocation', () => {
    const renewed = lease({
      terminationDate: d('2026-06-30'), terminationReason: 'RENEWED', successorLeaseId: 'l2',
    });
    const successor = lease({ id: 'l2', tenantBrand: 'The Coffee House', leaseStart: d('2026-06-30') });

    const [withSuccessor] = tenancyEndEntries([renewed, successor]);
    expect(withSuccessor.data.continuesOnThisUnit).toBe(true);
    expect(withSuccessor.data.successorTenant).toBe('The Coffee House');

    // A relocation's successor lives on a DIFFERENT unit, so it is not in this unit's
    // lease set and cannot be named from here — but the link is still reported.
    const [relocated] = tenancyEndEntries([
      lease({ terminationDate: d('2026-06-30'), terminationReason: 'RELOCATED', successorLeaseId: 'elsewhere' }),
    ]);
    expect(relocated.data.continuesOnThisUnit).toBe(false);
    expect(relocated.data.successorLeaseId).toBe('elsewhere');
  });
});

describe('successionGaps — which vacancies are real', () => {
  it('reports a handover window for a same-unit successor', () => {
    const gaps = successionGaps([
      lease({ terminationDate: d('2026-06-30'), successorLeaseId: 'l2' }),
      lease({ id: 'l2', leaseStart: d('2026-06-30') }),
    ]);
    expect(gaps).toEqual([{ from: d('2026-06-30'), to: d('2026-06-30') }]);
  });

  it('reports NOTHING for a relocation, so the emptied unit still shows its vacancy', () => {
    // The successor is on another unit. This one really is empty, and suppressing that
    // would be the timeline telling a lie.
    expect(
      successionGaps([lease({ terminationDate: d('2026-06-30'), successorLeaseId: 'on-another-unit' })]),
    ).toEqual([]);
  });

  it('measures the gap from the MOVE-OUT date, not the contracted end', () => {
    const [gap] = successionGaps([
      lease({ terminationDate: d('2026-06-30'), successorLeaseId: 'l2' }),
      lease({ id: 'l2', leaseStart: d('2026-09-01') }),
    ]);
    // A real three-month gap between a lease and its "renewal" — reported as such so
    // the vacancy inside it is NOT suppressed.
    expect(gap).toEqual({ from: d('2026-06-30'), to: d('2026-09-01') });
  });

  it('ignores a successor dated before the predecessor ended', () => {
    // Would imply the two overlap, which the DB exclusion constraint forbids. Emitting
    // a backwards range here would suppress arbitrary vacancies.
    expect(
      successionGaps([
        lease({ terminationDate: d('2026-06-30'), successorLeaseId: 'l2' }),
        lease({ id: 'l2', leaseStart: d('2026-01-01') }),
      ]),
    ).toEqual([]);
  });
});

describe('activeLeaseCoversNow — catches a status-events log that missed a tenancy', () => {
  const now = d('2026-08-26');

  it('is true for an ACTIVE lease straddling now', () => {
    expect(activeLeaseCoversNow([lease({ status: 'ACTIVE' })], now)).toBe(true);
  });

  it('is false when no lease is ACTIVE', () => {
    expect(activeLeaseCoversNow([lease({ status: 'EXPIRED' })], now)).toBe(false);
  });

  it('is false for an ACTIVE lease that has not started yet', () => {
    expect(
      activeLeaseCoversNow([lease({ status: 'ACTIVE', leaseStart: d('2027-01-01') })], now),
    ).toBe(false);
  });

  it('is false for an ACTIVE lease whose term already ran out', () => {
    // ACTIVE + past leaseEnd is the holdover case, not a fresh tenancy — a real gap in
    // the status log around a holdover is a different problem this check should not paper over.
    expect(
      activeLeaseCoversNow([lease({ status: 'ACTIVE', leaseEnd: d('2026-01-01') })], now),
    ).toBe(false);
  });

  it('is true when a real historical import left leaseEnd null', () => {
    expect(
      activeLeaseCoversNow([lease({ status: 'ACTIVE', leaseEnd: null })], now),
    ).toBe(true);
  });
});

describe('assignmentEntries', () => {
  const assignment = {
    id: 'a1',
    leaseId: 'l1',
    effectiveDate: d('2026-06-01'),
    fromTenantName: 'Patel Ventures LLC',
    toTenantName: 'Sharma Retail LLC',
    reason: 'BUSINESS_SALE',
  };

  it('names both parties and says the terms did not move', () => {
    // "Did the rent change?" is the first question an assignment raises, so the entry
    // answers it rather than leaving the reader to compare rows.
    const [e] = assignmentEntries([assignment], [lease()]);

    expect(e.kind).toBe('assignment');
    expect(e.title).toBe('Lease assigned — Patel Ventures LLC → Sharma Retail LLC');
    expect(e.data.termUnchanged).toBe(true);
    expect(e.data.monthlyRent).toBe(8500);
  });

  it('still renders when the lease is not in the set', () => {
    const [e] = assignmentEntries([assignment], []);
    expect(e.data.monthlyRent).toBeNull();
  });

  it('links the signed agreement while it is live', () => {
    const [e] = assignmentEntries(
      [{ ...assignment, documentId: 'doc1', document: { id: 'doc1', deletedAt: null } }],
      [lease()],
    );

    expect(e.data.documentId).toBe('doc1');
    expect(e.data.documentFiled).toBe(true);
    expect(e.data.documentRemoved).toBe(false);
  });

  it('stops linking an agreement that was deleted, but still says one existed', () => {
    // Documents are soft-deleted, so the id column outlives the delete while every read in
    // DocumentsService filters the row out — the raw id was a link that 404s. Dropping the
    // fact entirely would be a different lie: "no agreement was ever filed" and "the
    // agreement was filed and later removed" are different facts about a legal transfer.
    const [e] = assignmentEntries(
      [{ ...assignment, documentId: 'doc1', document: { id: 'doc1', deletedAt: new Date('2026-07-01') } }],
      [lease()],
    );

    expect(e.data.documentId).toBeNull();
    expect(e.data.documentFiled).toBe(true);
    expect(e.data.documentRemoved).toBe(true);
  });

  it('says nothing at all when no agreement was ever attached', () => {
    const [e] = assignmentEntries([assignment], [lease()]);

    expect(e.data.documentId).toBeNull();
    expect(e.data.documentFiled).toBe(false);
    expect(e.data.documentRemoved).toBe(false);
  });
});
