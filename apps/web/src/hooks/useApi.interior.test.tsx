/**
 * What the interior mutations actually put on the wire.
 *
 * The page-level tests assert what a screen HANDS to a hook; this asserts what the hook
 * SENDS. That gap is exactly where the forced-handover bug lived: the dialog collected a
 * reason and passed it in good faith, and the hook dropped `force`/`forceReason` on the
 * floor before the POST. Mocking the hook — as a component test must — cannot see that.
 *
 * Same for the BOQ delete, which called a URL the API does not route. Every click returned
 * a raw "Cannot DELETE /api/interior/…" 404 straight into a toast, and no component test
 * would have noticed, because the request shape was never the thing under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const calls: Array<{ method: string; url: string; body?: any }> = [];

vi.mock('../lib/api', () => ({
  default: {
    get: (url: string) => { calls.push({ method: 'GET', url }); return Promise.resolve({ data: [] }); },
    post: (url: string, body?: any) => { calls.push({ method: 'POST', url, body }); return Promise.resolve({ data: {} }); },
    patch: (url: string, body?: any) => { calls.push({ method: 'PATCH', url, body }); return Promise.resolve({ data: {} }); },
    delete: (url: string) => { calls.push({ method: 'DELETE', url }); return Promise.resolve({ data: {} }); },
  },
}));

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector?: any) => {
    const store = { hasPermission: () => true, hasAnyPermission: () => true };
    return selector ? selector(store) : store;
  },
}));

import {
  useAdvanceInteriorPhase, useDeleteInteriorScope,
  useUpdateInteriorInvoice, useVoidInteriorInvoice, useResolveSnag,
} from './useApi';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function run<T>(hook: () => any, vars: T) {
  const { result } = renderHook(hook, { wrapper });
  await act(async () => { await result.current.mutateAsync(vars as any); });
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  return calls[calls.length - 1];
}

beforeEach(() => { calls.length = 0; });

describe('useAdvanceInteriorPhase', () => {
  it('forwards force and forceReason — the override is unreachable without them', async () => {
    const call = await run(useAdvanceInteriorPhase, {
      id: 'ip1', target: 'HANDOVER',
      handoverSignedBy: 'Priya Menon',
      force: true, forceReason: 'Client accepted; contractor returns 12 Sep',
    });

    expect(call).toMatchObject({ method: 'POST', url: '/interior/ip1/advance' });
    expect(call.body.force).toBe(true);
    expect(call.body.forceReason).toBe('Client accepted; contractor returns 12 Sep');
    expect(call.body.target).toBe('HANDOVER');
    expect(call.body.handoverSignedBy).toBe('Priya Menon');
  });

  it('leaves them undefined on an ordinary advance', async () => {
    const call = await run(useAdvanceInteriorPhase, { id: 'ip1', target: 'EXECUTION' });
    expect(call.body.force).toBeUndefined();
    expect(call.body.forceReason).toBeUndefined();
  });
});

describe('useDeleteInteriorScope', () => {
  /**
   * The route is nested under the interior project id so the access guard can resolve the
   * owning project from it. A bare `/interior/scope/:id` matches no route at all.
   */
  it('deletes through the project-scoped path the API actually exposes', async () => {
    const call = await run(useDeleteInteriorScope, { projectId: 'ip1', scopeId: 'sc1' });
    expect(call).toEqual({ method: 'DELETE', url: '/interior/ip1/scope/sc1' });
  });
});

describe('interior invoice lifecycle', () => {
  it('patches the status on the project-scoped invoice route', async () => {
    const call = await run(useUpdateInteriorInvoice, {
      id: 'ip1', invoiceId: 'inv1', data: { status: 'PAID' },
    });
    expect(call).toEqual({ method: 'PATCH', url: '/interior/ip1/invoices/inv1', body: { status: 'PAID' } });
  });

  it('voids through DELETE, which is what also reverses the mirrored Actual', async () => {
    const call = await run(useVoidInteriorInvoice, { id: 'ip1', invoiceId: 'inv1' });
    expect(call).toEqual({ method: 'DELETE', url: '/interior/ip1/invoices/inv1' });
  });
});

describe('useResolveSnag', () => {
  /** The API refuses a bodyless resolve; there is no silent path around the proof rule. */
  it('always carries the proof-of-fix path', async () => {
    const call = await run(useResolveSnag, { snagId: 's1', afterPhotoPath: 'snags/after-1.jpg' });
    expect(call).toEqual({
      method: 'POST', url: '/interior/snags/s1/resolve', body: { afterPhotoPath: 'snags/after-1.jpg' },
    });
  });
});
