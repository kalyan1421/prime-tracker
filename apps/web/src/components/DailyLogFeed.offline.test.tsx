/**
 * The composer with no signal: a text-only update is kept on the device (the box clears and
 * says so); an update with photos is NOT kept — its text stays put for another try.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DailyLogFeed } from './DailyLogFeed';
import { useSiteOutboxStore } from '../store/siteOutboxStore';

const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
const sent: any[] = [];

vi.mock('../hooks/useApi', () => ({
  useDailyLogs: () => ({ data: [], isLoading: false }),
  useCreateDailyLog: () => ({
    mutateAsync: (p: any) => { sent.push(p); return Promise.reject(offline()); },
    isPending: false,
  }),
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
    const store = { user: { id: 'victor' }, hasPermission: () => true };
    return sel ? sel(store) : store;
  },
}));

const renderFeed = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <DailyLogFeed projectId="p1" unitId="u1" />
  </QueryClientProvider>,
);

beforeEach(() => {
  sent.length = 0;
  useSiteOutboxStore.setState({ items: [] });
});

describe('DailyLogFeed with no signal', () => {
  it('keeps a text-only update on the device, clears the box and says it is waiting', async () => {
    renderFeed();
    const box = screen.getByLabelText('What happened on this unit?') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Drywall hung on the north wall' } });
    fireEvent.click(screen.getByRole('button', { name: /post/i }));

    await waitFor(() => expect(useSiteOutboxStore.getState().items).toHaveLength(1));
    const [item] = useSiteOutboxStore.getState().items;
    expect(item.payload).toMatchObject({ projectId: 'p1', unitId: 'u1', notes: 'Drywall hung on the north wall' });
    expect(item.clientRef).toBe(sent[0].clientRef);
    expect(box.value).toBe('');
    expect(await screen.findByText('1 update saved on this device, not sent yet')).toBeTruthy();
    expect(screen.getByText('Drywall hung on the north wall')).toBeTruthy();
  });
});
