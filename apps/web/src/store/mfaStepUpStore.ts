import { create } from 'zustand';

/**
 * Cross-cutting bridge between the axios response interceptor (plain module
 * code, no React — see `lib/api.ts`) and the `MfaStepUpModal` React component.
 *
 * When any request hits the 403 "MFA verification required" response, the
 * interceptor calls `requestStepUp()` and awaits the returned promise instead
 * of retrying immediately. `MfaStepUpModal` observes `pending` and renders
 * when true. Once the user supplies a valid TOTP code, the modal calls
 * `resolveMfaStepUp()`, which settles every queued request's promise so the
 * interceptor can retry each original request (picking up the fresh access
 * token automatically, since the request interceptor reads it from
 * `authStore` on every call). If the user cancels — or has no MFA enrolled
 * at all — the modal calls `rejectMfaStepUp()` instead, failing the queued
 * request(s) cleanly so the originating mutation's own error handling runs.
 *
 * If a step-up is already pending when a second request hits the same 403,
 * it's simply added to the queue rather than opening a second modal — same
 * idea as the `isRefreshing` / `failedQueue` pattern already used for 401
 * token refresh in `lib/api.ts`.
 */

interface QueuedWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface MfaStepUpState {
  pending: boolean;
  queue: QueuedWaiter[];
  /** Called by the axios interceptor. Resolves once step-up succeeds; rejects if cancelled/unavailable. */
  requestStepUp: () => Promise<void>;
  /** Called by the modal on successful TOTP verification. Drains the queue with success. */
  resolveMfaStepUp: () => void;
  /** Called by the modal on cancel (or when MFA isn't enrolled). Drains the queue with failure. */
  rejectMfaStepUp: (error: unknown) => void;
}

export const useMfaStepUpStore = create<MfaStepUpState>((set, get) => ({
  pending: false,
  queue: [],

  requestStepUp: () =>
    new Promise<void>((resolve, reject) => {
      set((s) => ({ pending: true, queue: [...s.queue, { resolve, reject }] }));
    }),

  resolveMfaStepUp: () => {
    const { queue } = get();
    set({ pending: false, queue: [] });
    queue.forEach((w) => w.resolve());
  },

  rejectMfaStepUp: (error) => {
    const { queue } = get();
    set({ pending: false, queue: [] });
    queue.forEach((w) => w.reject(error));
  },
}));
