/**
 * Site updates written with no signal (roadmap "PWA/offline", 2026-10-17).
 *
 * The rules that matter, because each fails quietly:
 *   - only a signal failure is kept for later; a refusal (400/403) fails as before
 *   - a post with photos is never kept (photos need a connection)
 *   - every send carries a clientRef, so a retry after a dropped signal cannot duplicate
 *   - the sender sends oldest first, stops at the first signal failure, and records a
 *     refusal on that item instead of retrying it forever
 *   - a shared device only ever sends its own user's updates
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const posts: any[] = [];
const outcome = { next: [] as Array<'ok' | 'offline' | 'refused'> };

vi.mock('../lib/api', () => ({
  default: {
    post: (url: string, body: any) => {
      posts.push({ url, body });
      const o = outcome.next.shift() ?? 'ok';
      if (o === 'offline') return Promise.reject(Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' }));
      if (o === 'refused') return Promise.reject(Object.assign(new Error('Bad'), { isAxiosError: true, response: { status: 400, data: { message: 'notes are required' } } }));
      return Promise.resolve({ data: { id: `l${posts.length}` } });
    },
  },
}));

const auth = { userId: 'victor' };
vi.mock('../store/authStore', () => ({
  useAuthStore: (sel: any) => sel({ user: { id: auth.userId } }),
}));

import { flushSiteOutbox, isRetryable, useSiteOutbox } from './useSiteOutbox';
import { useSiteOutboxStore } from '../store/siteOutboxStore';

const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
const status = (s: number) => Object.assign(new Error(String(s)), { isAxiosError: true, response: { status: s } });

beforeEach(() => {
  posts.length = 0;
  outcome.next = [];
  auth.userId = 'victor';
  useSiteOutboxStore.setState({ items: [] });
});

describe('isRetryable', () => {
  it('is true when no answer came back, or the server was unreachable', () => {
    expect(isRetryable(offline())).toBe(true);
    expect(isRetryable(Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' }))).toBe(true);
    for (const s of [502, 503, 504]) expect(isRetryable(status(s))).toBe(true);
  });
  it('is false for an answer that says no', () => {
    for (const s of [400, 401, 403, 404, 409, 500]) expect(isRetryable(status(s))).toBe(false);
    expect(isRetryable(new Error('plain bug'))).toBe(false);
  });
});

describe('postOrQueue', () => {
  const hook = () => renderHook(() => useSiteOutbox()).result;

  it('posts with a clientRef when there is signal', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'l1' });
    const r = await hook().current.postOrQueue({ projectId: 'p1', unitId: 'u1', notes: 'Framing done' }, { send });
    expect(r.status).toBe('posted');
    expect(send.mock.calls[0][0]).toMatchObject({ notes: 'Framing done', clientRef: expect.any(String) });
  });

  it('keeps the update on the device when there is no signal', async () => {
    const send = vi.fn().mockRejectedValue(offline());
    const r = await hook().current.postOrQueue({ projectId: 'p1', unitId: 'u1', notes: 'Framing done' }, { send });
    expect(r.status).toBe('queued');
    const [item] = useSiteOutboxStore.getState().items;
    expect(item).toMatchObject({ userId: 'victor', payload: { notes: 'Framing done' }, error: null });
    // The kept copy carries the SAME ref the failed attempt used — that attempt may have landed.
    expect(item.clientRef).toBe(send.mock.calls[0][0].clientRef);
  });

  it('fails as before when the server refuses — nothing is kept', async () => {
    const send = vi.fn().mockRejectedValue(status(400));
    await expect(hook().current.postOrQueue({ notes: 'x' }, { send })).rejects.toBeTruthy();
    expect(useSiteOutboxStore.getState().items).toHaveLength(0);
  });

  it('never keeps a post with photos — they need a connection', async () => {
    const send = vi.fn().mockRejectedValue(offline());
    await expect(hook().current.postOrQueue({ notes: 'x' }, { send, hasPhotos: true })).rejects.toBeTruthy();
    expect(useSiteOutboxStore.getState().items).toHaveLength(0);
  });
});

describe('flushSiteOutbox', () => {
  const keep = (ref: string, createdAt: number, userId = 'victor') =>
    useSiteOutboxStore.getState().add({ clientRef: ref, userId, payload: { projectId: 'p1', notes: ref }, createdAt, attempts: 1, error: null });

  it('sends oldest first, each with its own clientRef, and clears what was sent', async () => {
    keep('b', 2); keep('a', 1);
    await act(async () => { expect(await flushSiteOutbox('victor')).toBe(2); });
    expect(posts.map((p) => p.body.clientRef)).toEqual(['a', 'b']);
    expect(useSiteOutboxStore.getState().items).toHaveLength(0);
  });

  it('stops at the first signal failure and keeps the rest for later', async () => {
    keep('a', 1); keep('b', 2);
    outcome.next = ['offline'];
    await act(async () => { expect(await flushSiteOutbox('victor')).toBe(0); });
    expect(posts).toHaveLength(1);
    expect(useSiteOutboxStore.getState().items.map((i) => i.clientRef)).toEqual(['a', 'b']);
  });

  it('records a refusal on that item, skips it next time, and carries on with the rest', async () => {
    keep('a', 1); keep('b', 2);
    outcome.next = ['refused', 'ok'];
    await act(async () => { expect(await flushSiteOutbox('victor')).toBe(1); });
    const [a] = useSiteOutboxStore.getState().items;
    expect(a.clientRef).toBe('a');
    expect(a.error).toContain('notes are required');
    posts.length = 0;
    await act(async () => { await flushSiteOutbox('victor'); });
    expect(posts).toHaveLength(0); // the refused one is not retried
  });

  it('only ever sends the signed-in user\'s updates from a shared device', async () => {
    keep('mine', 1, 'victor'); keep('theirs', 2, 'ana');
    await act(async () => { await flushSiteOutbox('victor'); });
    expect(posts.map((p) => p.body.clientRef)).toEqual(['mine']);
    expect(useSiteOutboxStore.getState().items.map((i) => i.clientRef)).toEqual(['theirs']);
  });
});
