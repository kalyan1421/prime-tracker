/**
 * Who sees which button on a backfilled tenancy (R27).
 *
 * This is permission branching, which is the kind of logic that breaks silently: nothing
 * throws when the wrong person is shown a delete button, and nothing throws when the
 * right person is shown nothing at all. The API refuses either way — but a UI that offers
 * an action the server will reject, or hides one the user is entitled to, is a bug on its
 * own terms.
 *
 * The three roles under test:
 *   Sales (backfill only)  → may ASK, never decide
 *   Founder (both)         → deletes directly, recorded as self-approved
 *   the requester          → cannot approve their own, but may withdraw it
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HistoricalRecordControls } from './HistoricalRecordControls';

const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });

const hooks = {
  pending: [] as any[],
  approved: [] as any[],
};

vi.mock('../hooks/useApi', () => ({
  useRequestHistoricalDeletion: () => mutation(),
  useDecideHistoricalDeletion: () => mutation(),
  useCancelHistoricalDeletion: () => mutation(),
  useDeleteLease: () => mutation(),
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

const LEASE = {
  id: 'l1',
  tenantName: 'Old Tenant',
  leaseStart: '2019-01-01',
  leaseEnd: '2019-12-31',
  isHistorical: true,
};

beforeEach(() => {
  hooks.pending = [];
  hooks.approved = [];
  auth.userId = 'user-1';
  auth.permissions = [];
});

describe('HistoricalRecordControls — what each role is offered', () => {
  it('always explains why this record is different', () => {
    render(<HistoricalRecordControls lease={LEASE} />);
    expect(screen.getByText(/Entered from records/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be rebuilt/)).toBeInTheDocument();
  });

  it('offers Sales a request, never a delete', () => {
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls lease={LEASE} />);

    expect(screen.getByRole('button', { name: /Request deletion/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete record$/ })).toBeNull();
  });

  it('lets an approver delete directly — they ARE the second pair of eyes', () => {
    auth.permissions = ['unit:history:backfill', 'unit:history:delete'];
    render(<HistoricalRecordControls lease={LEASE} />);

    expect(screen.getByRole('button', { name: /Delete record/ })).toBeInTheDocument();
    // No point asking themselves for permission.
    expect(screen.queryByRole('button', { name: /Request deletion/ })).toBeNull();
  });

  it('offers a user with neither permission nothing to click', () => {
    render(<HistoricalRecordControls lease={LEASE} />);
    expect(screen.queryByRole('button', { name: /Delete|Request/ })).toBeNull();
  });
});

describe('HistoricalRecordControls — a request is pending', () => {
  const PENDING = {
    id: 'r1',
    leaseId: 'l1',
    reason: 'Duplicate of the 2019 paper record',
    requestedAt: '2026-08-13',
    requestedById: 'user-2',
    requestedBy: { name: 'Sam Sales' },
  };

  it('shows the reason and who asked, to anyone who can see the record', () => {
    hooks.pending = [PENDING];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls lease={LEASE} />);

    expect(screen.getByText(/Duplicate of the 2019 paper record/)).toBeInTheDocument();
    expect(screen.getByText(/Sam Sales/)).toBeInTheDocument();
  });

  it('gives an approver the decision, and hides the request button', () => {
    hooks.pending = [PENDING];
    auth.permissions = ['unit:history:backfill', 'unit:history:delete'];
    render(<HistoricalRecordControls lease={LEASE} />);

    expect(screen.getByRole('button', { name: /Approve deletion/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Reject$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request deletion/ })).toBeNull();
  });

  it('refuses to let the requester approve their own, even holding the permission', () => {
    hooks.pending = [{ ...PENDING, requestedById: 'user-1' }];
    auth.permissions = ['unit:history:backfill', 'unit:history:delete'];
    render(<HistoricalRecordControls lease={LEASE} />);

    expect(screen.queryByRole('button', { name: /Approve deletion/ })).toBeNull();
    expect(screen.getByText(/somebody else has to approve it/)).toBeInTheDocument();
  });

  it('lets the requester withdraw their own', () => {
    hooks.pending = [{ ...PENDING, requestedById: 'user-1' }];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls lease={LEASE} />);

    expect(screen.getByRole('button', { name: /Withdraw request/ })).toBeInTheDocument();
  });

  it('does not let one person withdraw another\'s', () => {
    hooks.pending = [PENDING];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls lease={LEASE} />);

    expect(screen.queryByRole('button', { name: /Withdraw request/ })).toBeNull();
    expect(screen.getByText(/Waiting on a Founder/)).toBeInTheDocument();
  });

  it('ignores a pending request that belongs to a different lease', () => {
    hooks.pending = [{ ...PENDING, leaseId: 'some-other-lease' }];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls lease={LEASE} />);

    expect(screen.queryByText(/Duplicate of the 2019/)).toBeNull();
    expect(screen.getByRole('button', { name: /Request deletion/ })).toBeInTheDocument();
  });
});

describe('HistoricalRecordControls — approved and waiting', () => {
  const APPROVED = {
    id: 'r1',
    leaseId: 'l1',
    reason: 'Duplicate',
    decidedAt: '2026-08-14',
    decidedBy: { name: 'Fran Founder' },
    decisionNote: 'Confirmed with Finance',
  };

  it('makes the delete a separate, deliberate second act', () => {
    hooks.approved = [APPROVED];
    auth.permissions = ['unit:history:backfill'];
    render(<HistoricalRecordControls lease={LEASE} />);

    expect(screen.getByRole('button', { name: /Delete now/ })).toBeInTheDocument();
    expect(screen.getByText(/Fran Founder/)).toBeInTheDocument();
    expect(screen.getByText(/Confirmed with Finance/)).toBeInTheDocument();
  });
});
