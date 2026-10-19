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
const serverError = () => Object.assign(new Error('Server error'), { isAxiosError: true, response: { status: 500, data: { message: 'Server error' } } });
const sent: any[] = [];
const fail: { with: () => Error } = { with: offline };

vi.mock('../hooks/useApi', () => ({
  useDailyLogs: () => ({ data: [], isLoading: false }),
  useCreateDailyLog: () => ({
    mutateAsync: (p: any) => { sent.push(p); return Promise.reject(fail.with()); },
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
  fail.with = offline;
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

describe('DailyLogFeed retrying a post that failed', () => {
  it('retries the same post under the same ref, and a changed post under a new one', async () => {
    // A 500 can arrive after the write committed, and the composer keeps the text for a retry.
    // The same ref lets the server hand back the post that landed instead of making a second.
    fail.with = serverError;
    renderFeed();
    const box = screen.getByLabelText('What happened on this unit?') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Countertops templated' } });
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].clientRef).toBe(sent[0].clientRef);

    fireEvent.change(box, { target: { value: 'Countertops templated, install Friday' } });
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2].clientRef).not.toBe(sent[0].clientRef);
    expect(useSiteOutboxStore.getState().items).toHaveLength(0); // a refusal is never kept
  });
});
