import { useCallback } from 'react';
import type { AxiosError } from 'axios';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useSiteOutboxStore, type OutboxItem } from '../store/siteOutboxStore';
import { errMsg } from '../utils/fmt';

/**
 * Posting a site update from a phone with no signal (roadmap "PWA/offline", 2026-10-17).
 *
 * A post that fails because the request never got an answer — no signal, a timeout, or the
 * server briefly unreachable (502/503/504) — is kept on the phone and sent later, instead of
 * failing. Every post carries a `clientRef`; if the first attempt actually reached the server
 * before the signal dropped, the retry gets that post back rather than making a duplicate.
 *
 * A post the server REFUSES (validation, permission) is not a signal problem and is never
 * queued — it fails as it always did. Photos need a connection to upload, so a post with
 * photos is not queued either; its composer keeps the text and the photos for a retry.
 */

export function newClientRef() {
  try { if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID(); } catch { /* old browser */ }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** No answer at all, or the box was unreachable — worth trying again later. */
export function isRetryable(err: unknown) {
  const e = err as AxiosError;
  if (!e || typeof e !== 'object') return false;
  if (!('isAxiosError' in e) && !('response' in e) && !('code' in e)) return false;
  const status = e.response?.status;
  if (status === undefined) return true; // network error / timeout: no response came back
  return status === 502 || status === 503 || status === 504;
}

let flushing = false;

/**
 * Send every waiting update of this user, oldest first. Stops at the first signal failure
 * (the rest would fail the same way); a refusal is recorded on that item and skipped.
 * Returns how many were sent.
 */
export async function flushSiteOutbox(userId: string): Promise<number> {
  if (flushing || !userId) return 0;
  flushing = true;
  let sent = 0;
  try {
    const store = useSiteOutboxStore.getState();
    const mine = store.items.filter((i) => i.userId === userId && !i.error).sort((a, b) => a.createdAt - b.createdAt);
    for (const item of mine) {
      try {
        await api.post('/daily-logs', { ...item.payload, clientRef: item.clientRef });
        useSiteOutboxStore.getState().remove(item.clientRef);
        sent += 1;
      } catch (err) {
        if (isRetryable(err)) {
          useSiteOutboxStore.getState().patch(item.clientRef, { attempts: item.attempts + 1 });
          break;
        }
        useSiteOutboxStore.getState().patch(item.clientRef, { attempts: item.attempts + 1, error: errMsg(err, 'The server refused this update') });
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export function useSiteOutbox() {
  // Tolerates a mocked store that ignores the selector (component tests).
  const u = useAuthStore((st) => st.user?.id ?? '');
  const userId = typeof u === 'string' ? u : '';
  const all = useSiteOutboxStore((st) => st.items);
  const items: OutboxItem[] = all.filter((i) => i.userId === userId);

  /**
   * Post now through `send` (the composer's own create mutation, so its refresh behaviour is
   * unchanged); if there is no signal, keep the post on this device and say so. Resolves to
   * 'posted' or 'queued'; rejects for anything else (a refusal, or no signal with photos).
   */
  const postOrQueue = useCallback(async (
    payload: Record<string, any>,
    opts: { send: (body: Record<string, any>) => Promise<any>; hasPhotos?: boolean },
  ) => {
    const clientRef = newClientRef();
    try {
      const log = await opts.send({ ...payload, clientRef });
      return { status: 'posted' as const, log };
    } catch (err) {
      if (!isRetryable(err) || opts.hasPhotos || !userId) throw err;
      useSiteOutboxStore.getState().add({ clientRef, userId, payload, createdAt: Date.now(), attempts: 1, error: null });
      return { status: 'queued' as const, log: null };
    }
  }, [userId]);

  const discard = useCallback((clientRef: string) => useSiteOutboxStore.getState().remove(clientRef), []);

  return { items, userId, postOrQueue, discard };
}
