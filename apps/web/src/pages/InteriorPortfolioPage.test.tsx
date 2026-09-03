/**
 * Finding one fit-out in a portfolio that is not five rows long.
 *
 * The page was a flat, unfiltered, unpaginated table — fine at seed scale, useless once
 * Prime has a few dozen fit-outs across a few projects, and out of step with every other
 * list in the app. These tests cover the parts that fail quietly: a filter that matches
 * the wrong field, a summary that keeps reporting portfolio totals under a filter that
 * says otherwise, and money columns leaking to a viewer without `interior:finance`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InteriorPortfolioPage from './InteriorPortfolioPage';

const state = { rows: [] as any[], permissions: ['interior:view', 'interior:finance'] };

vi.mock('../hooks/useApi', () => ({
  useInteriorPortfolio: () => ({ data: state.rows, isLoading: false }),
  useInteriorTemplates: () => ({ data: [] }),
  useCreateInteriorTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateInteriorTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteInteriorTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}) as any);

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector?: any) => {
    const store = { hasPermission: (p: string) => state.permissions.includes(p) };
    return selector ? selector(store) : store;
  },
}));

// The search box is debounced; tests drive it through fake timers rather than sleeping.
vi.mock('../hooks/useDebounced', () => ({ useDebounced: (v: unknown) => v }));

function row(overrides: Record<string, any> = {}) {
  return {
    id: 'ip1', name: 'Unit 101 fit-out', phase: 'DESIGN', status: 'NOT_STARTED',
    unit: { id: 'u1', unitNumber: '101' }, building: null,
    pm: { id: 'pm1', name: 'Asha Rao' },
    contractValue: 1000, spend: 0, daysToHandover: 10,
    ...overrides,
  };
}

const renderPage = () =>
  render(<MemoryRouter><InteriorPortfolioPage /></MemoryRouter>);


/**
 * HeroUI's <Select> renders a trigger BUTTON plus a visually hidden native <select>, and
 * only the native one responds to a synthetic change event — clicking the button opens a
 * listbox that fireEvent cannot drive. Each filter carries a `name` so the right hidden
 * select can be found without depending on render order.
 */
function setFilter(name: string, value: string) {
  const el = document.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  if (!el) throw new Error(`no filter select named ${name}`);
  fireEvent.change(el, { target: { value } });
}

/** Names in the table body, in render order. */
function visibleNames(): string[] {
  const table = screen.queryByRole('table');
  if (!table) return [];
  return within(table).getAllByRole('row')
    .slice(1)
    .map((r) => r.querySelector('td')!.textContent!.trim());
}

beforeEach(() => {
  state.rows = [];
  state.permissions = ['interior:view', 'interior:finance'];
});

describe('InteriorPortfolioPage — search', () => {
  beforeEach(() => {
    state.rows = [
      row({ id: 'a', name: 'Unit 101 fit-out', unit: { id: 'u1', unitNumber: '101' }, pm: { id: 'p1', name: 'Asha Rao' } }),
      row({ id: 'b', name: 'Lobby refit', unit: null, building: { id: 'b1', name: 'Tower B' }, pm: { id: 'p2', name: 'Ben Cole' } }),
    ];
  });

  it('matches on the fit-out name', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search fit-outs'), { target: { value: 'lobby' } });
    expect(visibleNames()).toEqual(['Lobby refit']);
  });

  it('matches on the unit number, which is not in the name', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search fit-outs'), { target: { value: '101' } });
    expect(visibleNames()).toEqual(['Unit 101 fit-out']);
  });

  it('matches on the building name', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search fit-outs'), { target: { value: 'tower' } });
    expect(visibleNames()).toEqual(['Lobby refit']);
  });

  it('matches on the PM, so a manager can pull up their own book', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search fit-outs'), { target: { value: 'ben' } });
    expect(visibleNames()).toEqual(['Lobby refit']);
  });

  it('explains an empty result instead of looking like an empty portfolio', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search fit-outs'), { target: { value: 'zzzz' } });
    expect(screen.getByText('No fit-outs match these filters')).toBeTruthy();
    expect(screen.queryByText('No interior projects')).toBeNull();
  });
});

describe('InteriorPortfolioPage — filters', () => {
  it('filters by phase', () => {
    state.rows = [
      row({ id: 'a', name: 'Design job', phase: 'DESIGN' }),
      row({ id: 'b', name: 'Execution job', phase: 'EXECUTION' }),
    ];
    renderPage();
    setFilter('phase', 'EXECUTION');
    expect(visibleNames()).toEqual(['Execution job']);
  });

  it('filters by status', () => {
    state.rows = [
      row({ id: 'a', name: 'Live job', status: 'IN_PROGRESS' }),
      row({ id: 'b', name: 'Paused job', status: 'ON_HOLD' }),
    ];
    renderPage();
    setFilter('status', 'ON_HOLD');
    expect(visibleNames()).toEqual(['Paused job']);
  });

  it('offers only PMs that actually appear on the data', () => {
    state.rows = [
      row({ id: 'a', pm: { id: 'p1', name: 'Asha Rao' } }),
      row({ id: 'b', pm: null }),
    ];
    renderPage();
    const options = Array.from(
      document.querySelectorAll<HTMLSelectElement>('select[name="pm"]')[0].querySelectorAll('option'),
    ).map((o) => o.textContent);
    expect(options).toContain('Asha Rao');
    expect(options).not.toContain('Ben Cole');
  });

  it('can isolate fit-outs with no PM assigned', () => {
    state.rows = [
      row({ id: 'a', name: 'Has a PM', pm: { id: 'p1', name: 'Asha Rao' } }),
      row({ id: 'b', name: 'Nobody assigned', pm: null }),
    ];
    renderPage();
    setFilter('pm', 'UNASSIGNED');
    expect(visibleNames()).toEqual(['Nobody assigned']);
  });

  it('clears every filter at once', () => {
    state.rows = [row({ id: 'a', name: 'One' }), row({ id: 'b', name: 'Two', phase: 'EXECUTION' })];
    renderPage();
    setFilter('phase', 'EXECUTION');
    expect(visibleNames()).toEqual(['Two']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(visibleNames()).toHaveLength(2);
  });
});

describe('InteriorPortfolioPage — sorting', () => {
  it('puts fit-outs with no target date last, not first', () => {
    state.rows = [
      row({ id: 'a', name: 'No date', targetEnd: null }),
      row({ id: 'b', name: 'Due later', targetEnd: '2027-01-01' }),
      row({ id: 'c', name: 'Due soon', targetEnd: '2026-01-01' }),
    ];
    renderPage();
    expect(visibleNames()).toEqual(['Due soon', 'Due later', 'No date']);
  });

  it('sorts by contract value, largest first', () => {
    state.rows = [
      row({ id: 'a', name: 'Small', contractValue: 100 }),
      row({ id: 'b', name: 'Large', contractValue: 900 }),
    ];
    renderPage();
    setFilter('sort', 'contract');
    expect(visibleNames()).toEqual(['Large', 'Small']);
  });
});

describe('InteriorPortfolioPage — pagination', () => {
  it('pages a long portfolio and reports the range', async () => {
    state.rows = Array.from({ length: 30 }, (_, i) =>
      row({ id: `x${i}`, name: `Fit-out ${String(i).padStart(2, '0')}`, targetEnd: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    renderPage();
    expect(visibleNames()).toHaveLength(25);
    expect(screen.getByText('1–25 of 30 fit-outs')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(visibleNames()).toHaveLength(5));
  });

  it('returns to page 1 when a filter changes, so the view is never sliced past its end', async () => {
    state.rows = Array.from({ length: 30 }, (_, i) =>
      row({ id: `x${i}`, name: `Fit-out ${i}`, phase: i === 0 ? 'EXECUTION' : 'DESIGN' }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(visibleNames()).toHaveLength(5));

    setFilter('phase', 'EXECUTION');
    await waitFor(() => expect(visibleNames()).toEqual(['Fit-out 0']));
  });
});

describe('InteriorPortfolioPage — money is gated', () => {
  /** Matches visible text, ignoring the options inside HeroUI's hidden native selects. */
  const onScreen = (text: string) =>
    screen.queryAllByText(text).filter((el) => el.tagName !== 'OPTION');

  /** Column headers only — the sort dropdown also contains the words "Contract value". */
  const headers = () =>
    within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent!.trim());

  it('hides the contract and spend columns without interior:finance', () => {
    state.permissions = ['interior:view'];
    state.rows = [row()];
    renderPage();
    expect(headers()).not.toContain('Contract');
    expect(headers()).not.toContain('Spend');
    // ...and no money reaches the summary strip either. HeroUI keeps a hidden native
    // <select> for each filter, and "Contract value" is also a SORT option label — so
    // options are excluded rather than matched by text alone.
    expect(onScreen('Contract value')).toHaveLength(0);
    expect(onScreen('Spend to date')).toHaveLength(0);
  });

  it('shows them with it', () => {
    state.rows = [row()];
    renderPage();
    expect(headers()).toContain('Contract');
    expect(headers()).toContain('Spend');
  });

  /**
   * Totals follow the filter. Filtering to one PM to read their contract book is the main
   * reason to filter at all, and a summary that ignored it would contradict the rows
   * directly beneath it.
   */
  it('sums the filtered set, not the whole portfolio', () => {
    state.rows = [
      row({ id: 'a', contractValue: 1000, pm: { id: 'p1', name: 'Asha Rao' } }),
      row({ id: 'b', contractValue: 9000, pm: { id: 'p2', name: 'Ben Cole' } }),
    ];
    renderPage();
    setFilter('pm', 'p1');
    // Asha's book is 1,000. The portfolio is 10,000 and must appear nowhere — not in the
    // summary strip, and not (since her row is the only one left) in the table.
    expect(screen.getAllByText('$1,000').length).toBeGreaterThan(0);
    expect(screen.queryByText('$10,000')).toBeNull();
  });
});

describe('InteriorPortfolioPage — handed-over rows', () => {
  it('says "done" instead of running an overdue countdown on a completed fit-out', () => {
    state.rows = [row({ status: 'COMPLETED', daysToHandover: -40 })];
    renderPage();
    expect(screen.getByText('done')).toBeTruthy();
    expect(screen.queryByText('40d overdue')).toBeNull();
  });
});
