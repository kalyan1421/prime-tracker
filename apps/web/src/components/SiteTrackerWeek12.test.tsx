/**
 * Site Tracker weeks 1–2 (meeting 2026-10-13, decisions 2026-10-16), on the screen:
 *   - the people picker: search, "Assign me", and every active person in it
 *   - the row menu: Watch for everyone, the destructive actions only with siteTracker:manage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PeoplePicker } from './PeoplePicker';
import { SiteTrackerRowActions } from './SiteTrackerRowActions';
import { useAuthStore } from '../store/authStore';

const watchCalls: any[] = [];

vi.mock('../hooks/useApi', () => ({
  useAssignableUsers: () => ({
    data: [
      { id: 'kevin', name: 'Kevin P', email: 'kevin@theprimedeveloper.com' },
      { id: 'victor', name: 'Victor R', email: 'victor@theprimedeveloper.com' },
      { id: 'ana', name: 'Ana P', email: 'ana@theprimedeveloper.com' },
    ],
  }),
  useClearUnitChecklist: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUntrackUnit: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useWatchUnit: () => ({ mutate: (v: any) => watchCalls.push(v), isPending: false }),
}));

function signIn(id: string, permissions: string[]) {
  useAuthStore.setState({ user: { id, permissions } as any, isAuthenticated: true } as any);
}

beforeEach(() => {
  watchCalls.length = 0;
  signIn('victor', ['siteTracker:view', 'siteTracker:edit']);
});

describe('PeoplePicker', () => {
  it('lists everyone and puts "Assign me" first — Victor can find himself', async () => {
    const onChange = vi.fn();
    render(<PeoplePicker mode="multi" selected={[]} onChange={onChange}><button type="button">Owners</button></PeoplePicker>);
    fireEvent.click(screen.getByText('Owners'));
    await waitFor(() => expect(screen.getByText('Assign me')).toBeTruthy());
    expect(screen.getByText('Kevin P')).toBeTruthy();
    fireEvent.click(screen.getByText('Assign me'));
    expect(onChange).toHaveBeenCalledWith(['victor']);
  });

  it('adds to the set rather than replacing it, and offers "Remove me" once chosen', async () => {
    const onChange = vi.fn();
    render(<PeoplePicker mode="multi" selected={['kevin', 'victor']} onChange={onChange}><button type="button">Owners</button></PeoplePicker>);
    fireEvent.click(screen.getByText('Owners'));
    await waitFor(() => expect(screen.getByText('Remove me')).toBeTruthy());
    fireEvent.click(screen.getByText('Ana P'));
    expect(onChange).toHaveBeenCalledWith(['kevin', 'victor', 'ana']);
  });

  it('narrows the list as you type', async () => {
    render(<PeoplePicker mode="multi" selected={[]} onChange={vi.fn()}><button type="button">Owners</button></PeoplePicker>);
    fireEvent.click(screen.getByText('Owners'));
    const box = await screen.findByLabelText('Search people');
    fireEvent.change(box, { target: { value: 'ana' } });
    await waitFor(() => expect(screen.queryByText('Kevin P')).toBeNull());
    expect(screen.getByText('Ana P')).toBeTruthy();
  });

  it('single mode picks one person', async () => {
    const onChange = vi.fn();
    render(<PeoplePicker mode="single" selected={['kevin']} onChange={onChange}><button type="button">Stage owner</button></PeoplePicker>);
    fireEvent.click(screen.getByText('Stage owner'));
    fireEvent.click(await screen.findByText('Ana P'));
    expect(onChange).toHaveBeenCalledWith(['ana']);
  });
});

const row = {
  id: 'u805', unitNumber: '805', totalStages: 22, doneStages: 4, updateCount: 6, assigneeCount: 1,
  blockerStatus: 'NO', sitePriority: 'HIGH', label: 'Units 805, 807, 809', groupCount: 2, watching: false,
};

async function openMenu() {
  fireEvent.click(screen.getByLabelText('More actions for unit 805'));
  await screen.findByText('Watch');
}

describe('SiteTrackerRowActions — the lock', () => {
  it('a PM can watch, but cannot clear a checklist or remove a unit', async () => {
    render(<SiteTrackerRowActions row={row} canEditChecklist canManage={false} />);
    await openMenu();
    expect(screen.queryByText('Clear checklist')).toBeNull();
    expect(screen.queryByText('Remove from tracker')).toBeNull();
  });

  it('a Founder gets both', async () => {
    render(<SiteTrackerRowActions row={row} canEditChecklist canManage />);
    await openMenu();
    expect(screen.getByText('Clear checklist')).toBeTruthy();
    expect(screen.getByText('Remove from tracker')).toBeTruthy();
  });

  it('Watch follows the unit without a confirmation', async () => {
    render(<SiteTrackerRowActions row={row} canEditChecklist={false} canManage={false} />);
    await openMenu();
    fireEvent.click(screen.getByText('Watch'));
    expect(watchCalls).toEqual([{ unitId: 'u805', watch: true }]);
  });
});
