/**
 * The Activity tab's composer is one line until it is wanted (design audit, 2026-10-18).
 *
 * What would fail quietly if it regressed:
 *   - closing the composer must not throw away a half-written update
 *   - an update waiting for signal must stay visible while the composer is closed
 *   - a role that can only comment is offered a comment, not a site update
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UnitActivity } from './UnitActivity';
import { useSiteOutboxStore } from '../store/siteOutboxStore';

const perms = { set: new Set<string>(['dailylog:edit', 'comment:edit']) };

vi.mock('../hooks/useApi', () => ({
  useDailyLogs: () => ({ data: [], isLoading: false }),
  useUnitComments: () => ({ data: [], isLoading: false }),
  useCreateComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCustomOptions: () => ({ data: [] }),
  useCreateDailyLog: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDailyLog: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateDailyLog: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddDailyLogPhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveDailyLogPhoto: () => ({ mutate: vi.fn(), isPending: false }),
  usePresignedUpload: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBuildings: () => ({ data: [] }),
  useUnitConstructionStages: () => ({ data: [] }),
  useAssignableUsers: () => ({ data: [] }),
}) as any);

vi.mock('../store/authStore', () => ({
  useAuthStore: (sel?: any) => {
    const store = { user: { id: 'victor' }, hasPermission: (p: string) => perms.set.has(p) };
    return sel ? sel(store) : store;
  },
}));

const renderActivity = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <UnitActivity projectId="p1" unitId="u1" />
  </QueryClientProvider>,
);

beforeEach(() => {
  perms.set = new Set(['dailylog:edit', 'comment:edit']);
  useSiteOutboxStore.setState({ items: [] });
});

describe('UnitActivity composer', () => {
  it('starts as one line and opens into the full composer', () => {
    renderActivity();
    const box = screen.getByLabelText('What happened on this unit?');
    expect(box).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Post a site update…' }));
    expect(box).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Post a site update…' })).toBeNull();
  });

  it('keeps a half-written update when it is closed and opened again', () => {
    renderActivity();
    fireEvent.click(screen.getByRole('button', { name: 'Post a site update…' }));
    const box = screen.getByLabelText('What happened on this unit?') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Drywall on the north wall' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(box).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Post a site update…' }));
    expect((screen.getByLabelText('What happened on this unit?') as HTMLTextAreaElement).value)
      .toBe('Drywall on the north wall');
  });

  it('still shows an update waiting for signal while the composer is closed', () => {
    useSiteOutboxStore.getState().add({
      clientRef: 'r1', userId: 'victor', payload: { projectId: 'p1', unitId: 'u1', notes: 'Tile delivered' },
      createdAt: 1, attempts: 1, error: null,
    });
    renderActivity();
    const notices = screen.getAllByText('1 update saved on this device, not sent yet');
    expect(notices.some((n) => !n.closest('[hidden]'))).toBe(true);
  });

  it('offers a comment, not a site update, to a role that can only comment', () => {
    perms.set = new Set(['comment:edit']);
    renderActivity();
    expect(screen.getByRole('button', { name: 'Add a note for the team…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Post a site update…' })).toBeNull();
  });
});
