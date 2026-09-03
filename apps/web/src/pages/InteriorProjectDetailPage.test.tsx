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
  useAddInteriorScope: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteInteriorScope: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

beforeEach(() => {
  advances.length = 0;
  state.project = project();
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
