/**
 * What the fit-out forms actually SEND.
 *
 * This is the shape of bug that ships: the request succeeds, the toast says "updated", and
 * the number on screen is wrong. The API honours an explicit `contractValue` over the one
 * it derives from rate x area — deliberately, so a negotiated total can override the
 * arithmetic — which makes it the caller's job never to send a value it did not mean. This
 * form prefills `contractValue` from the stored record, so re-sending it pinned a PER_SQFT
 * fit-out's total at its old figure forever: changing the rate from 100 to 200 left the
 * contract sitting at 1,000 instead of 2,000, silently, on every edit.
 *
 * FIXED and COST_PLUS have no formula — their value is typed in by hand (client,
 * 2026-09-01) — so for those the field MUST be sent. Both directions are asserted, because
 * "never send it" would break cost-plus just as quietly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InteriorPanel } from './InteriorPanel';

const created: any[] = [];
const updated: any[] = [];
const state = {
  projects: [] as any[],
  permissions: ['interior:view', 'interior:edit'],
  lastQuery: {} as Record<string, unknown> | undefined,
};

vi.mock('../hooks/useApi', () => ({
  useInteriorProjects: (params?: any) => {
    state.lastQuery = params;
    return { data: state.projects, isLoading: false };
  },
  useCreateInterior: () => ({
    mutateAsync: (payload: any) => { created.push(payload); return Promise.resolve({ id: 'ip-new' }); },
    isPending: false,
  }),
  useUpdateInterior: () => ({
    mutateAsync: (payload: any) => { updated.push(payload); return Promise.resolve({}); },
    isPending: false,
  }),
  useAdvanceInteriorPhase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApproveInterior: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useInteriorTemplates: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  useAssignableUsers: () => ({ data: [{ id: 'u1', name: 'Demo PM' }] }),
}) as any);

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector?: any) => {
    const store = { hasPermission: (p: string) => state.permissions.includes(p) };
    return selector ? selector(store) : store;
  },
}));

function project(overrides: Record<string, any> = {}) {
  return {
    id: 'ip1',
    name: 'Unit 101 fit-out',
    status: 'IN_PROGRESS',
    phase: 'DESIGN',
    contractType: 'PER_SQFT',
    ratePerSqft: 100,
    area: 10,
    contractValue: 1000,
    pm: null,
    ...overrides,
  };
}

function renderPanel(props: Record<string, any> = {}) {
  return render(
    <MemoryRouter>
      <InteriorPanel unitId="u-101" unitNumber="101" unitSqft={1200} {...props} />
    </MemoryRouter>,
  );
}

/** Opens the inline edit form on the first fit-out card and saves it unchanged. */
async function editAndSave() {
  fireEvent.click(screen.getByLabelText('Edit fit-out'));
  await screen.findByText('Edit fit-out');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(updated.length).toBe(1));
  return updated[0].data;
}

beforeEach(() => {
  created.length = 0;
  updated.length = 0;
  state.projects = [];
  state.permissions = ['interior:view', 'interior:edit'];
  state.lastQuery = undefined;
});

describe('InteriorPanel — contract value is only sent when it is not derived', () => {
  it('omits contractValue when editing a PER_SQFT fit-out, so the API re-derives it', async () => {
    state.projects = [project({ contractType: 'PER_SQFT' })];
    renderPanel();
    const data = await editAndSave();

    expect(data.contractValue).toBeUndefined();
    // The inputs the API needs to derive from are still sent.
    expect(data.ratePerSqft).toBe(100);
    expect(data.area).toBe(10);
  });

  it('sends contractValue when editing a FIXED fit-out — nothing else can supply it', async () => {
    state.projects = [project({ contractType: 'FIXED', contractValue: 55000 })];
    renderPanel();
    expect((await editAndSave()).contractValue).toBe(55000);
  });

  it('sends contractValue when editing a COST_PLUS fit-out', async () => {
    state.projects = [project({ contractType: 'COST_PLUS', contractValue: 72500 })];
    renderPanel();
    expect((await editAndSave()).contractValue).toBe(72500);
  });

  it('shows a manual contract-value field for COST_PLUS but not for PER_SQFT', async () => {
    state.projects = [project({ contractType: 'COST_PLUS', contractValue: 72500 })];
    const { unmount } = renderPanel();
    fireEvent.click(screen.getByLabelText('Edit fit-out'));
    expect(await screen.findByLabelText(/cost plus/i)).toBeTruthy();
    unmount();

    state.projects = [project({ contractType: 'PER_SQFT' })];
    renderPanel();
    fireEvent.click(screen.getByLabelText('Edit fit-out'));
    await screen.findByText('Edit fit-out');
    expect(screen.queryByLabelText(/contract value/i)).toBeNull();
  });

  it('omits contractValue on create, where the default contract type is PER_SQFT', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Start fit-out/ }));
    await screen.findByText('Start interior fit-out');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(created.length).toBe(1));

    expect(created[0].contractValue).toBeUndefined();
    expect(created[0].contractType).toBe('PER_SQFT');
  });
});

describe('InteriorPanel — anchors', () => {
  it('queries and creates against the unit when given a unitId', async () => {
    renderPanel();
    expect(state.lastQuery).toEqual({ unitId: 'u-101' });

    fireEvent.click(screen.getByRole('button', { name: /Start fit-out/ }));
    await screen.findByText('Start interior fit-out');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(created.length).toBe(1));

    expect(created[0].unitId).toBe('u-101');
    expect(created[0].buildingId).toBeUndefined();
  });

  /**
   * InteriorProject is anchored to a unit XOR a building and the API rejects both or
   * neither, so the building path must never leak a unitId in alongside.
   */
  it('queries and creates against the building when given a buildingId', async () => {
    render(
      <MemoryRouter>
        <InteriorPanel buildingId="b-1" buildingName="Building One" />
      </MemoryRouter>,
    );
    expect(state.lastQuery).toEqual({ buildingId: 'b-1' });

    fireEvent.click(screen.getByRole('button', { name: /Start fit-out/ }));
    await screen.findByText('Start interior fit-out');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(created.length).toBe(1));

    expect(created[0].buildingId).toBe('b-1');
    expect(created[0].unitId).toBeUndefined();
    expect(created[0].name).toBe('Building One fit-out');
  });
});

describe('InteriorPanel — handover has one entry point', () => {
  /**
   * Handover is the only transition that captures a client sign-off, and — when punch-list
   * items are still open — a written reason for proceeding. That form lives in the full
   * workspace. This card used to fire a plain advance instead, handing over with no
   * sign-off recorded at all.
   */
  it('links to the workspace instead of advancing straight into HANDOVER', () => {
    state.projects = [project({ phase: 'SNAGGING' })];
    renderPanel();
    const link = screen.getByRole('link', { name: /Complete handover/ });
    expect(link.getAttribute('href')).toBe('/interior/ip1');
  });

  it('still advances inline for every other phase', () => {
    state.projects = [project({ phase: 'DESIGN' })];
    renderPanel();
    expect(screen.getByRole('button', { name: /Advance to Client Approval/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Complete handover/ })).toBeNull();
  });
});
