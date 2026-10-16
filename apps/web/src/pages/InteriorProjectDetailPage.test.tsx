/**
 * The handover gate, and the escape hatch through it.
 *
 * Open punch-list items block handover. The client asked for an override (2026-08-14) for
 * the real case — an agreed handover held up by a cosmetic snag whose contractor has left
 * site — and the API implemented it fully: `force` plus a `forceReason` that gets stamped
 * onto the sign-off and captured in the audit log. The UI never sent either field, so the
 * button 409'd with no way through, and the override may as well not have existed.
 *
 * The failure mode is silent in both directions, which is why it is tested here: forgetting
 * `force` restores the dead end, and sending it without a reason turns a deliberate,
 * recorded decision into a click.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import InteriorProjectDetailPage from './InteriorProjectDetailPage';

const advances: any[] = [];
const state = {
  project: null as any,
  costing: null as any,
  permissions: ['interior:view', 'interior:edit', 'interior:approve', 'interior:finance'],
};

vi.mock('../hooks/useApi', () => ({
  useInteriorProject: () => ({ data: state.project, isLoading: false, error: null }),
  useAdvanceInteriorPhase: () => ({
    mutateAsync: (payload: any) => { advances.push(payload); return Promise.resolve({}); },
    isPending: false,
  }),
  useApproveInterior: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateInterior: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteInterior: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddInteriorInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateInteriorInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVoidInteriorInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVendors: () => ({ data: [] }),
  useUnits: () => ({ data: [] }),
  useInteriorCosting: () => ({ data: state.costing }),
  useInteriorCostCodes: () => ({ data: [] }),
  useInteriorCostingSettings: () => ({ data: undefined }),
  useSaveEstimateLine: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveEstimateLine: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEstimateAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateInteriorChangeOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDecideInteriorChangeOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateInteriorPurchaseOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInteriorPurchaseOrderAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddSnag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResolveSnag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSnag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAssignableUsers: () => ({ data: [] }),
  usePresignedUpload: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInteriorDocuments: () => ({ data: [], isLoading: false }),
  useUploadDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
}) as any);

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector?: any) => {
    const store = { hasPermission: (p: string) => state.permissions.includes(p) };
    return selector ? selector(store) : store;
  },
}));

/** STABILIZED counts as shell-complete; PRE_DEVELOPMENT does not. */
function project(overrides: Record<string, any> = {}) {
  return {
    id: 'ip1', name: 'Unit 101 fit-out', status: 'IN_PROGRESS', phase: 'SNAGGING',
    contractType: 'PER_SQFT', ratePerSqft: 100, area: 10, contractValue: 1000,
    unit: { id: 'u1', unitNumber: '101', building: { id: 'b1', name: 'B1', phase: 'STABILIZED', projectId: 'p1' } },
    building: null, pm: null, sale: null,
    scopeItems: [], invoices: [], snags: [],
    documents: [{ id: 'd1', category: 'HANDOVER_CERTIFICATE', fileName: 'cert.pdf', createdAt: '2026-08-01' }],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/interior/ip1']}>
      <Routes><Route path="/interior/:id" element={<InteriorProjectDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

const openHandover = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Complete handover/ }));
  await screen.findByRole('button', { name: /Confirm handover|Hand over with/ });
};

const ZERO = {
  original: 0, originalPrime: 0, originalTenant: 0, coApproved: 0, coPending: 0, revised: 0, revisedPrime: 0,
  revisedTenant: 0, pending: 0, committed: 0, actual: 0, paid: 0, projected: 0, toComplete: 0, overUnder: 0,
};

/** What GET /interior/:id/costing returns to a finance viewer. */
function financeCosting(overrides: Record<string, any> = {}) {
  return {
    id: 'ip1', name: 'Unit 101 fit-out', area: 1000, units: [], poPrefix: 'FIT', priority: null,
    estimateStatus: 'LOCKED', settings: { coLimit: 60000 },
    can: { seeMoney: true, markWorkComplete: true },
    estimate: { status: 'LOCKED', lines: [], total: 0 },
    budget: {
      rows: [{ ...ZERO, costCodeId: 'cc1', label: '07.05 - Plumbing Material', groupName: 'PLUMBING', groupCode: '07', sortOrder: 1, original: 1000, revised: 1000, revisedPrime: 600, revisedTenant: 400, projected: 1000, overUnder: 0 }],
      totals: { ...ZERO, original: 1000, revised: 1000, revisedPrime: 600, revisedTenant: 400, projected: 1000 },
    },
    ti: { allowance: 500, allowanceSource: 'LEASE', primePays: 600, tenantPays: 400, overAllowance: 100 },
    changeOrders: [],
    purchaseOrders: [{ id: 'po1', number: 'FIT-0001', title: 'Doors', vendor: { name: 'Bluesky' }, status: 'APPROVED', lines: [], cost: 800, billed: 0, paid: 0 }],
    bills: [], activity: [], leftByCode: {},
    ...overrides,
  };
}

/** What the same endpoint returns to CONSTRUCTION: the work on each PO, no amounts. */
function workCosting() {
  return {
    id: 'ip1', name: 'Unit 101 fit-out', area: 1000, units: [], poPrefix: 'FIT', estimateStatus: 'LOCKED',
    settings: { coLimit: 60000 }, can: { seeMoney: false, markWorkComplete: true },
    purchaseOrders: [{ id: 'po1', number: 'FIT-0001', title: 'Doors', vendor: { name: 'Bluesky' }, status: 'APPROVED', workCompletedAt: null }],
    activity: [],
  };
}

beforeEach(() => {
  advances.length = 0;
  state.project = project();
  state.costing = financeCosting();
  state.permissions = ['interior:view', 'interior:edit', 'interior:approve', 'interior:finance'];
});

describe('handover with a clear punch list', () => {
  it('sends no force flag when nothing is open', async () => {
    renderPage();
    await openHandover();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm handover' }));
    await waitFor(() => expect(advances.length).toBe(1));

    expect(advances[0].target).toBe('HANDOVER');
    expect(advances[0].force).toBeUndefined();
    expect(advances[0].forceReason).toBeUndefined();
  });
});

describe('handover with open punch-list items', () => {
  const withOpenSnags = () =>
    project({
      snags: [
        { id: 's1', description: 'Skirting gap in reception', status: 'OPEN' },
        { id: 's2', description: 'Touch-up paint by lift', status: 'IN_PROGRESS' },
        { id: 's3', description: 'Done already', status: 'RESOLVED' },
      ],
    });

  it('counts IN_PROGRESS as open — work started is not work finished', async () => {
    state.project = withOpenSnags();
    renderPage();
    await openHandover();
    expect(screen.getByText('2 punch-list items still open')).toBeTruthy();
  });

  it('names the items rather than just counting them', async () => {
    state.project = withOpenSnags();
    renderPage();
    await openHandover();
    expect(screen.getByText('Skirting gap in reception')).toBeTruthy();
    expect(screen.getByText('Touch-up paint by lift')).toBeTruthy();
    expect(screen.queryByText('Done already')).toBeNull();
  });

  it('will not submit until a reason is given', async () => {
    state.project = withOpenSnags();
    renderPage();
    await openHandover();

    const confirm = screen.getByRole('button', { name: /Hand over with 2 open items/ });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirm);
    expect(advances).toHaveLength(0);
  });

  it('sends force and the reason once one is given', async () => {
    state.project = withOpenSnags();
    renderPage();
    await openHandover();

    fireEvent.change(screen.getByLabelText(/Reason for handing over anyway/), {
      target: { value: 'Client accepted; contractor returns 12 Sep' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Hand over with 2 open items/ }));
    await waitFor(() => expect(advances.length).toBe(1));

    expect(advances[0].force).toBe(true);
    expect(advances[0].forceReason).toBe('Client accepted; contractor returns 12 Sep');
  });

  it('rejects a reason that is only whitespace', async () => {
    state.project = withOpenSnags();
    renderPage();
    await openHandover();

    fireEvent.change(screen.getByLabelText(/Reason for handing over anyway/), { target: { value: '   ' } });
    const confirm = screen.getByRole('button', { name: /Hand over with 2 open items/ });
    expect(confirm.hasAttribute('disabled')).toBe(true);
  });
});

describe('the shell gate reflects the building, not just the phase being entered', () => {
  /**
   * This banner used to appear whenever the next phase carried a shell requirement,
   * regardless of whether the shell was finished — the API did not return the anchor
   * building's phase, so the page could not tell, and warned unconditionally. It also left
   * the Advance button enabled, so the only way to discover the real answer was a 409.
   */
  it('blocks and explains when the building is not shell-complete', () => {
    state.project = project({
      phase: 'CITY_APPROVAL',
      unit: { id: 'u1', unitNumber: '101', building: { id: 'b1', name: 'B1', phase: 'PRE_DEVELOPMENT', projectId: 'p1' } },
    });
    renderPage();
    expect(screen.getByText(/requires the shell to be complete/)).toBeTruthy();
    expect(screen.getByText(/pre development/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Advance to Procurement/ }).hasAttribute('disabled')).toBe(true);
  });

  it('stays quiet and enabled when the shell is complete', () => {
    state.project = project({ phase: 'CITY_APPROVAL' }); // building is STABILIZED
    renderPage();
    expect(screen.queryByText(/requires the shell to be complete/)).toBeNull();
    expect(screen.getByRole('button', { name: /Advance to Procurement/ }).hasAttribute('disabled')).toBe(false);
  });
});

describe('anchor links', () => {
  it('links the unit to its unit page, not to the cross-project inventory list', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Unit 101' }).getAttribute('href'))
      .toBe('/projects/p1/units/u1');
  });

  it('links a building-anchored fit-out to its building', () => {
    state.project = project({
      unit: null,
      building: { id: 'b9', name: 'Tower B', phase: 'STABILIZED', projectId: 'p1' },
    });
    renderPage();
    expect(screen.getByRole('link', { name: 'Tower B' }).getAttribute('href'))
      .toBe('/projects/p1/buildings/b9');
  });
});

describe('job costing tabs', () => {
  it('gives finance the BuilderTrend set — budget, estimate, change orders, POs, bills, activity', () => {
    renderPage();
    for (const name of [/^Budget/, /^Estimate/, /^Change orders/, /^Purchase orders/, /^Bills/, /^Activity/]) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    // The budget is the first tab, so it is what opens.
    expect(screen.getByText('Job costing budget')).toBeTruthy();
  });

  it('splits what Prime pays from what the tenant pays, against the TI allowance', () => {
    renderPage();
    expect(screen.getByText('Prime pays', { selector: 'div' })).toBeTruthy();
    expect(screen.getByText('Tenant pays', { selector: 'div' })).toBeTruthy();
    expect(screen.getByText('from the lease')).toBeTruthy();
    expect(screen.getByText('$100 over')).toBeTruthy();
  });

  it('shows CONSTRUCTION the purchase orders as work only — no money tabs, no amounts', () => {
    state.permissions = ['interior:view'];
    state.costing = workCosting();
    renderPage();
    expect(screen.queryByRole('tab', { name: /^Budget/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /^Bills/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /^Purchase orders/ })).toBeTruthy();
    expect(screen.getByText('FIT-0001')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Work complete/ })).toBeTruthy();
    expect(screen.queryByText('Cost')).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});
