/**
 * The total budget (client, 2026-11-02): asked for when a fit-out is started, a banner until
 * it exists, and the figure every estimate / PO / bill is measured against.
 *
 * What matters here is who sees what and what goes on the wire: the banner for every viewer
 * but the button only for Finance, an amount that is never sent when it is not a positive
 * number, and a budget that can be removed again with `null` (not 0 or '').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BudgetStatusChip, TotalBudgetBanner, TotalBudgetCard, SetTotalBudgetModal, isBudgetMissing, parseBudget } from './InteriorTotalBudget';

const updated: any[] = [];
const state = { permissions: ['interior:view', 'interior:edit', 'interior:finance'] };

vi.mock('../hooks/useApi', () => ({
  useUpdateInterior: () => ({
    mutateAsync: (payload: any) => { updated.push(payload); return Promise.resolve({}); },
    isPending: false,
  }),
}) as any);

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector?: any) => {
    const store = { hasPermission: (p: string) => state.permissions.includes(p) };
    return selector ? selector(store) : store;
  },
}));

beforeEach(() => {
  updated.length = 0;
  state.permissions = ['interior:view', 'interior:edit', 'interior:finance'];
});

const live = (o: Record<string, any> = {}) => ({ id: 'ip1', status: 'IN_PROGRESS', hasTotalBudget: false, ...o });

describe('isBudgetMissing / parseBudget', () => {
  it('is missing only for a live fit-out that is known to have no budget', () => {
    expect(isBudgetMissing(live())).toBe(true);
    expect(isBudgetMissing(live({ status: 'NOT_STARTED' }))).toBe(true);
    expect(isBudgetMissing(live({ hasTotalBudget: true }))).toBe(false);
    expect(isBudgetMissing(live({ status: 'COMPLETED' }))).toBe(false);
    expect(isBudgetMissing(live({ status: 'CANCELLED' }))).toBe(false);
    // An older API response without the flag must not raise a false alarm.
    expect(isBudgetMissing({ status: 'IN_PROGRESS' })).toBe(false);
  });

  it('accepts typed money and rejects everything that is not a positive amount', () => {
    expect(parseBudget('250000')).toBe(250000);
    expect(parseBudget('$1,250,000.50')).toBe(1250000.5);
    for (const bad of ['', '  ', '0', '-5', 'abc', '1e999999']) expect(parseBudget(bad)).toBeNull();
  });
});

describe('TotalBudgetBanner', () => {
  it('shows for a live fit-out with no budget, and offers Finance the button', () => {
    render(<TotalBudgetBanner project={live()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/No total budget set/);
    expect(screen.getByRole('button', { name: 'Add budget' })).toBeTruthy();
  });

  it('shows to a viewer without finance, with no button and the way forward', () => {
    state.permissions = ['interior:view', 'interior:edit'];
    render(<TotalBudgetBanner project={live()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/ask a Founder or Project Manager/i);
    expect(screen.queryByRole('button', { name: 'Add budget' })).toBeNull();
  });

  it('needs edit as well as finance — a finance-only viewer cannot PATCH the fit-out', () => {
    state.permissions = ['interior:view', 'interior:finance'];
    render(<TotalBudgetBanner project={live()} />);
    expect(screen.queryByRole('button', { name: 'Add budget' })).toBeNull();
  });

  it('renders nothing once a budget exists, or the fit-out has finished', () => {
    const a = render(<TotalBudgetBanner project={live({ hasTotalBudget: true })} />);
    expect(a.container.innerHTML).toBe('');
    a.unmount();
    const b = render(<TotalBudgetBanner project={live({ status: 'COMPLETED' })} />);
    expect(b.container.innerHTML).toBe('');
  });

  it('saves the typed amount against this fit-out', async () => {
    render(<TotalBudgetBanner project={live()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add budget' }));
    fireEvent.change(await screen.findByLabelText('Total budget ($)'), { target: { value: '$250,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await waitFor(() => expect(updated.length).toBe(1));
    expect(updated[0]).toEqual({ id: 'ip1', data: { totalBudget: 250000 } });
  });

  it('refuses zero and text, sending nothing', async () => {
    render(<TotalBudgetBanner project={live()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add budget' }));
    const input = await screen.findByLabelText('Total budget ($)');
    for (const bad of ['0', 'abc', '']) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    }
    expect((await screen.findAllByText(/greater than zero/)).length).toBeGreaterThan(0);
    expect(updated.length).toBe(0);
  });

  it('offers the contract value as a one-click fill', async () => {
    render(<TotalBudgetBanner project={live({ contractValue: '180000.00' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add budget' }));
    fireEvent.click(await screen.findByRole('button', { name: /Use the contract value, \$180,000/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await waitFor(() => expect(updated.length).toBe(1));
    expect(updated[0].data.totalBudget).toBe(180000);
  });
});

describe('SetTotalBudgetModal — changing and removing', () => {
  it('prefills the current figure and removes the budget with null, not 0', async () => {
    render(<SetTotalBudgetModal id="ip1" current={400000} isOpen onClose={() => {}} />);
    expect((await screen.findByLabelText('Total budget ($)') as HTMLInputElement).value).toBe('400000');
    fireEvent.click(screen.getByRole('button', { name: 'Remove budget' }));
    await waitFor(() => expect(updated.length).toBe(1));
    expect(updated[0]).toEqual({ id: 'ip1', data: { totalBudget: null } });
  });

  it('has no Remove button when there is nothing to remove', async () => {
    render(<SetTotalBudgetModal id="ip1" current={null} isOpen onClose={() => {}} />);
    await screen.findByLabelText('Total budget ($)');
    expect(screen.queryByRole('button', { name: 'Remove budget' })).toBeNull();
  });
});

describe('BudgetStatusChip', () => {
  it('says No budget, Over budget, or nothing', () => {
    const a = render(<BudgetStatusChip row={live()} />);
    expect(a.container.textContent).toBe('No budget');
    a.unmount();
    const b = render(<BudgetStatusChip row={live({ hasTotalBudget: true, costing: { budgetAlerts: ['COMMITTED_OVER'] } })} />);
    expect(b.container.textContent).toBe('Over budget');
    b.unmount();
    const c = render(<BudgetStatusChip row={live({ hasTotalBudget: true, costing: { budgetAlerts: [] } })} />);
    expect(c.container.textContent).toBe('');
  });
});

describe('TotalBudgetCard', () => {
  const position = (o: Record<string, any> = {}) => ({
    set: true, total: 300000, estimate: 226860, committed: 150000, pending: 10000, actual: 90000,
    unallocated: 73140, leftToCommit: 140000, leftToSpend: 210000, spentShare: 0.3, alerts: [], ...o,
  });
  const costing = (tb: any, can: Record<string, boolean> = { setTotalBudget: true }) => ({ id: 'ip1', totalBudget: tb, can });

  it('lays the total beside what the estimate, POs and bills have done to it', () => {
    render(<TotalBudgetCard costing={costing(position())} />);
    const card = screen.getByTestId('total-budget-card').textContent ?? '';
    expect(card).toContain('$300,000');
    expect(card).toContain('$73,140 unallocated');
    expect(card).toContain('$140,000 left to commit');
    expect(card).toContain('$210,000 left');
    expect(card).toContain('30% billed');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('spells out each overrun in plain words', () => {
    const tb = position({
      total: 100000, estimate: 120000, committed: 130000, actual: 105000,
      unallocated: -20000, leftToCommit: -40000, leftToSpend: -5000, spentShare: 1.05,
      alerts: ['ESTIMATE_OVER', 'COMMITTED_OVER', 'ACTUAL_OVER'],
    });
    render(<TotalBudgetCard costing={costing(tb)} />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toContain('The estimate ($120,000) is $20,000 over the total budget.');
    expect(text).toContain('Approved purchase orders ($130,000) are $30,000 over the total budget.');
    expect(text).toContain('Bills ($105,000) are $5,000 over the total budget.');
  });

  it('renders nothing while no budget is set (the banner owns that state)', () => {
    const { container } = render(<TotalBudgetCard costing={costing({ set: false, alerts: [] })} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the change button only when the server says this viewer may set it', () => {
    const a = render(<TotalBudgetCard costing={costing(position(), { setTotalBudget: true })} />);
    expect(screen.getByRole('button', { name: 'Change the total budget' })).toBeTruthy();
    a.unmount();
    render(<TotalBudgetCard costing={costing(position(), { setTotalBudget: false })} />);
    expect(screen.queryByRole('button', { name: 'Change the total budget' })).toBeNull();
  });
});
