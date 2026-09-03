/**
 * The punch list's evidence and its lifecycle.
 *
 * A snag can only be closed with an "after" photo (client, 2026-08-14) — but the panel
 * rendered neither shot, so the proof the rule exists to collect was write-only: uploaded,
 * stored, and visible to nobody. Photos are asserted here because "the evidence is on
 * screen" is the entire point of the rule, and nothing throws when it silently is not.
 *
 * Due dates matter for the same reason. `SNAG_OVERDUE` — the notification type, its daily
 * cron and its user preference toggle — were all built and could never fire, because no UI
 * ever set `dueDate`. A form that quietly drops the field brings that back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SnagPanel } from './SnagPanel';

const added: any[] = [];
const updates: any[] = [];
const uploads: any[] = [];

vi.mock('../hooks/useApi', () => ({
  useAddSnag: () => ({
    mutateAsync: (payload: any) => { added.push(payload); return Promise.resolve({ id: 's-new' }); },
    isPending: false,
  }),
  useResolveSnag: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useUpdateSnag: () => ({
    mutateAsync: (payload: any) => { updates.push(payload); return Promise.resolve({}); },
    isPending: false,
  }),
  useAssignableUsers: () => ({ data: [{ id: 'u1', name: 'Demo PM' }] }),
  usePresignedUpload: () => ({
    mutateAsync: (payload: any) => {
      uploads.push(payload);
      return Promise.resolve({ storagePath: 'snags/before-1.jpg' });
    },
    isPending: false,
  }),
}) as any);

function snag(overrides: Record<string, any> = {}) {
  return {
    id: 's1', description: 'Paint peel on west wall', status: 'OPEN' as const,
    room: 'Reception', assignee: 'Demo PM',
    dueDate: null, photoUrl: null, afterPhotoUrl: null,
    ...overrides,
  };
}

const renderPanel = (snags: any[]) => render(<SnagPanel projectId="ip1" snags={snags} />);

beforeEach(() => { added.length = 0; updates.length = 0; uploads.length = 0; });

describe('SnagPanel — before/after evidence is visible', () => {
  it('renders the defect shot and the proof-of-fix shot as separate images', () => {
    renderPanel([snag({
      status: 'RESOLVED',
      photoUrl: 'https://signed/before.jpg',
      afterPhotoUrl: 'https://signed/after.jpg',
    })]);

    const before = screen.getByAltText('Defect') as HTMLImageElement;
    const after = screen.getByAltText('Proof of fix') as HTMLImageElement;
    expect(before.src).toBe('https://signed/before.jpg');
    expect(after.src).toBe('https://signed/after.jpg');
    // Two distinct columns, never one overwriting the other — the pair IS the record.
    expect(before.src).not.toBe(after.src);
  });

  it('shows only the defect shot while a snag is still open', () => {
    renderPanel([snag({ photoUrl: 'https://signed/before.jpg' })]);
    expect(screen.getByAltText('Defect')).toBeTruthy();
    expect(screen.queryByAltText('Proof of fix')).toBeNull();
  });

  it('renders no image tiles when a snag has no photos', () => {
    renderPanel([snag()]);
    expect(screen.queryByAltText('Defect')).toBeNull();
    expect(screen.queryByAltText('Proof of fix')).toBeNull();
  });

  it('opens the full-size viewer when a thumbnail is clicked', async () => {
    renderPanel([snag({ status: 'RESOLVED', afterPhotoUrl: 'https://signed/after.jpg' })]);
    fireEvent.click(screen.getByRole('button', { name: /View Proof of fix photo/ }));
    expect(await screen.findByText('Proof of fix (after)')).toBeTruthy();
  });
});

describe('SnagPanel — due dates', () => {
  it('sends the target date when adding a snag, so the overdue check has something to read', async () => {
    renderPanel([]);
    fireEvent.click(screen.getByRole('button', { name: /Add snag/ }));
    fireEvent.change(await screen.findByLabelText('Description'), {
      target: { value: 'Skirting gap' },
    });
    fireEvent.change(screen.getByLabelText('Target date'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add snag' }).pop()!);

    await waitFor(() => expect(added.length).toBe(1));
    expect(added[0].data.dueDate).toBe('2026-10-01');
  });

  it('flags an unresolved snag whose date has passed as overdue', () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString();
    renderPanel([snag({ dueDate: past })]);
    expect(screen.getByText(/d overdue/)).toBeTruthy();
  });

  it('does not call a resolved snag overdue, however old its date', () => {
    const past = new Date(Date.now() - 90 * 86_400_000).toISOString();
    renderPanel([snag({ status: 'RESOLVED', dueDate: past, afterPhotoUrl: 'https://signed/a.jpg' })]);
    expect(screen.queryByText(/d overdue/)).toBeNull();
  });
});

describe('SnagPanel — reopening', () => {
  it('offers reopen only on a resolved snag', () => {
    const { unmount } = renderPanel([snag({ status: 'RESOLVED', afterPhotoUrl: 'https://signed/a.jpg' })]);
    expect(screen.getByRole('button', { name: 'Reopen snag' })).toBeTruthy();
    unmount();

    renderPanel([snag({ status: 'OPEN' })]);
    expect(screen.queryByRole('button', { name: 'Reopen snag' })).toBeNull();
  });

  /**
   * Reopening sends OPEN, and the API retires the proof-of-fix photo with it — so the
   * re-fix needs its own picture rather than passing the gate on evidence of a repair that
   * demonstrably did not hold.
   */
  it('reopens to OPEN rather than to some in-between state', async () => {
    renderPanel([snag({ status: 'RESOLVED', afterPhotoUrl: 'https://signed/a.jpg' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen snag' }));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toEqual({ id: 's1', data: { status: 'OPEN' } });
  });
});

describe('SnagPanel — status filter counts', () => {
  it('counts open, in-progress and resolved separately', () => {
    renderPanel([
      snag({ id: 'a', status: 'OPEN' }),
      snag({ id: 'b', status: 'IN_PROGRESS' }),
      snag({ id: 'c', status: 'RESOLVED', afterPhotoUrl: 'https://signed/a.jpg' }),
      snag({ id: 'd', status: 'RESOLVED', afterPhotoUrl: 'https://signed/b.jpg' }),
    ]);
    const bar = screen.getByText('All (4)').parentElement!;
    expect(within(bar).getByText('Open (1)')).toBeTruthy();
    expect(within(bar).getByText('In Progress (1)')).toBeTruthy();
    expect(within(bar).getByText('Resolved (2)')).toBeTruthy();
  });
});
