/**
 * What the interior mutations actually put on the wire.
 *
 * The page-level tests assert what a screen HANDS to a hook; this asserts what the hook
 * SENDS. That gap is exactly where the forced-handover bug lived: the dialog collected a
 * reason and passed it in good faith, and the hook dropped `force`/`forceReason` on the
 * floor before the POST. Mocking the hook — as a component test must — cannot see that.
 *
 * Same for the old BOQ delete (now estimate lines), which called a URL the API does not route. Every click returned
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
  useAdvanceInteriorPhase, useSaveEstimateLine, useRemoveEstimateLine, useEstimateAction,
  useDecideInteriorChangeOrder, useInteriorPurchaseOrderAction, useAddInteriorInvoice,
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

describe('estimate lines', () => {
  /**
   * Nested under the fit-out id so the access guard can resolve the owning project — the
   * old BOQ delete called a bare path the API did not route, and 404'd on every click.
   */
  it('adds with POST and inline-edits one cell with PATCH, both project-scoped', async () => {
    const add = await run(useSaveEstimateLine, { id: 'ip1', data: { description: 'Doors', unitPrice: 4200 } });
    expect(add).toEqual({ method: 'POST', url: '/interior/ip1/estimate/lines', body: { description: 'Doors', unitPrice: 4200 } });

    const edit = await run(useSaveEstimateLine, { id: 'ip1', lineId: 'l1', data: { paidBy: 'TENANT' } });
    expect(edit).toEqual({ method: 'PATCH', url: '/interior/ip1/estimate/lines/l1', body: { paidBy: 'TENANT' } });
  });

  it('removes through the project-scoped path', async () => {
    const call = await run(useRemoveEstimateLine, { id: 'ip1', lineId: 'l1' });
    expect(call).toEqual({ method: 'DELETE', url: '/interior/ip1/estimate/lines/l1' });
  });
});

describe('estimate lock', () => {
  it('sends the unlock reason — the API refuses an unlock without one', async () => {
    const call = await run(useEstimateAction, { id: 'ip1', action: 'unlock', reason: 'Tenant added a kitchen' });
    expect(call).toEqual({ method: 'POST', url: '/interior/ip1/estimate/unlock', body: { reason: 'Tenant added a kitchen' } });
  });

  it('locks with an empty body', async () => {
    const call = await run(useEstimateAction, { id: 'ip1', action: 'lock' });
    expect(call).toEqual({ method: 'POST', url: '/interior/ip1/estimate/lock', body: {} });
  });
});

describe('change orders and purchase orders', () => {
  it('decides a change order with APPROVE or REJECT', async () => {
    const call = await run(useDecideInteriorChangeOrder, { id: 'ip1', coId: 'co1', decision: 'APPROVE' });
    expect(call).toEqual({ method: 'POST', url: '/interior/ip1/change-orders/co1/decide', body: { decision: 'APPROVE' } });
  });

  it('carries the complete flag when marking PO work done or reopening it', async () => {
    const done = await run(useInteriorPurchaseOrderAction, { id: 'ip1', poId: 'po1', action: 'complete', complete: true });
    expect(done).toEqual({ method: 'POST', url: '/interior/ip1/purchase-orders/po1/complete', body: { complete: true } });
    const reopen = await run(useInteriorPurchaseOrderAction, { id: 'ip1', poId: 'po1', action: 'complete', complete: false });
    expect(reopen.body).toEqual({ complete: false });
  });

  it('approves with an empty body', async () => {
    const call = await run(useInteriorPurchaseOrderAction, { id: 'ip1', poId: 'po1', action: 'approve' });
    expect(call).toEqual({ method: 'POST', url: '/interior/ip1/purchase-orders/po1/approve', body: {} });
  });
});

describe('interior invoice lifecycle', () => {
  it('logs a bill against its purchase order — the supplier comes from the PO', async () => {
    const call = await run(useAddInteriorInvoice, { id: 'ip1', data: { purchaseOrderId: 'po1', amount: 500 } });
    expect(call).toEqual({ method: 'POST', url: '/interior/ip1/invoices', body: { purchaseOrderId: 'po1', amount: 500 } });
  });

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
