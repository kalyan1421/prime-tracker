/**
 * Who sees which button on a backfilled record (R27, generalized to sales by R6).
 *
 * This is permission branching, which is the kind of logic that breaks silently: nothing
 * throws when the wrong person is shown a delete button, and nothing throws when the
 * right person is shown nothing at all. The API refuses either way — but a UI that offers
 * an action the server will reject, or hides one the user is entitled to, is a bug on its
 * own terms.
 *
 * The three roles under test, run against BOTH a lease and a sale record — the whole
 * point of R6 is that the two behave identically:
 *   Sales (backfill only)  → may ASK, never decide
 *   Founder (both)         → deletes directly, recorded as self-approved
 *   the requester          → cannot approve their own, but may withdraw it
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HistoricalRecordControls, type HistoricalRecord } from './HistoricalRecordControls';

const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });

const hooks = {
  pending: [] as any[],
  approved: [] as any[],
};

vi.mock('../hooks/useApi', () => ({
  useRequestHistoricalDeletion: () => mutation(),
  useRequestSaleHistoricalDeletion: () => mutation(),
  useDecideHistoricalDeletion: () => mutation(),
  useCancelHistoricalDeletion: () => mutation(),
  useDeleteLease: () => mutation(),
  useDeleteSale: () => mutation(),
  useHistoricalDeletionRequests: (status: string) => ({
    data: status === 'PENDING' ? hooks.pending : hooks.approved,
  }),
}));

const auth = { userId: 'user-1', permissions: [] as string[] };

vi.mock('../store/authStore', () => ({
  useAuthStore: () => ({
    user: { id: auth.userId },
    hasPermission: (p: string) => auth.permissions.includes(p),
  }),
}));

const LEASE_RECORD: HistoricalRecord = {
  kind: 'lease', id: 'l1', label: 'Old Tenant', dateRangeLabel: 'Jan 1, 2019 – Dec 31, 2019',
};
const SALE_RECORD: HistoricalRecord = {
  kind: 'sale', id: 's1', label: 'Old Buyer', dateRangeLabel: 'Closed Mar 15, 2021',
};

beforeEach(() => {
  hooks.pending = [];
  hooks.approved = [];
  auth.userId = 'user-1';
  auth.permissions = [];
});

describe.each([
  ['lease', LEASE_RECORD, 'leaseId'],
  ['sale', SALE_RECORD, 'saleId'],
] as const)('HistoricalRecordControls — what each role is offered (%s)', (_kind, record, idField) => {
  it('always explains why this record is different', () => {
    render(<HistoricalRecordControls record={record} />);
    expect(screen.getByText(/Entered from records/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be rebuilt/)).toBeInTheDocument();
  });

  it('offers Sales a request, never a delete', () => {
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls record={record} />);

    expect(screen.getByRole('button', { name: /Request deletion/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete record$/ })).toBeNull();
  });

  it('lets an approver delete directly — they ARE the second pair of eyes', () => {
    auth.permissions = ['unit:history:backfill', 'unit:history:delete'];
    render(<HistoricalRecordControls record={record} />);

    expect(screen.getByRole('button', { name: /Delete record/ })).toBeInTheDocument();
    // No point asking themselves for permission.
    expect(screen.queryByRole('button', { name: /Request deletion/ })).toBeNull();
  });

  it('offers a user with neither permission nothing to click', () => {
    render(<HistoricalRecordControls record={record} />);
    expect(screen.queryByRole('button', { name: /Delete|Request/ })).toBeNull();
  });

  it('shows a pending request raised against this record, keyed by the right id field', () => {
    hooks.pending = [{
      id: 'r1', [idField]: record.id, reason: 'Duplicate of the 2019 paper record',
      requestedAt: '2026-08-13', requestedById: 'user-2', requestedBy: { name: 'Sam Sales' },
    }];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls record={record} />);

    expect(screen.getByText(/Duplicate of the 2019 paper record/)).toBeInTheDocument();
    expect(screen.getByText(/Sam Sales/)).toBeInTheDocument();
  });

  it('ignores a pending request that belongs to a different record', () => {
    hooks.pending = [{ id: 'r1', [idField]: 'some-other-id', requestedById: 'user-2' }];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls record={record} />);

    expect(screen.getByRole('button', { name: /Request deletion/ })).toBeInTheDocument();
  });
});

describe('HistoricalRecordControls — a request is pending (lease)', () => {
  const PENDING = {
    id: 'r1',
    leaseId: 'l1',
    reason: 'Duplicate of the 2019 paper record',
    requestedAt: '2026-08-13',
    requestedById: 'user-2',
    requestedBy: { name: 'Sam Sales' },
  };

  it('gives an approver the decision, and hides the request button', () => {
    hooks.pending = [PENDING];
    auth.permissions = ['unit:history:backfill', 'unit:history:delete'];
    render(<HistoricalRecordControls record={LEASE_RECORD} />);

    expect(screen.getByRole('button', { name: /Approve deletion/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Reject$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request deletion/ })).toBeNull();
  });

  it('refuses to let the requester approve their own, even holding the permission', () => {
    hooks.pending = [{ ...PENDING, requestedById: 'user-1' }];
    auth.permissions = ['unit:history:backfill', 'unit:history:delete'];
    render(<HistoricalRecordControls record={LEASE_RECORD} />);

    expect(screen.queryByRole('button', { name: /Approve deletion/ })).toBeNull();
    expect(screen.getByText(/somebody else has to approve it/)).toBeInTheDocument();
  });

  it('lets the requester withdraw their own', () => {
    hooks.pending = [{ ...PENDING, requestedById: 'user-1' }];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls record={LEASE_RECORD} />);

    expect(screen.getByRole('button', { name: /Withdraw request/ })).toBeInTheDocument();
  });

  it('does not let one person withdraw another\'s', () => {
    hooks.pending = [PENDING];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls record={LEASE_RECORD} />);

    expect(screen.queryByRole('button', { name: /Withdraw request/ })).toBeNull();
    expect(screen.getByText(/Waiting on a Founder/)).toBeInTheDocument();
  });
});

describe('HistoricalRecordControls — approved and waiting', () => {
  it('makes the delete a separate, deliberate second act (lease)', () => {
    hooks.approved = [{
      id: 'r1', leaseId: 'l1', reason: 'Duplicate',
      decidedAt: '2026-08-14', decidedBy: { name: 'Fran Founder' }, decisionNote: 'Confirmed with Finance',
    }];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls record={LEASE_RECORD} />);

    expect(screen.getByRole('button', { name: /Delete now/ })).toBeInTheDocument();
    expect(screen.getByText(/Fran Founder/)).toBeInTheDocument();
    expect(screen.getByText(/Confirmed with Finance/)).toBeInTheDocument();
  });

  it('makes the delete a separate, deliberate second act (sale)', () => {
    hooks.approved = [{
      id: 'r1', saleId: 's1', reason: 'Duplicate',
      decidedAt: '2026-08-14', decidedBy: { name: 'Fran Founder' }, decisionNote: 'Confirmed with Finance',
    }];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls record={SALE_RECORD} />);

    expect(screen.getByRole('button', { name: /Delete now/ })).toBeInTheDocument();
  });
});
